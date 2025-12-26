import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import pkg from '@aws-sdk/lib-dynamodb';
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, UpdateCommand, DeleteCommand } = pkg;
import { CreateTableCommand, DeleteTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import Ajv from 'ajv';
import axios from 'axios';
import { SchemaType, SchemaGenerationError, SchemaValidationError, HttpMethod, PaginationType, TableStatus } from './unified-types.js';
import { saveSingleExecutionLog, savePaginatedExecutionLogs } from '../executionHandler.js';
import { handlers as dynamodbHandlers } from './dynamodb-handlers.js';
import { createNamespaceFolder, deleteNamespaceFolder } from '../utils/brmh-drive.js';

// Import or define your tools here
// import { FileTool, CodeTool, SchemaTool, ApiTool } from './tools';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

// S3 Configuration
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || 'brmh';
const NAMESPACE_ICON_FOLDER = 'namespaceicon';


// Schema Generation and Validation
const validateInputData = (data) => {
  if (data === undefined || data === null) {
    throw new SchemaValidationError('Input data cannot be null or undefined');
  }

  if (typeof data !== 'object') {
    throw new SchemaValidationError('Input data must be an object or array');
  }

  if (Array.isArray(data) && data.length === 0) {
    throw new SchemaValidationError('Array input data cannot be empty');
  }
};

const validateGeneratedSchema = (schema) => {
  if (!schema || typeof schema !== 'object') {
    throw new SchemaValidationError('Generated schema is invalid');
  }

  if (!schema.type) {
    throw new SchemaValidationError('Schema must have a type property');
  }

  if (schema.type === SchemaType.OBJECT && (!schema.properties || typeof schema.properties !== 'object')) {
    throw new SchemaValidationError('Object schema must have properties');
  }

  if (schema.type === SchemaType.ARRAY && !schema.items) {
    throw new SchemaValidationError('Array schema must have items');
  }
};

const generateSchema = (data) => {
  // console.log('Generating schema from data:', data);
  
  try {
    validateInputData(data);

    const isArray = Array.isArray(data);
    const dataToAnalyze = isArray ? data[0] : data;
    
    const generatePropertySchema = (value, path = '') => {
      try {
        if (value === null) return { type: SchemaType.NULL };
        
        if (Array.isArray(value)) {
          if (value.length === 0) {
            throw new SchemaGenerationError(`Empty array found at path: ${path}`);
          }
          const items = generatePropertySchema(value[0], `${path}[0]`);
          return { type: SchemaType.ARRAY, items };
        }
        
        if (typeof value === 'object' && value !== null) {
          const properties = {};
          const required = [];
          
          Object.entries(value).forEach(([key, val]) => {
            try {
              properties[key] = generatePropertySchema(val, `${path}.${key}`);
              if (val !== null && val !== undefined) {
                required.push(key);
              }
            } catch (error) {
              throw new SchemaGenerationError(
                `Error processing property '${key}' at path '${path}'`,
                { originalError: error.message }
              );
            }
          });
          
          return { 
            type: SchemaType.OBJECT, 
            properties, 
            required: required.length > 0 ? required : undefined 
          };
        }
        
        return { 
          type: typeof value === 'number' ? SchemaType.NUMBER : SchemaType.STRING 
        };
      } catch (error) {
        throw new SchemaGenerationError(
          `Error generating schema at path: ${path}`,
          { originalError: error.message }
        );
      }
    };

    const schema = generatePropertySchema(dataToAnalyze);
    
    validateGeneratedSchema(schema);

    return {
      schema,
      isArray,
      originalType: isArray ? 'array' : typeof dataToAnalyze
    };
  } catch (error) {
    if (error instanceof SchemaGenerationError || error instanceof SchemaValidationError) {
      throw error;
    }
    throw new SchemaGenerationError(
      'Failed to generate schema',
      { originalError: error.message }
    );
  }
};

// const validateSchema = (schema, data) => {
//   try {
//     const ajv = new Ajv();
    
//     // If only schema is provided, validate schema structure
//     if (typeof data === 'undefined') {
//       const valid = ajv.validateSchema(schema);
//       return {
//         valid,
//         errors: valid ? [] : ajv.errors
//       };
//     }

//     // If both schema and data are provided, validate data against schema
//     const validate = ajv.compile(schema);
//     const valid = validate(data);
//     return {
//       valid,
//       errors: valid ? [] : validate.errors
//     };
//   } catch (error) {
//     console.error('Schema validation error:', error);
//     return {
//       valid: false,
//       errors: [{ message: error.message }]
//     };
//   }
// };

// DynamoDB Operations
const insertSchemaData = async ({ tableName, item }) => {
  if (!tableName || !item) throw new Error('tableName and item are required');
  await docClient.send(new PutCommand({ TableName: tableName, Item: item }));
  return { success: true };
};

const createSchemasTable = async ({ schemaId, accountId, methodName, tableName }) => {
  if (!schemaId || !accountId || !methodName) throw new Error('schemaId, accountId, and methodName are required');

  // Fetch account and namespace to generate table name if not provided
  const accountRes = await docClient.send(new GetCommand({ TableName: 'brmh-namespace-accounts', Key: { id: accountId } }));
  if (!accountRes.Item) throw new Error('Account not found');
  const account = accountRes.Item.data;
  const namespaceId = account['namespace-id'];
  const nsRes = await docClient.send(new GetCommand({ TableName: 'brmh-namespace', Key: { id: namespaceId } }));
  if (!nsRes.Item) throw new Error('Namespace not found');
  const namespace = nsRes.Item.data;
  const generatedTableName = tableName || `${namespace['namespace-name']}-${account['namespace-account-name']}-${methodName}`.replace(/\s+/g, '-').toLowerCase();

  // Create DynamoDB table if not exists
  let tableStatus = TableStatus.ACTIVE;
  const params = {
    TableName: generatedTableName,
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST'
  };
  try {
    await client.send(new CreateTableCommand(params));
  } catch (error) {
    if (error.name === 'ResourceInUseException') {
      tableStatus = TableStatus.ACTIVE;
    } else {
      tableStatus = TableStatus.INACTIVE;
      throw error;
    }
  }

  // Save meta-data
  const metaId = uuidv4();
  const timestamp = new Date().toISOString();
  const metaItem = {
    TableName: 'brmh-schema-table-data',
    Item: {
      id: metaId,
      schemaId,
      accountId,
      methodName,
      tableName: generatedTableName,
      status: tableStatus,
      createdAt: timestamp,
      details: {
        message: 'Table created for schema',
        schemaId,
        accountId,
        methodName,
        tableName: generatedTableName
      }
    }
  };
    await docClient.send(new PutCommand(metaItem));

  // Update account's tableName mapping
  const tableNameMap = account.tableName || {};
  tableNameMap[methodName] = generatedTableName;
  await docClient.send(new UpdateCommand({
    TableName: 'brmh-namespace-accounts',
    Key: { id: accountId },
    UpdateExpression: 'SET #data.#tableName = :tableName',
    ExpressionAttributeNames: { '#data': 'data', '#tableName': 'tableName' },
    ExpressionAttributeValues: { ':tableName': tableNameMap }
  }));

  // Do NOT update method with tableName

  return { message: 'Table created successfully', tableName: generatedTableName, schemaId, accountId, methodName };
};

const deleteSchemasTable = async (tableName = 'brmh-schemas') => {
  const params = {
    TableName: tableName
  };

  try {
    await client.send(new DeleteTableCommand(params));
    return { message: 'Table deleted successfully', tableName };
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      throw new Error('Table does not exist');
    }
    throw new Error(`Failed to delete table: ${error.message}`);
  }
};

// Schema CRUD Operations
const saveSchema = async (c, req, res) => {
  try {
    const {
      methodId,
      schemaName,
      methodName,
      namespaceId,
      schemaType,
      schema,
      isArray,
      originalType,
      url
    } = c.request.requestBody;

    // Generate a unique schema ID
    const schemaId = uuidv4();

    // Create schema object with default values for optional fields
    const schemaData = {
      id: schemaId,
      methodId: methodId || null,
      schemaName: schemaName,
      methodName: methodName || null,
      namespaceId: namespaceId || null,
      schemaType: schemaType || 'object',
      schema: schema || {},
      isArray: isArray || false,
      originalType: originalType || schemaType || 'object',
      url: url || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Save to DynamoDB
    await docClient.send(new PutCommand({
      TableName: 'brmh-schemas',
      Item: schemaData
    }));

    // Update namespace's schemaIds array (only if namespace exists)
    if (namespaceId) {
      try {
        await updateNamespace(namespaceId, { schemaId });
      } catch (error) {
        console.log(`Warning: Could not update namespace ${namespaceId}: ${error.message}`);
        // Continue with schema creation even if namespace update fails
      }
    }

    return {
      statusCode: 200,
      body: { schemaId }
    };
  } catch (error) {
    console.error('Schema creation error:', error);
    return {
      statusCode: 500,
      body: { error: 'Failed to create schema', details: error.message }
    };
  }
};

const getSchema = async (schemaId) => {
  try {
    if (!schemaId) {
      throw new Error('schemaId is required');
    }

    const result = await docClient.send(new GetCommand({
      TableName: 'brmh-schemas',
      Key: { id: schemaId }
    }));

    if (!result.Item) {
      throw new Error('Schema not found');
    }

    return result.Item;
  } catch (error) {
    throw new Error(`Failed to get schema: ${error.message}`);
  }
};

const updateSchema = async (schemaId, updates) => {
  try {
    if (!schemaId) {
      throw new Error('schemaId is required');
    }

    const existingSchema = await getSchema(schemaId);
    if (!existingSchema) {
      throw new Error('Schema not found');
    }

    const timestamp = new Date().toISOString();

    let updateExp = [];
    let expAttrNames = {};
    let expAttrValues = {};

    if ('schema' in updates) {
      updateExp.push('#schema = :schema');
      expAttrNames['#schema'] = 'schema';
      expAttrValues[':schema'] = updates.schema;
    }
    if ('isArray' in updates) {
      updateExp.push('#isArray = :isArray');
      expAttrNames['#isArray'] = 'isArray';
      expAttrValues[':isArray'] = updates.isArray;
    }
    if ('originalType' in updates) {
      updateExp.push('#originalType = :originalType');
      expAttrNames['#originalType'] = 'originalType';
      expAttrValues[':originalType'] = updates.originalType;
    }
    if ('schemaName' in updates) {
      updateExp.push('#schemaName = :schemaName');
      expAttrNames['#schemaName'] = 'schemaName';
      expAttrValues[':schemaName'] = updates.schemaName;
    }
    if ('url' in updates) {
      updateExp.push('#url = :url');
      expAttrNames['#url'] = 'url';
      expAttrValues[':url'] = updates.url;
    }

    if (updateExp.length === 0) {
      throw new Error('No valid updates provided');
    }

    updateExp.push('#updatedAt = :updatedAt');
    expAttrNames['#updatedAt'] = 'updatedAt';
    expAttrValues[':updatedAt'] = timestamp;

    const result = await docClient.send(new UpdateCommand({
      TableName: 'brmh-schemas',
      Key: { id: schemaId },
      UpdateExpression: 'SET ' + updateExp.join(', '),
      ExpressionAttributeNames: expAttrNames,
      ExpressionAttributeValues: expAttrValues,
      ReturnValues: 'ALL_NEW'
    }));

    return result.Attributes;
  } catch (error) {
    throw new Error(`Failed to update schema: ${error.message}`);
  }
};

const deleteSchema = async (schemaId) => {
  try {
    if (!schemaId) {
      throw new Error('schemaId is required');
    }

    const existingSchema = await getSchema(schemaId);
    if (!existingSchema) {
      throw new Error('Schema not found');
    }

    await docClient.send(new DeleteCommand({
      TableName: 'brmh-schemas',
      Key: { id: schemaId }
    }));
  } catch (error) {
    throw new Error(`Failed to delete schema: ${error.message}`);
  }
};

const listSchemas = async () => {
  try {
    const result = await docClient.send(new ScanCommand({
      TableName: 'brmh-schemas'
    }));
    return result.Items || [];
  } catch (error) {
    throw new Error(`Failed to list schemas: ${error.message}`);
  }
};

// Table Management Operations
const listSchemaTableMeta = async () => {
  try {
    const result = await docClient.send(new ScanCommand({
      TableName: 'brmh-schema-table-data'
    }));
    return result.Items || [];
  } catch (error) {
    throw new Error(`Failed to list schema table metadata: ${error.message}`);
  }
};

const getSchemaTableMeta = async (metaId) => {
  const result = await docClient.send(new GetCommand({
    TableName: 'brmh-schema-table-data',
    Key: { id: metaId }
  }));
  return result.Item;
};

const checkAndUpdateTableStatus = async (metaId) => {
  const meta = await docClient.send(new GetCommand({
    TableName: 'brmh-schema-table-data',
    Key: { id: metaId }
  }));
  if (!meta.Item) throw new Error('Meta not found');
  const tableName = meta.Item.tableName;

  let status = TableStatus.INACTIVE;
  try {
    const result = await client.send(new DescribeTableCommand({ TableName: tableName }));
    if (result.Table && result.Table.TableStatus === 'ACTIVE') {
      status = TableStatus.ACTIVE;
    }
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') throw err;
  }

  if (meta.Item.status !== status) {
    await docClient.send(new UpdateCommand({
      TableName: 'brmh-schema-table-data',
      Key: { id: metaId },
      UpdateExpression: 'SET #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': status }
    }));
  }

  return { id: metaId, tableName, status };
};

const getTableItems = async (tableName) => {
  if (!tableName) throw new Error('tableName is required');
  try {
    const result = await docClient.send(new ScanCommand({ TableName: tableName }));
    return result.Items || [];
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      return [];
    }
    throw error;
  }
};

const getSchemaByTableName = async (tableName) => {
  const metaResult = await docClient.send(new ScanCommand({
    TableName: 'brmh-schema-table-data',
    FilterExpression: 'tableName = :tn',
    ExpressionAttributeValues: { ':tn': tableName }
  }));
  if (!metaResult.Items || metaResult.Items.length === 0) throw new Error('Table meta not found');
  const schemaId = metaResult.Items[0].schemaId;
  const schemaResult = await docClient.send(new GetCommand({
    TableName: 'brmh-schemas',
    Key: { id: schemaId }
  }));
  if (!schemaResult.Item) throw new Error('Schema not found');
  return schemaResult.Item.schema;
};

const checkAllTableStatuses = async () => {
  const metaItems = await listSchemaTableMeta();
  let updated = 0;
  let inactiveTables = [];
  for (const meta of metaItems) {
    const tableName = meta.tableName;
    let isActive = true;
    try {
      await client.send(new DescribeTableCommand({ TableName: tableName }));
    } catch (err) {
      if (err.name === 'ResourceNotFoundException') {
        isActive = false;
      } else {
        throw err;
      }
    }
    if (!isActive && meta.status !== TableStatus.TABLE_DELETED) {
      await docClient.send(new UpdateCommand({
        TableName: 'brmh-schema-table-data',
        Key: { id: meta.id },
        UpdateExpression: 'SET #status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': TableStatus.TABLE_DELETED }
      }));
      updated++;
      inactiveTables.push(tableName);
    }
  }
  return { updated, inactiveTables };
};

// Table validation function
const validateTableExists = async (tableName) => {
  try {
    if (!tableName || typeof tableName !== 'string' || !tableName.trim()) {
      return { exists: false, error: 'Table name is required' };
    }

    const trimmedTableName = tableName.trim();
    
    // Validate table name format (DynamoDB naming rules)
    if (!/^[a-zA-Z0-9._-]+$/.test(trimmedTableName)) {
      return { 
        exists: false, 
        error: 'Table name can only contain letters, numbers, dots, hyphens, and underscores' 
      };
    }

    if (trimmedTableName.length < 3 || trimmedTableName.length > 255) {
      return { 
        exists: false, 
        error: 'Table name must be between 3 and 255 characters' 
      };
    }

    // Check if table exists in DynamoDB
    await client.send(new DescribeTableCommand({ TableName: trimmedTableName }));
    return { exists: true, tableName: trimmedTableName };
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      return { 
        exists: false, 
        error: `Table '${tableName}' does not exist in DynamoDB` 
      };
    }
    return { 
      exists: false, 
      error: `Failed to validate table: ${error.message}` 
    };
  }
};

// Ensure executions table exists
const ensureExecutionsTable = async () => {
  try {
    // Check if table exists
    try {
      await client.send(new DescribeTableCommand({ TableName: 'executions' }));
      // console.log('Executions table exists');
      return true;
    } catch (error) {
      if (error.name !== 'ResourceNotFoundException') {
        throw error;
      }
    }

    // Create table if it doesn't exist
    // console.log('Creating executions table...');
    const params = {
      TableName: 'executions',
      KeySchema: [
        { AttributeName: 'exec-id', KeyType: 'HASH' },
        { AttributeName: 'child-exec-id', KeyType: 'RANGE' }
      ],
      AttributeDefinitions: [
        { AttributeName: 'exec-id', AttributeType: 'S' },
        { AttributeName: 'child-exec-id', AttributeType: 'S' }
      ],
      BillingMode: 'PAY_PER_REQUEST'
    };

    await client.send(new CreateTableCommand(params));
    // console.log('Executions table created successfully');
    return true;
  } catch (error) {
    console.error('Error ensuring executions table:', error);
    return false;
  }
};

// Call ensureExecutionsTable when the module loads
ensureExecutionsTable().catch(console.error);

const executeNamespaceRequest = async ({ method, url, queryParams, headers, body, save }) => {
  // console.log('Executing request with params:', {
  //   method,
  //   url
  // });

  const execId = uuidv4();
  
  try {
    // Build URL with query parameters
    const urlObj = new URL(url);
    Object.entries(queryParams).forEach(([key, value]) => {
      if (key && value && key.trim() !== '') {
        urlObj.searchParams.append(key.trim(), value.toString().trim());
      }
    });

    // console.log('Final URL:', urlObj.toString());

    // Make the request
    const response = await axios({
      method: method.toUpperCase(),
      url: urlObj.toString(),
      headers: headers,
      data: body,
      validateStatus: () => true // Don't throw on any status
    });

    // console.log('Response received:', {
    //   status: response.status,
    //   statusText: response.statusText
    // });

    // Always save execution log
    await saveSingleExecutionLog({
      execId,
      method,
      url: urlObj.toString(),
      queryParams,
      headers,
      responseStatus: response.status,
    });

    // Only save data to a user table if save is true (add your logic here if needed)
    if (save) {
      // ... your data-saving logic here ...
    }

    // Handle authentication errors specifically
    if (response.status === 401 || response.status === 403) {
      return {
        statusCode: response.status,
        body: {
          error: 'Authentication Failed',
          status: response.status,
          statusText: response.statusText,
          details: response.data,
          suggestions: [
            'Check if the authentication token/key is correct and complete',
            'Verify the token has not expired',
            'Ensure the token has the necessary permissions',
            'Verify you are using the correct authentication method'
          ]
        }
      };
    }

    // Handle other errors
    if (response.status >= 400) {
      return {
        statusCode: response.status,
        body: {
          error: 'API Request Failed',
          status: response.status,
          statusText: response.statusText,
          details: response.data
        }
      };
    }

    return {
      statusCode: response.status,
      body: response.data
    };
  } catch (error) {
    console.error('Request execution error:', {
      message: error.message,
      code: error.code
    });

    // Handle specific error types
    if (error.code === 'ECONNREFUSED') {
      return {
        statusCode: 500,
        body: {
          error: 'Connection Failed',
          details: 'Could not connect to the server. The service might be down or the URL might be incorrect.',
          code: error.code
        }
      };
    }

    return {
      statusCode: 500,
      body: { 
        error: 'Failed to execute request',
        details: error.message,
        code: error.code,
        suggestions: [
          'Verify the URL is correct and accessible',
          'Check if all required headers are properly formatted',
          'Verify the HTTP method is supported',
          'Ensure the request body is properly formatted (if applicable)',
          'Check your network connection'
        ]
      }
    };
  }
};

// Helper to extract string from DynamoDB-style id or plain id
const extractIdString = (id) => {
  if (typeof id === 'object' && id !== null && 'S' in id) return id.S;
  return id?.toString?.() || '';
};

const executeNamespacePaginatedRequest = async (c, req, res) => {
  const { 
    method, 
    url, 
    maxIterations: requestMaxIterations = null,
    queryParams = {}, 
    headers = {}, 
    body = null,
    tableName,
    saveData,
    paginationType = 'auto' // Add paginationType parameter
  } = c.request.requestBody;

  // Explicitly handle maxIterations to ensure null values are preserved
  const maxIterations = requestMaxIterations;

  let currentUrl = url;
  let lastError = null;
  const execId = uuidv4();
  let executionLogs;

  try {
    // Initialize execution logs
    executionLogs = await savePaginatedExecutionLogs({
      execId,
      method,
      url,
      queryParams,
      headers,
      maxIterations,
      tableName,
      saveData
    });

    if (!executionLogs) {
      throw new Error('Failed to initialize execution logs');
    }

    // Check if this is a sync request
    if (paginationType === 'sync') {
      // Forward the request to the lambda function
      const lambdaUrl = 'https://tyjnnizbri.execute-api.us-east-1.amazonaws.com/default/sync-paginated';
      
      try {
        const lambdaResponse = await axios.post(lambdaUrl, {
          tableName,
          url,
          headers,
          idField: c.request.requestBody.idField || 'id',
          stopOnExisting: c.request.requestBody.stopOnExisting || false,
          nextPageIn: c.request.requestBody.nextPageIn || 'header',
          nextPageField: c.request.requestBody.nextPageField || 'link',
          isAbsoluteUrl: c.request.requestBody.isAbsoluteUrl !== undefined ? c.request.requestBody.isAbsoluteUrl : true,
          maxPages: c.request.requestBody.maxPages || 200,
          ...(c.request.requestBody.tokenParam && { tokenParam: c.request.requestBody.tokenParam })
        }, {
          headers: { 'Content-Type': 'application/json' }
        });

        return {
          statusCode: 200,
          body: {
            status: 200,
            data: lambdaResponse.data,
            executionId: execId,
            timestamp: new Date().toISOString()
          }
        };
      } catch (error) {
        console.error('Lambda sync error:', error);
        return {
          statusCode: 500,
          body: {
            error: 'Failed to execute sync request',
            details: error.message,
            executionId: execId
          }
        };
      }
    }

    // Return immediately with execution ID and initial status
    const initialResponse = {
      statusCode: 200,
      body: {
        status: 200,
        data: {
          executionId: execId,
          status: 'initialized',
          method,
          url,
          maxIterations,
          timestamp: new Date().toISOString()
        }
      }
    };

    // Start processing in the background
    (async () => {
      try {
        const pages = [];
        let pageCount = 1;
        let hasMorePages = true;
        let detectedPaginationType = null;
        let totalItemsProcessed = 0;
        let grandTotal = 0;

        // Initial logging
        console.log(`\n🚀 [STARTING] PAGINATED operation`);
        console.log(`📋 [Config] Table: ${tableName}, URL: ${url}`);
        console.log(`⚙️  [Settings] Max Iterations: ${maxIterations || 'Infinite'}, Save Data: ${saveData}`);
        console.log(`🔍 [Pagination] Type: ${paginationType}, Method: ${method}`);

        // Update parent execution status to inProgress
        await executionLogs.updateParentStatus('inProgress', false);

        // Function to save items to DynamoDB
        async function saveItemsToDynamoDB(items, pageData, grandTotalObj) {
          const savedIds = [];
          let pageSavedCount = 0;
          let pageSkippedCount = 0;
          
          console.log(`\n🔄 [Page ${pageCount}] Processing ${items.length} items for DynamoDB`);
          
          // Get table schema to determine partition key
          let partitionKey = 'id'; // default
          try {
            const desc = await client.send(new DescribeTableCommand({ TableName: tableName }));
            const keySchema = desc.Table?.KeySchema;
            partitionKey = keySchema?.find(k => k.KeyType === "HASH")?.AttributeName || 'id';
          } catch (error) {
            console.warn(`⚠️  [Page ${pageCount}] Could not get table schema, using default partition key: ${partitionKey}`);
          }
          
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            
            // Extract ID from item (same logic as execute.js)
            const itemId = item.id || item.Id || item.ID || item._id || 
                          item.pin_id || item.board_id || 
                          item.order_id || item.product_id ||
                          `generated_${uuidv4()}`;
            
            const finalItemId = itemId?.toString();
            if (!finalItemId) {
              console.log(`⚠️  [Page ${pageCount}] Skipped item without ID: ${JSON.stringify(item).substring(0, 100)}...`);
              continue;
            }
            
            try {
              // Save item directly to DynamoDB (same as execute.js)
              await docClient.send(new PutCommand({
                TableName: tableName,
                Item: {
                  ...item,
                  [partitionKey]: finalItemId
                }
              }));
              
              savedIds.push(finalItemId);
              pageSavedCount++;
              
              // Live saving progress
              console.log(`💾 [Page ${pageCount}] Saved item ${finalItemId} (${pageSavedCount}/${items.length} on this page, ${savedIds.length} total saved)`);
              
              if (grandTotalObj && typeof grandTotalObj.count === 'number') {
                grandTotalObj.count++;
              }
              
            } catch (error) {
              console.error(`❌ [Page ${pageCount}] Error saving item ${finalItemId}:`, error.message);
              pageSkippedCount++;
            }
          }
          
          // Log page completion stats
          console.log(`✅ [Page ${pageCount}] DynamoDB Save Completed: ${pageSavedCount} saved, ${pageSkippedCount} skipped`);
          console.log(`📈 [Running Total] Total Saved: ${savedIds.length}`);
          
          return savedIds;
        }

        // Function to detect pagination type from response
        const detectPaginationType = (response) => {
          // Check for Link header pagination (Shopify style)
          if (response.headers.link && response.headers.link.includes('rel="next"')) {
            return 'link';
          }
          
          // Check for bookmark pagination (Pinterest style)
          if (response.data && response.data.bookmark) {
            return 'bookmark';
          }

          // Check for cursor-based pagination
          if (response.data && (response.data.next_cursor || response.data.cursor)) {
            return 'cursor';
          }

          // Check for offset/limit pagination
          if (response.data && (response.data.total_count !== undefined || response.data.total !== undefined)) {
            return 'offset';
          }

          // Check for empty response or no more items
          if (!response.data || 
              (Array.isArray(response.data) && response.data.length === 0) ||
              (response.data.data && Array.isArray(response.data.data) && response.data.data.length === 0) ||
              (response.data.items && Array.isArray(response.data.items) && response.data.items.length === 0)) {
            return 'end';
          }

          return null;
        };

        // Extract next URL from Link header (Shopify)
        const extractNextUrl = (linkHeader) => {
          if (!linkHeader) return null;
          const matches = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
          return matches ? matches[1] : null;
        };

        // Extract bookmark from response (Pinterest)
        const extractBookmark = (responseData) => {
          if (!responseData) return null;
          return responseData.bookmark || null;
        };

        // Extract cursor from response
        const extractCursor = (responseData) => {
          if (!responseData) return null;
          return responseData.next_cursor || responseData.cursor || null;
        };

        // Set the current URL for pagination
        let currentUrl = url;

        let grandTotalObj = { count: 0 };

        // Main pagination loop - will run until no more pages or maxIterations is reached
        while (hasMorePages && (maxIterations === null || pageCount <= maxIterations)) {
          // console.log(`\n=== PAGE ${pageCount} START ===`);
          // console.log('Current pagination state:', {
          //   pageCount,
          //   maxIterations,
          //   hasMorePages,
          //   condition: maxIterations === null ? 'infinite' : `${pageCount} <= ${maxIterations}`
          // });
          
          // Build URL with query parameters
          const urlObj = new URL(currentUrl);
          
          // Only add query parameters if they're not already in the URL and it's the first page
          if (pageCount === 1) {
            Object.entries(queryParams).forEach(([key, value]) => {
              if (value && !urlObj.searchParams.has(key)) {
                urlObj.searchParams.append(key, value);
              }
            });
          }

          // Make request
          console.log(`\n🔄 [Page ${pageCount}] Fetching data from: ${urlObj.toString()}`);
          const response = await axios({
            method: method.toUpperCase(),
            url: urlObj.toString(),
            headers: headers,
            data: !['GET', 'HEAD'].includes(method.toUpperCase()) ? body : undefined,
            validateStatus: () => true
          });

          // console.log('Response received:', {
          //   status: response.status,
          //   statusText: response.statusText,
          //   headers: response.headers,
          //   dataLength: response.data ? JSON.stringify(response.data).length : 0,
          //   data: response.data
          // });

          // Handle API errors
          if (response.status >= 400) {
            lastError = {
              status: response.status,
              statusText: response.statusText,
              data: response.data,
              url: urlObj.toString()
            };
            // console.error(`\nAPI Error on page ${pageCount}:`, lastError);
            
            // For Shopify API, check if it's a rate limit error
            if (response.status === 429 || 
                (response.data && 
                 response.data.errors && 
                 (Array.isArray(response.data.errors) ? 
                   response.data.errors.some(err => err.includes('rate limit')) :
                   response.data.errors.toString().includes('rate limit')))) {
              // console.log('Rate limit detected, waiting before retry...');
              await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
              continue; // Retry the same page
            }
            
            // For other errors, stop pagination
            hasMorePages = false;
            break;
          }

          // Detect pagination type on first request if not specified
          if (pageCount === 1) {
            detectedPaginationType = detectPaginationType(response);
            // console.log('Detected pagination type:', detectedPaginationType);
          }

          // Process response data
          let currentPageItems = [];
          if (response.data) {
            // Handle different response structures
            if (Array.isArray(response.data)) {
              currentPageItems = response.data;
            } else if (response.data.data && Array.isArray(response.data.data)) {
              currentPageItems = response.data.data;
            } else if (response.data.items && Array.isArray(response.data.items)) {
              currentPageItems = response.data.items;
            } else if (response.data.orders && Array.isArray(response.data.orders)) {
              currentPageItems = response.data.orders;
            } else if (response.data.products && Array.isArray(response.data.products)) {
              currentPageItems = response.data.products;
            } else {
              currentPageItems = [response.data];
            }

            console.log(`📊 [Page ${pageCount}] Found ${currentPageItems.length} items in this page`);
          }

          // Extract IDs from items
          const itemIds = currentPageItems.map(item => {
            const id = item.id || item.Id || item.ID || item._id || 
                      item.pin_id || item.board_id || 
                      item.order_id || item.product_id ||
                      `generated_${uuidv4()}`;
            return extractIdString(id);
          });

          // console.log('Extracted item IDs:', {
          //   count: itemIds.length,
          //   sampleIds: itemIds.slice(0, 5)
          // });

          // After processing each page's items
          if (currentPageItems.length > 0) {
            // Update total items processed
            totalItemsProcessed += currentPageItems.length;
            
            // Save child execution log with the item IDs
            await executionLogs.saveChildExecution({
              pageNumber: pageCount,
              totalItemsProcessed,
              itemsInCurrentPage: currentPageItems.length,
              url: urlObj.toString(),
              status: response.status,
              paginationType: detectedPaginationType || 'none',
              isLast: !hasMorePages || (maxIterations !== null && pageCount === maxIterations),
              itemIds: itemIds // Pass the extracted item IDs directly
            });
            
            // Save items to DynamoDB if saveData is true
            if (saveData && tableName) {
              // console.log(`Attempting to save ${currentPageItems.length} items to DynamoDB...`);
              const pageData = {
                url: urlObj.toString(),
                status: response.status
              };
              
              const savedIds = await saveItemsToDynamoDB(currentPageItems, pageData, grandTotalObj);
              grandTotal += savedIds.length;
              // console.log(`Saved ${savedIds.length} items to DynamoDB`);
            }
          }

          // Check for next page based on detected pagination type
          if (detectedPaginationType === 'link') {
            const nextUrl = extractNextUrl(response.headers.link);
            if (!nextUrl) {
              hasMorePages = false;
              console.log(`🏁 [Page ${pageCount}] No more pages (Link header) - pagination complete`);
            } else {
              // For Shopify, we need to handle page_info parameter correctly
              const nextUrlObj = new URL(nextUrl);
              // Only remove status parameter, keep limit
              nextUrlObj.searchParams.delete('status');
              // Add limit parameter if it's not already present
              if (!nextUrlObj.searchParams.has('limit') && queryParams.limit) {
                nextUrlObj.searchParams.append('limit', queryParams.limit);
              }
              currentUrl = nextUrlObj.toString();
              console.log(`🔗 [Page ${pageCount}] Next page URL found: ${currentUrl}`);
            }
          } else if (detectedPaginationType === 'bookmark') {
            const bookmark = extractBookmark(response.data);
            if (!bookmark) {
              hasMorePages = false;
              console.log(`🏁 [Page ${pageCount}] No more pages (Bookmark) - pagination complete`);
            } else {
              urlObj.searchParams.set('bookmark', bookmark);
              currentUrl = urlObj.toString();
              console.log(`🔗 [Page ${pageCount}] Next page bookmark: ${bookmark}`);
            }
          } else if (detectedPaginationType === 'cursor') {
            const cursor = extractCursor(response.data);
            if (!cursor) {
              hasMorePages = false;
              console.log(`🏁 [Page ${pageCount}] No more pages (Cursor) - pagination complete`);
            } else {
              urlObj.searchParams.set('cursor', cursor);
              currentUrl = urlObj.toString();
              console.log(`🔗 [Page ${pageCount}] Next page cursor: ${cursor}`);
            }
          } else if (detectedPaginationType === 'offset') {
            const totalCount = response.data.total_count || response.data.total;
            const currentOffset = parseInt(urlObj.searchParams.get('offset') || '0');
            const limit = parseInt(urlObj.searchParams.get('limit') || '10');
            
            if (currentOffset + limit >= totalCount) {
              hasMorePages = false;
              console.log(`🏁 [Page ${pageCount}] No more pages (Offset) - pagination complete`);
            } else {
              urlObj.searchParams.set('offset', (currentOffset + limit).toString());
              currentUrl = urlObj.toString();
              console.log(`🔗 [Page ${pageCount}] Next page offset: ${currentOffset + limit}`);
            }
          } else if (detectedPaginationType === 'end') {
            hasMorePages = false;
            console.log(`🏁 [Page ${pageCount}] No more pages (End) - pagination complete`);
          } else {
            hasMorePages = false;
            console.log(`🏁 [Page ${pageCount}] No pagination detected - pagination complete`);
          }

          // console.log(`\n=== PAGE ${pageCount} SUMMARY ===`);
          // console.log({
          //   status: response.status,
          //   hasMorePages,
          //   totalItemsProcessed,
          //   currentPageItems: currentPageItems.length,
          //   nextUrl: currentUrl,
          //   paginationType: detectedPaginationType,
          //   responseData: response.data
          // });

          pageCount++;
        }

        // Update parent execution status to completed
        await executionLogs.updateParentStatus('completed', true);

        // Log final summary
        console.log(`\n🎉 [COMPLETED] All pages processed successfully!`);
        console.log(`📊 [Final Stats] Pages Scanned: ${pageCount - 1}, Total Items: ${totalItemsProcessed}, Total Saved: ${grandTotalObj.count}`);
        console.log(`🔍 [Pagination] Type: ${detectedPaginationType || 'none'}, Execution ID: ${execId}`);

      } catch (error) {
        console.error('Background processing error:', error);
        if (executionLogs) {
          await executionLogs.updateParentStatus('error', true);
        }
      }
    })();

    return initialResponse;

  } catch (error) {
    console.error('\n=== PAGINATED REQUEST FAILED ===');
    console.error({
      message: error.message,
      code: error.code,
      stack: error.stack,
      request: {
        url: currentUrl,
        method,
        headers
      }
    });

    return {
      statusCode: 500,
      body: { 
        error: 'Failed to execute paginated request',
        details: error.message,
        code: error.code,
        lastError: lastError
      }
    };
  }
};

// Namespace Operations
const getNamespacesRaw = async () => {
  try {
    const response = await docClient.send(new ScanCommand({
      TableName: 'brmh-namespace'
    }));
    if (!response.Items) {
      return [];
    }
    
    const namespaces = response.Items.map(item => item.data);
    
    // Convert S3 URLs to backend API URLs for serving icons
    namespaces.forEach(namespace => {
      if (namespace['icon-url']) {
        // Extract the S3 key from the URL
        const urlParts = namespace['icon-url'].split('/');
        const s3Key = urlParts.slice(3).join('/');
        // Convert to backend API URL
        namespace['icon-url'] = `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5001'}/api/icon/${encodeURIComponent(s3Key)}`;
      }
    });
    
    return namespaces;
  } catch (error) {
    throw new Error(`Failed to get namespaces: ${error.message}`);
  }
};

const getNamespaces = async (c, req, res) => {
  try {
    const namespaces = await getNamespacesRaw();
    return {
      statusCode: 200,
      body: namespaces
    };
  } catch (error) {
    console.error('[Unified] getNamespaces failed:', error);
    // Be resilient: do not break the UI. Return an empty list when scan fails.
    return {
      statusCode: 200,
      body: []
    };
  }
};

const getNamespaceById = async (namespaceId) => {
  try {
    const response = await docClient.send(new GetCommand({
      TableName: 'brmh-namespace',
      Key: { id: namespaceId }
    }));

    if (!response.Item) {
      return null;
    }

    return response.Item.data;
  } catch (error) {
    throw new Error(`Failed to get namespace: ${error.message}`);
  }
};


const createNamespace = async (namespaceData, iconFile = null) => {
  try {
    console.log('=== CREATE NAMESPACE DEBUG ===');
    console.log('namespaceData:', namespaceData);
    console.log('iconFile:', iconFile);
    console.log('iconFile type:', typeof iconFile);
    
    const namespaceId = uuidv4();
    let iconUrl = null;
    let folderPath = null;

    // Create namespace folder in S3
    try {
      console.log('Creating namespace folder in S3...');
      const folderResult = await createNamespaceFolder(namespaceId, namespaceData['namespace-name']);
      folderPath = folderResult.folderPath;
      console.log('✅ Namespace folder created:', folderPath);
    } catch (folderError) {
      console.error('❌ Failed to create namespace folder:', folderError);
      // Continue with namespace creation even if folder creation fails
      // This ensures the namespace is still created
    }

    // Upload icon if provided
    if (iconFile) {
      console.log('Icon file provided, uploading to S3...');
      iconUrl = await uploadNamespaceIcon(namespaceId, iconFile);
    } else {
      console.log('No icon file provided');
    }

    const item = {
      id: namespaceId,
      type: 'namespace',
      data: {
        'namespace-id': namespaceId,
        'namespace-name': namespaceData['namespace-name'],
        'namespace-url': namespaceData['namespace-url'],
        'icon-url': iconUrl,
        'folder-path': folderPath, // Store the folder path
        'tags': namespaceData['tags'] || [],
        'namespace-accounts': [],
        'namespace-methods': []
      }
    };

    await docClient.send(new PutCommand({
      TableName: 'brmh-namespace',
      Item: item
    }));

    console.log('✅ Namespace created successfully with folder path:', folderPath);
    return item.data;
  } catch (error) {
    throw new Error(`Failed to create namespace: ${error.message}`);
  }
};

const updateNamespace = async (namespaceId, updates, iconFile = null) => {
  try {
    const existingNamespace = await getNamespaceById(namespaceId);
    if (!existingNamespace) {
      throw new Error('Namespace not found');
    }

    // Handle icon upload if provided
    let iconUrl = existingNamespace['icon-url'];
    if (iconFile) {
      // Delete old icon if exists
      if (iconUrl) {
        await deleteNamespaceIcon(iconUrl);
      }
      // Upload new icon
      iconUrl = await uploadNamespaceIcon(namespaceId, iconFile);
    }

    // Check if namespace name is being updated
    let folderPath = existingNamespace['folder-path'];
    if (updates['namespace-name'] && updates['namespace-name'] !== existingNamespace['namespace-name']) {
      try {
        console.log('Namespace name changed, updating folder path...');
        const folderResult = await createNamespaceFolder(namespaceId, updates['namespace-name']);
        folderPath = folderResult.folderPath;
        console.log('✅ Updated namespace folder path:', folderPath);
      } catch (folderError) {
        console.error('❌ Failed to update namespace folder:', folderError);
        // Continue with namespace update even if folder update fails
      }
    }

    // Merge all fields from updates into existingNamespace
    let updatedData = {
      ...existingNamespace,
      ...updates,
      'icon-url': iconUrl,
      'folder-path': folderPath // Ensure folder path is included
    };

    // Handle schemaIds as an array, append if new
    if (updates.schemaId) {
      const currentSchemaIds = Array.isArray(existingNamespace.schemaIds) ? existingNamespace.schemaIds : [];
      updatedData.schemaIds = [...currentSchemaIds, updates.schemaId];
      delete updatedData.schemaId;
    } else if (Array.isArray(updates.schemaIds)) {
      updatedData.schemaIds = updates.schemaIds;
    }

    // Clean undefined values from updatedData to avoid DynamoDB marshalling errors
    const cleanedData = JSON.parse(JSON.stringify(updatedData));

    await docClient.send(new UpdateCommand({
      TableName: 'brmh-namespace',
      Key: { id: namespaceId },
      UpdateExpression: 'SET #data = :data',
      ExpressionAttributeNames: { '#data': 'data' },
      ExpressionAttributeValues: { ':data': cleanedData }
    }));

    return cleanedData;
  } catch (error) {
    throw new Error(`Failed to update namespace: ${error.message}`);
  }
};

const deleteNamespace = async (namespaceId) => {
  try {
    console.log(`🗑️ Starting cascade deletion for namespace: ${namespaceId}`);
    
    // Get namespace to find icon URL and folder path
    const existingNamespace = await getNamespaceById(namespaceId);
    
    if (!existingNamespace) {
      throw new Error('Namespace not found');
    }

    // Step 1: Delete all accounts associated with this namespace
    const accounts = await getNamespaceAccounts(namespaceId);
    console.log(`📋 Found ${accounts.length} accounts to delete`);
    for (const account of accounts) {
      try {
        await docClient.send(new DeleteCommand({
          TableName: 'brmh-namespace-accounts',
          Key: { id: account.id }
        }));
        console.log(`✅ Deleted account: ${account['namespace-account-name']}`);
      } catch (accountError) {
        console.error(`❌ Failed to delete account ${account.id}:`, accountError);
      }
    }

    // Step 2: Delete all methods associated with this namespace
    const methods = await getNamespaceMethods(namespaceId);
    console.log(`📋 Found ${methods.length} methods to delete`);
    for (const method of methods) {
      try {
        await docClient.send(new DeleteCommand({
          TableName: 'brmh-namespace-methods',
          Key: { id: method.id }
        }));
        console.log(`✅ Deleted method: ${method['namespace-method-name']}`);
      } catch (methodError) {
        console.error(`❌ Failed to delete method ${method.id}:`, methodError);
      }
    }

    // Step 3: Delete all schemas associated with this namespace
    const schemaResult = await docClient.send(new ScanCommand({
      TableName: 'brmh-schemas',
      FilterExpression: 'namespaceId = :nsid',
      ExpressionAttributeValues: { ':nsid': namespaceId }
    }));
    const schemas = schemaResult.Items || [];
    console.log(`📋 Found ${schemas.length} schemas to delete`);
    for (const schema of schemas) {
      try {
        await docClient.send(new DeleteCommand({
          TableName: 'brmh-schemas',
          Key: { id: schema.id }
        }));
        console.log(`✅ Deleted schema: ${schema.schemaName}`);
      } catch (schemaError) {
        console.error(`❌ Failed to delete schema ${schema.id}:`, schemaError);
      }
    }

    // Step 4: Delete icon from S3 if exists
    if (existingNamespace['icon-url']) {
      await deleteNamespaceIcon(existingNamespace['icon-url']);
      console.log('✅ Deleted namespace icon');
    }
    
    // Step 5: Delete namespace folder from S3 if exists
    if (existingNamespace['folder-path']) {
      try {
        console.log('🗑️ Deleting namespace folder...');
        await deleteNamespaceFolder(existingNamespace['folder-path']);
        console.log('✅ Namespace folder deleted successfully');
      } catch (folderError) {
        console.error('❌ Failed to delete namespace folder:', folderError);
        // Continue with namespace deletion even if folder deletion fails
      }
    }

    // Step 6: Finally, delete the namespace itself
    await docClient.send(new DeleteCommand({
      TableName: 'brmh-namespace',
      Key: { id: namespaceId }
    }));
    
    console.log(`🎉 Namespace and all associated data deleted successfully`);
    console.log(`   - Deleted ${accounts.length} accounts`);
    console.log(`   - Deleted ${methods.length} methods`);
    console.log(`   - Deleted ${schemas.length} schemas`);
    
    return { 
      message: 'Namespace and all associated data deleted successfully',
      deletedCounts: {
        accounts: accounts.length,
        methods: methods.length,
        schemas: schemas.length
      }
    };
  } catch (error) {
    console.error('❌ Error deleting namespace:', error);
    throw new Error(`Failed to delete namespace: ${error.message}`);
  }
};

// Namespace Account Operations
const getNamespaceAccounts = async (namespaceId) => {
  try {
    const response = await docClient.send(new ScanCommand({
      TableName: 'brmh-namespace-accounts',
      FilterExpression: '#data.#nsid = :namespaceId',
      ExpressionAttributeNames: {
        '#data': 'data',
        '#nsid': 'namespace-id'
      },
      ExpressionAttributeValues: {
        ':namespaceId': namespaceId
      }
    }));

    if (!response.Items) {
      return [];
    }

    return response.Items.map(item => ({
      ...item.data,
      id: item.id // Include the DynamoDB id for API operations
    }));
  } catch (error) {
    throw new Error(`Failed to get namespace accounts: ${error.message}`);
  }
};

const createNamespaceAccount = async (namespaceId, accountData) => {
  try {
    const accountId = uuidv4();
    const item = {
      id: accountId,
      type: 'account',
      data: {
        'namespace-id': namespaceId,
        'namespace-account-id': accountId,
        'namespace-account-name': accountData['namespace-account-name'],
        'namespace-account-url-override': accountData['namespace-account-url-override'],
        'namespace-account-header': accountData['namespace-account-header'] || [],
        'variables': accountData['variables'] || [],
        'tags': accountData['tags'] || []
      }
    };

    await docClient.send(new PutCommand({
      TableName: 'brmh-namespace-accounts',
      Item: item
    }));

    return item.data;
  } catch (error) {
    throw new Error(`Failed to create namespace account: ${error.message}`);
  }
};

const updateNamespaceAccount = async (accountId, updates) => {
  try {
    console.log('=== UPDATE NAMESPACE ACCOUNT DEBUG ===');
    console.log('Account ID:', accountId);
    console.log('Updates received:', JSON.stringify(updates, null, 2));
    
    const response = await docClient.send(new GetCommand({
      TableName: 'brmh-namespace-accounts',
      Key: { id: accountId }
    }));

    if (!response.Item) {
      throw new Error('Account not found');
    }

    const existingAccount = response.Item;
    console.log('Existing account data:', JSON.stringify(existingAccount.data, null, 2));
    
    const updatedData = {
      ...existingAccount.data,
      'namespace-account-name': updates['namespace-account-name'],
      'namespace-account-url-override': updates['namespace-account-url-override'] || '',
      'namespace-account-header': updates['namespace-account-header'] || [],
      'variables': updates['variables'] || [],
      'tags': updates['tags'] || [],
      'tableName': updates['tableName'] || existingAccount.data?.tableName || {}
    };
    
    console.log('Updated data to save:', JSON.stringify(updatedData, null, 2));
    console.log('Table name in updates:', updates['tableName']);
    console.log('Table name in existing:', existingAccount.data?.tableName);
    console.log('Final table name:', updatedData['tableName']);

    await docClient.send(new PutCommand({
      TableName: 'brmh-namespace-accounts',
      Item: {
        id: accountId,
        type: 'account',
        data: updatedData
      }
    }));

    console.log('Account saved successfully');
    console.log('=== END UPDATE NAMESPACE ACCOUNT DEBUG ===');
    return updatedData;
  } catch (error) {
    throw new Error(`Failed to update namespace account: ${error.message}`);
  }
};

const deleteNamespaceAccount = async (accountId) => {
  try {
    await docClient.send(new DeleteCommand({
      TableName: 'brmh-namespace-accounts',
      Key: { id: accountId }
    }));
    return { message: 'Account deleted successfully' };
  } catch (error) {
    throw new Error(`Failed to delete namespace account: ${error.message}`);
  }
};

// Namespace Method Operations
const getNamespaceMethods = async (namespaceId) => {
  try {
    const response = await docClient.send(new ScanCommand({
      TableName: 'brmh-namespace-methods',
      FilterExpression: '#data.#nsid = :namespaceId',
      ExpressionAttributeNames: {
        '#data': 'data',
        '#nsid': 'namespace-id'
      },
      ExpressionAttributeValues: {
        ':namespaceId': namespaceId
      }
    }));

    if (!response.Items) {
      return [];
    }

    return response.Items.map(item => ({
      ...item.data,
      id: item.id // Include the DynamoDB id for API operations
    }));
  } catch (error) {
    throw new Error(`Failed to get namespace methods: ${error.message}`);
  }
};

// Utility function to recursively remove undefined values from objects and arrays
function removeUndefinedDeep(obj) {
  if (Array.isArray(obj)) {
    return obj
      .map(removeUndefinedDeep)
      .filter(v => v !== undefined);
  } else if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([_, v]) => v !== undefined)
        .map(([k, v]) => [k, removeUndefinedDeep(v)])
    );
  }
  return obj;
}

const createNamespaceMethod = async (namespaceId, methodData) => {
  try {
    const methodId = uuidv4();
    const item = {
      id: methodId,
      type: 'method',
      data: removeUndefinedDeep({
        'namespace-id': namespaceId,
        'namespace-method-id': methodId,
        'namespace-method-name': methodData['namespace-method-name'],
        'namespace-method-type': methodData['namespace-method-type'],
        'namespace-method-url-override': methodData['namespace-method-url-override'],
        'namespace-method-queryParams': methodData['namespace-method-queryParams'] || [],
        'namespace-method-header': methodData['namespace-method-header'] || [],
        'save-data': methodData['save-data'] !== undefined ? methodData['save-data'] : false,
        'isInitialized': methodData['isInitialized'] !== undefined ? methodData['isInitialized'] : false,
        'tags': methodData['tags'] || [],
        'sample-request': methodData['sample-request'],
        'sample-response': methodData['sample-response'],
        'request-schema': methodData['request-schema'],
        'response-schema': methodData['response-schema']
      })
    };

    await docClient.send(new PutCommand({
      TableName: 'brmh-namespace-methods',
      Item: item
    }));

    return item.data;
  } catch (error) {
    throw new Error(`Failed to create namespace method: ${error.message}`);
  }
};

const updateNamespaceMethod = async (methodId, updates) => {
  try {
    // console.log('Update Method Request Body:', updates);

    // Actual update logic for DynamoDB
    const response = await docClient.send(new UpdateCommand({
      TableName: 'brmh-namespace-methods',
      Key: { id: methodId },
      UpdateExpression: 'SET #data = :data',
      ExpressionAttributeNames: { '#data': 'data' },
      ExpressionAttributeValues: { ':data': updates }
    }));
    // console.log('Update Method Response:', response);

    return response;
  } catch (error) {
    console.error('Update Method Error:', error);
    return { statusCode: 500, body: { error: error.message } };
  }
};

const deleteNamespaceMethod = async (methodId) => {
  try {
    await docClient.send(new DeleteCommand({
      TableName: 'brmh-namespace-methods',
      Key: { id: methodId }
    }));
    return { message: 'Method deleted successfully' };
  } catch (error) {
    throw new Error(`Failed to delete namespace method: ${error.message}`);
  }
};

// Internal function
const getNamespaceMethodById = async (methodId) => {
  try {
    if (!methodId || typeof methodId !== 'string') {
      throw new Error('methodId is required and must be a string');
    }
    const result = await docClient.send(new GetCommand({
      TableName: 'brmh-namespace-methods',
      Key: { id: methodId }
    }));
    if (!result.Item) {
      throw new Error('Method not found');
    }
    return result.Item.data;
  } catch (error) {
    throw new Error(`Failed to get method: ${error.message}`);
  }
};



// Webhook Operations
const createWebhook = async (webhookData) => {
  try {
    const webhookId = uuidv4();
    const timestamp = new Date().toISOString();
    
    const item = {
      id: webhookId,
      type: 'webhook',
      tableName: webhookData.tableName, // This will be the sort key
      data: {
        'webhook-id': webhookId,
        'webhook-name': webhookData['webhook-name'],
        'pre-exec-url': webhookData['pre-exec-url'] || '',
        'post-exec-url': webhookData['post-exec-url'],
        'method-id': webhookData['method-id'] || null,
        'namespace-id': webhookData['namespace-id'] || null,
        'account-id': webhookData['account-id'] || null,
        'table-name': webhookData.tableName,
        'status': webhookData.status || 'active',
        'tags': webhookData.tags || [],
        'created-at': timestamp,
        'updated-at': timestamp
      }
    };

    await docClient.send(new PutCommand({
      TableName: 'webhooks',
      Item: item
    }));

    return item.data;
  } catch (error) {
    throw new Error(`Failed to create webhook: ${error.message}`);
  }
};

const getWebhookById = async (webhookId) => {
  try {
    // Since we need both partition key and sort key, we'll need to scan and filter
    const result = await docClient.send(new ScanCommand({
      TableName: 'webhooks',
      FilterExpression: '#data.#wid = :webhookId',
      ExpressionAttributeNames: {
        '#data': 'data',
        '#wid': 'webhook-id'
      },
      ExpressionAttributeValues: {
        ':webhookId': webhookId
      }
    }));

    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    return result.Items[0].data;
  } catch (error) {
    throw new Error(`Failed to get webhook: ${error.message}`);
  }
};

const updateWebhook = async (webhookId, updates) => {
  try {
    const existingWebhook = await getWebhookById(webhookId);
    if (!existingWebhook) {
      throw new Error('Webhook not found');
    }

    const timestamp = new Date().toISOString();
    const updatedData = {
      ...existingWebhook,
      ...updates,
      'updated-at': timestamp
    };
    if ('pre-exec-url' in updates) {
      updatedData['pre-exec-url'] = updates['pre-exec-url'];
    }
    // If tableName is being updated, we need to handle the sort key change
    const newTableName = updates.tableName || existingWebhook['table-name'];

    await docClient.send(new PutCommand({
      TableName: 'webhooks',
      Item: {
        id: webhookId,
        type: 'webhook',
        tableName: newTableName,
        data: {
          ...updatedData,
          'table-name': newTableName
        }
      }
    }));

    // If tableName changed, delete the old record
    if (updates.tableName && updates.tableName !== existingWebhook['table-name']) {
      await docClient.send(new DeleteCommand({
        TableName: 'webhooks',
        Key: { 
          id: webhookId,
          tableName: existingWebhook['table-name']
        }
      }));
    }

    return updatedData;
  } catch (error) {
    throw new Error(`Failed to update webhook: ${error.message}`);
  }
};

const deleteWebhook = async (webhookId) => {
  try {
    // First get the webhook to find the tableName (sort key)
    const webhook = await getWebhookById(webhookId);
    if (!webhook) {
      throw new Error('Webhook not found');
    }

    // Delete using both partition key and sort key
    await docClient.send(new DeleteCommand({
      TableName: 'webhooks',
      Key: { 
        id: webhookId,
        tableName: webhook['table-name']
      }
    }));
    return { message: 'Webhook deleted successfully' };
  } catch (error) {
    throw new Error(`Failed to delete webhook: ${error.message}`);
  }
};

const listWebhooks = async () => {
  try {
    const result = await docClient.send(new ScanCommand({
      TableName: 'webhooks'
    }));
    return result.Items ? result.Items.map(item => item.data) : [];
  } catch (error) {
    throw new Error(`Failed to list webhooks: ${error.message}`);
  }
};

const getWebhooksByTableName = async (tableName) => {
  try {
    const result = await docClient.send(new ScanCommand({
      TableName: 'webhooks',
      FilterExpression: '#tableName = :tableName',
      ExpressionAttributeNames: {
        '#tableName': 'tableName'
      },
      ExpressionAttributeValues: {
        ':tableName': tableName
      }
    }));
    return result.Items ? result.Items.map(item => item.data) : [];
  } catch (error) {
    throw new Error(`Failed to get webhooks by table name: ${error.message}`);
  }
};

const getWebhooksByNamespace = async (namespaceId) => {
  try {
    const result = await docClient.send(new ScanCommand({
      TableName: 'webhooks',
      FilterExpression: '#data.#nsid = :namespaceId',
      ExpressionAttributeNames: {
        '#data': 'data',
        '#nsid': 'namespace-id'
      },
      ExpressionAttributeValues: {
        ':namespaceId': namespaceId
      }
    }));
    return result.Items ? result.Items.map(item => item.data) : [];
  } catch (error) {
    throw new Error(`Failed to get webhooks by namespace: ${error.message}`);
  }
};

const getWebhooksByMethod = async (methodId) => {
  try {
    const result = await docClient.send(new ScanCommand({
      TableName: 'webhooks',
      FilterExpression: '#data.#mid = :methodId',
      ExpressionAttributeNames: {
        '#data': 'data',
        '#mid': 'method-id'
      },
      ExpressionAttributeValues: {
        ':methodId': methodId
      }
    }));
    return result.Items ? result.Items.map(item => item.data) : [];
  } catch (error) {
    throw new Error(`Failed to get webhooks by method: ${error.message}`);
  }
};

const getActiveWebhooks = async () => {
  try {
    const result = await docClient.send(new ScanCommand({
      TableName: 'webhooks',
      FilterExpression: '#data.#status = :status',
      ExpressionAttributeNames: {
        '#data': 'data',
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 'active'
      }
    }));
    return result.Items ? result.Items.map(item => item.data) : [];
  } catch (error) {
    throw new Error(`Failed to get active webhooks: ${error.message}`);
  }
};

// Add a handler to list all saved schemas for a given namespaceId
const listSchemasByNamespace = async (c, req, res) => {
  try {
    const namespaceId = c.request.query?.namespaceId || req.query?.namespaceId;
    if (!namespaceId) {
      return { statusCode: 400, body: { error: 'namespaceId is required' } };
    }
    const result = await docClient.send(new ScanCommand({
      TableName: 'brmh-schemas',
      FilterExpression: 'namespaceId = :nsid',
      ExpressionAttributeValues: { ':nsid': namespaceId }
    }));
    return { statusCode: 200, body: result.Items || [] };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
};

// Add a handler to get schemas for child schema selection
const getSchemasForSelection = async (c, req, res) => {
  try {
    console.log('getSchemasForSelection called');
    const query = (c && c.request && c.request.query) ? c.request.query : (req && req.query ? req.query : {});
    const { search = '', limit = 50, namespaceId, namespaceIds, droppedNamespaceIds, contextNamespaceIds } = query;
    console.log('Query params:', { search, limit, namespaceId, namespaceIds, droppedNamespaceIds, contextNamespaceIds });
    
    // Build allowlist of namespace IDs if provided
    const parseIds = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val.filter(Boolean);
      if (typeof val === 'string') return val.split(',').map(s => s.trim()).filter(Boolean);
      return [];
    };

    const allowNamespaceIds = new Set([
      ...parseIds(namespaceId),
      ...parseIds(namespaceIds),
      ...parseIds(droppedNamespaceIds),
      ...parseIds(contextNamespaceIds)
    ]);

    // Get all schemas
    const allSchemas = await listSchemas();
    console.log('All schemas count:', allSchemas.length);

    // Filter by namespace context if provided
    let filteredSchemas = allSchemas;
    if (allowNamespaceIds.size > 0) {
      filteredSchemas = filteredSchemas.filter(schema => 
        allowNamespaceIds.has(schema.namespaceId) || 
        allowNamespaceIds.has(schema['namespace-id'])
      );
      console.log('Filtered by namespaces count:', filteredSchemas.length);
    }

    // Filter schemas based on search term
    if (search) {
      const searchLower = search.toLowerCase();
      filteredSchemas = filteredSchemas.filter(schema =>
        schema.schemaName?.toLowerCase().includes(searchLower) ||
        schema.methodName?.toLowerCase().includes(searchLower)
      );
    }
    console.log('Final filtered schemas count:', filteredSchemas.length);
    
    // Limit results
    const limitedSchemas = filteredSchemas.slice(0, parseInt(limit));
    
    // Return simplified schema info for selection
    const schemasForSelection = limitedSchemas.map(schema => ({
      id: schema.id,
      schemaName: schema.schemaName,
      methodName: schema.methodName,
      namespaceId: schema.namespaceId || schema['namespace-id'], // include for frontend grouping and compatibility
      description: `${schema.schemaName}${schema.methodName ? ` (${schema.methodName})` : ''}`
    }));
    
    console.log('Returning schemas:', schemasForSelection.length);
    
    return {
      statusCode: 200,
      body: {
        schemas: schemasForSelection,
        total: filteredSchemas.length,
        limit: parseInt(limit)
      }
    };
  } catch (error) {
    console.error('Error in getSchemasForSelection:', error);
    return {
      statusCode: 500,
      body: { error: error.message }
    };
  }
};

// Function to resolve schema references and get child schemas
const resolveSchemaReferences = async (schema) => {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  const resolvedSchema = { ...schema };

  // Recursively resolve references in properties
  if (resolvedSchema.properties) {
    for (const [key, prop] of Object.entries(resolvedSchema.properties)) {
      if (prop.$ref) {
        // Extract schema ID from $ref
        const schemaId = prop.$ref.split('/').pop();
        if (schemaId) {
          try {
            const childSchema = await getSchema(schemaId);
            if (childSchema && childSchema.schema) {
              // Replace the reference with the actual schema
              resolvedSchema.properties[key] = {
                ...childSchema.schema,
                _referencedSchemaId: schemaId,
                _referencedSchemaName: childSchema.schemaName
              };
            }
          } catch (error) {
            console.warn(`Could not resolve schema reference ${schemaId}:`, error.message);
            // Keep the reference if resolution fails
          }
        }
      } else if (prop.items && prop.items.$ref) {
        // Handle array items with schema references
        const schemaId = prop.items.$ref.split('/').pop();
        if (schemaId) {
          try {
            const childSchema = await getSchema(schemaId);
            if (childSchema && childSchema.schema) {
              resolvedSchema.properties[key].items = {
                ...childSchema.schema,
                _referencedSchemaId: schemaId,
                _referencedSchemaName: childSchema.schemaName
              };
            }
          } catch (error) {
            console.warn(`Could not resolve array item schema reference ${schemaId}:`, error.message);
          }
        }
      }
    }
  }

  return resolvedSchema;
};

// Add a handler to get schema with resolved references
const getSchemaWithReferences = async (c, req, res) => {
  try {
    const { schemaId } = c.request.params;
    const { resolveReferences = 'true' } = c.request.query || {};
    
    const schema = await getSchema(schemaId);
    
    if (resolveReferences === 'true') {
      const resolvedSchema = await resolveSchemaReferences(schema.schema);
      return {
        statusCode: 200,
        body: {
          ...schema,
          schema: resolvedSchema
        }
      };
    }
    
    return { statusCode: 200, body: schema };
  } catch (error) {
    return { statusCode: 404, body: { error: error.message } };
  }
};

// Export all wrapped handlers
export const handlers = {
// Schema Operations
  generateSchema: async (c, req, res) => {
  try {
    const { data } = c.request.requestBody || {};
    const result = generateSchema(data);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 400, body: { error: error.message } };
  }
  },
  validateSchema: async (c, req, res) => {
  try {
    const { schema, data } = c.request.requestBody;
    if (!schema) {
      return {
        statusCode: 400,
        body: { error: 'Schema is required' }
      };
    }

    const ajv = new Ajv();
    
    // Add custom format validator for 'file' type
    ajv.addFormat('file', {
      type: 'string',
      validate: (data) => {
        // Accept any string as valid file path/URL
        return typeof data === 'string';
      }
    });
    
    // If only schema is provided, validate schema structure
    if (typeof data === 'undefined') {
      const valid = ajv.validateSchema(schema);
      return {
        statusCode: 200,
        body: {
          valid,
          errors: valid ? [] : ajv.errors
        }
      };
    }

    // If both schema and data are provided, validate data against schema
    const validate = ajv.compile(schema);
    const valid = validate(data);
    return {
      statusCode: 200,
      body: {
        valid,
        errors: valid ? [] : validate.errors
      }
    };
  } catch (error) {
    console.error('Schema validation error:', error);
    return {
      statusCode: 500,
      body: { error: 'Failed to validate schema', details: error.message }
    };
  }
  },
  saveSchema: async (c, req, res) => {
  try {
    const result = await saveSchema(c, req, res);
    return result;
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
  },
  getSchema: async (c, req, res) => {
  try {
    const { schemaId } = c.request.params;
    const result = await getSchema(schemaId);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 404, body: { error: error.message } };
  }
  },
  updateSchema: async (c, req, res) => {
  try {
    const { schemaId } = c.request.params;
    const result = await updateSchema(schemaId, c.request.requestBody);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
  },
  deleteSchema: async (c, req, res) => {
  try {
    const { schemaId } = c.request.params;
    await deleteSchema(schemaId);
    return { statusCode: 204 };
  } catch (error) {
    return { statusCode: 404, body: { error: error.message } };
  }
  },
  listSchemas: async (c, req, res) => {
  try {
    const result = await listSchemas();
    return { statusCode: 200, body: result };
  } catch (error) {
    console.error('Error in listSchemasHandler:', error);
    return { statusCode: 500, body: { error: error.message } };
  }
  },
  getSchemasForSelection: getSchemasForSelection,
  getSchemaWithReferences: getSchemaWithReferences,

// Table Operations
  createSchemasTable: async (c, req, res) => {
  try {
    const result = await createSchemasTable(c.request.requestBody);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
  },
  deleteSchemasTable: async (c, req, res) => {
  try {
    const { tableName } = c.request.requestBody || {};
    const result = await deleteSchemasTable(tableName);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
  },
  insertSchemaData: async (c, req, res) => {
  try {
    const result = await insertSchemaData(c.request.requestBody);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
  },
  listSchemaTableMeta: async (c, req, res) => {
  try {
    const result = await listSchemaTableMeta();
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
  },
  getSchemaTableMeta: async (c, req, res) => {
  try {
    const { metaId } = c.request.params;
    const result = await getSchemaTableMeta(metaId);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 404, body: { error: error.message } };
  }
  },
  checkAndUpdateTableStatus: async (c, req, res) => {
  try {
    const { metaId } = c.request.params;
    const result = await checkAndUpdateTableStatus(metaId);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
  },
  getTableItems: async (c, req, res) => {
  try {
    const { tableName } = c.request.params;
    const result = await getTableItems(tableName);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 404, body: { error: error.message } };
  }
  },
  createTableItem: async (c, req, res) => {
  try {
    const { tableName } = c.request.params;
    const { item } = c.request.requestBody;
    if (!item) {
      return { statusCode: 400, body: { error: 'Item is required' } };
    }

    // Check if table exists
    try {
      await client.send(new DescribeTableCommand({ TableName: tableName }));
    } catch (error) {
      if (error.name === 'ResourceNotFoundException') {
        return { statusCode: 404, body: { error: `Table ${tableName} does not exist` } };
      }
      throw error;
    }

    // Create a clean copy of the item
    const cleanedItem = { ...item };
    
    // Ensure the item has an 'id' field - this is required for DynamoDB
    if (!cleanedItem.id) {
      // Try to find an id-like field
      const idField = Object.keys(cleanedItem).find(key => 
        key.toLowerCase().includes('id') || 
        key.toLowerCase().includes('_id') ||
        key.toLowerCase().includes('order_id') ||
        key.toLowerCase().includes('product_id')
      );
      
      if (idField) {
        cleanedItem.id = String(cleanedItem[idField]);
      } else {
        // Generate a unique ID if no id field found
        cleanedItem.id = `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log(`Generated ID for item: ${cleanedItem.id}`);
      }
    } else {
      // Ensure id is a string
      if (typeof cleanedItem.id === 'number') {
        cleanedItem.id = cleanedItem.id.toString();
      }
    }

    // Remove bookmark and url fields from the item
    const { bookmark, url, ...itemWithoutBookmark } = cleanedItem;

    // Keep only essential fields and primitive values
    const simplifiedItem = Object.entries(itemWithoutBookmark).reduce((acc, [key, value]) => {
      if (typeof value === 'string' || 
          typeof value === 'number' || 
          typeof value === 'boolean' ||
          value === null ||
          Array.isArray(value) ||
          (typeof value === 'object' && value !== null)) {
        acc[key] = value;
      }
      return acc;
    }, {});

    // Only save the flat item (no timestamp, no _metadata)
    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: simplifiedItem
    }));

    return { 
      statusCode: 200, 
      body: { 
        success: true,
        itemId: simplifiedItem.id
      } 
    };
  } catch (error) {
    console.error('Error creating table item:', error);
    return { statusCode: 500, body: { error: error.message } };
  }
  },
  getSchemaByTableName: async (c, req, res) => {
  try {
    const { tableName } = c.request.params;
    const result = await getSchemaByTableName(tableName);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 404, body: { error: error.message } };
  }
  },
  checkAllTableStatuses: async (c, req, res) => {
  try {
    const result = await checkAllTableStatuses();
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
  },
  createTableByName: async (c, req, res) => {
    try {
      const { tableName } = c.request.requestBody;
      if (!tableName || !tableName.trim()) {
        return { statusCode: 400, body: { error: 'tableName is required' } };
      }
      const params = {
        TableName: tableName,
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
        BillingMode: 'PAY_PER_REQUEST'
      };
      await client.send(new CreateTableCommand(params));
      return { statusCode: 201, body: { message: 'Table created successfully', tableName } };
    } catch (error) {
      if (error.name === 'ResourceInUseException') {
        return { statusCode: 409, body: { error: 'Table already exists' } };
      }
      return { statusCode: 500, body: { error: error.message } };
    }
  },
  getTableItemCount: async (c, req, res) => {
    try {
      const { tableName } = c.request.params;
      const result = await getTableItemCount(tableName);
      return { statusCode: 200, body: result };
    } catch (error) {
      if (error.message.includes('does not exist')) {
        return { statusCode: 404, body: { error: error.message } };
      }
      return { statusCode: 500, body: { error: error.message } };
    }
  },
  validateTable: async (c, req, res) => {
    try {
      const { tableName } = c.request.requestBody;
      const result = await validateTableExists(tableName);
      return { statusCode: 200, body: result };
    } catch (error) {
      return { statusCode: 500, body: { error: error.message } };
    }
  },

// API Execution
  executeNamespaceRequest: async (c, req, res) => {
  try {
    const result = await executeNamespaceRequest(c.request.requestBody);
      return { statusCode: result.statusCode, body: result.body };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
  },
  executeNamespacePaginatedRequest: async (c, req, res) => {
  try {
    const result = await executeNamespacePaginatedRequest(c, req, res);
      return { statusCode: result.statusCode, body: result.body };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
  },

  // Namespace Operations
  getNamespaces: getNamespaces,
  getNamespaceById: async (c, req, res) => {
  try {
    const { namespaceId } = c.request.params;
    const result = await getNamespaceById(namespaceId);
    if (!result) return { statusCode: 404, body: { error: 'Namespace not found' } };
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
  },
  createNamespace: async (c, req, res) => {
  try {
    console.log('=== CREATE NAMESPACE HANDLER DEBUG ===');
    console.log('req.file:', req.file);
    console.log('req.files:', req.files);
    console.log('req.body:', req.body);
    console.log('c.request.requestBody:', c.request.requestBody);
    
    // Handle multipart form data for icon upload
    const iconFile = req.file || null;
    console.log('iconFile extracted:', iconFile);
    
    const result = await createNamespace(c.request.requestBody, iconFile);
    return { statusCode: 201, body: result };
  } catch (error) {
    console.error('Create namespace handler error:', error);
    return { statusCode: 500, body: { error: error.message } };
  }
  },
  updateNamespace: async (c, req, res) => {
  try {
    const { namespaceId } = c.request.params;
    // Handle multipart form data for icon upload
    const iconFile = req.file || null;
    const result = await updateNamespace(namespaceId, c.request.requestBody, iconFile);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
  },
  deleteNamespace: async (c, req, res) => {
  try {
    const { namespaceId } = c.request.params;
    await deleteNamespace(namespaceId);
    return { statusCode: 204 };
  } catch (error) {
    return { statusCode: 404, body: { error: error.message } };
  }
  },

// Namespace Account Operations
  getNamespaceAccounts: async (c, req, res) => {
  try {
    const { namespaceId } = c.request.params;
    const result = await getNamespaceAccounts(namespaceId);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
  },
  createNamespaceAccount: async (c, req, res) => {
  try {
    const { namespaceId } = c.request.params;
    const result = await createNamespaceAccount(namespaceId, c.request.requestBody);
    return { statusCode: 201, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
  },
  updateNamespaceAccount: async (c, req, res) => {
  try {
    const { accountId } = c.request.params;
    const result = await updateNamespaceAccount(accountId, c.request.requestBody);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
  },
  deleteNamespaceAccount: async (c, req, res) => {
  try {
    const { accountId } = c.request.params;
    await deleteNamespaceAccount(accountId);
    return { statusCode: 204 };
  } catch (error) {
    return { statusCode: 404, body: { error: error.message } };
  }
  },

// Namespace Method Operations
  getNamespaceMethods: async (c, req, res) => {
  try {
    const { namespaceId } = c.request.params;
    const result = await getNamespaceMethods(namespaceId);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
  },
  createNamespaceMethod: async (c, req, res) => {
  try {
    const { namespaceId } = c.request.params;
    const result = await createNamespaceMethod(namespaceId, c.request.requestBody);
    return { statusCode: 201, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
  },
  updateNamespaceMethod: async (c, req, res) => {
  try {

    // console.log('updateNamespaceMethodHandler received:', c.request.requestBody);

    const { methodId } = c.request.params;
    const result = await updateNamespaceMethod(methodId, c.request.requestBody);
    console.log('Update Method Response:', result);
    return { statusCode: 200, body: result };
  } catch (error) {
    console.error('Update Method Error:', error);
    return { statusCode: 500, body: { error: error.message } };
  }
  },
  deleteNamespaceMethod: async (c, req, res) => {
  try {
    const { methodId } = c.request.params;
    await deleteNamespaceMethod(methodId);
    return { statusCode: 204 };
  } catch (error) {
    return { statusCode: 404, body: { error: error.message } };
  }
  },
  getNamespaceMethodById: async (c, req, res) => {
    try {
      const methodId = c.request?.params?.methodId || c.request?.pathParams?.methodId;
      // console.log('Params received:', c.request.params, c.request.pathParams, 'Resolved methodId:', methodId);
      if (!methodId || typeof methodId !== 'string') {
        throw new Error('methodId is required and must be a string');
      }
      const result = await getNamespaceMethodById(methodId);
      return { statusCode: 200, body: result };
  } catch (error) {
      return { statusCode: 404, body: { error: error.message } };
    }
  },
  getNamespaceAccountById: async (c, req, res) => {
    try {
      const accountId = c.request?.params?.accountId || c.request?.pathParams?.accountId;
      if (!accountId || typeof accountId !== 'string') {
        throw new Error('accountId is required and must be a string');
      }
      
      const result = await docClient.send(new GetCommand({
        TableName: 'brmh-namespace-accounts',
        Key: { id: accountId }
      }));
      
      if (!result.Item) {
        return { statusCode: 404, body: { error: 'Account not found' } };
      }
      
      return { statusCode: 200, body: result.Item.data };
    } catch (error) {
      return { statusCode: 500, body: { error: error.message } };
    }
  },
   // Webhook Operations
   createWebhook: async (c, req, res) => {
    try {
      const result = await createWebhook(c.request.requestBody);
      return { statusCode: 201, body: result };
    } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
  },

  getWebhookById: async (c, req, res) => {
    try {
      const { webhookId } = c.request.params;
      const result = await getWebhookById(webhookId);
      if (!result) return { statusCode: 404, body: { error: 'Webhook not found' } };
      return { statusCode: 200, body: result };
    } catch (error) {
      return { statusCode: 500, body: { error: error.message } };
    }
  },

  updateWebhook: async (c, req, res) => {
    try {
      const { webhookId } = c.request.params;
      const result = await updateWebhook(webhookId, c.request.requestBody);
      return { statusCode: 200, body: result };
    } catch (error) {
      return { statusCode: 500, body: { error: error.message } };
    }
  },

  deleteWebhook: async (c, req, res) => {
    try {
      const { webhookId } = c.request.params;
      await deleteWebhook(webhookId);
      return { statusCode: 204 };
  } catch (error) {
      return { statusCode: 404, body: { error: error.message } };
    }
  },

  listWebhooks: async (c, req, res) => {
    try {
      const result = await listWebhooks();
      return { statusCode: 200, body: result };
    } catch (error) {
      return { statusCode: 500, body: { error: error.message } };
    }
  },

  getWebhooksByTableName: async (c, req, res) => {
    try {
      const { tableName } = c.request.params;
      const result = await getWebhooksByTableName(tableName);
      return { statusCode: 200, body: result };
    } catch (error) {
      return { statusCode: 500, body: { error: error.message } };
    }
  },

  getWebhooksByNamespace: async (c, req, res) => {
    try {
      const { namespaceId } = c.request.params;
      const result = await getWebhooksByNamespace(namespaceId);
    return { statusCode: 200, body: result };
  } catch (error) {
      return { statusCode: 500, body: { error: error.message } };
    }
  },

  getWebhooksByMethod: async (c, req, res) => {
    try {
      const { methodId } = c.request.params;
      const result = await getWebhooksByMethod(methodId);
      return { statusCode: 200, body: result };
    } catch (error) {
      return { statusCode: 500, body: { error: error.message } };
    }
  },

  getActiveWebhooks: async (c, req, res) => {
    try {
      const result = await getActiveWebhooks();
      return { statusCode: 200, body: result };
    } catch (error) {
      return { statusCode: 500, body: { error: error.message } };
    }
  },

  listSchemasByNamespace: listSchemasByNamespace,

  // Duplication Operations
  duplicateNamespace: async (c, req, res) => {
    try {
      const { namespaceId } = c.request.params;
      const { newName } = c.request.requestBody || {};
      
      console.log(`[Duplicate Namespace] Request for: ${namespaceId}, newName: ${newName || 'auto-generated'}`);
      
      const result = await duplicateNamespace(namespaceId, newName);
      return { statusCode: 201, body: result };
    } catch (error) {
      console.error('[Duplicate Namespace] Error:', error);
      return { statusCode: 500, body: { error: error.message } };
    }
  },

  duplicateAccount: async (c, req, res) => {
    try {
      const { accountId } = c.request.params;
      const { newName } = c.request.requestBody || {};
      
      console.log(`[Duplicate Account] Request for: ${accountId}, newName: ${newName || 'auto-generated'}`);
      
      const result = await duplicateAccount(accountId, newName);
      return { statusCode: 201, body: result };
    } catch (error) {
      console.error('[Duplicate Account] Error:', error);
      return { statusCode: 500, body: { error: error.message } };
    }
  },

  duplicateMethod: async (c, req, res) => {
    try {
      const { methodId } = c.request.params;
      const { newName } = c.request.requestBody || {};
      
      console.log(`[Duplicate Method] Request for: ${methodId}, newName: ${newName || 'auto-generated'}`);
      
      const result = await duplicateMethod(methodId, newName);
      return { statusCode: 201, body: result };
    } catch (error) {
      console.error('[Duplicate Method] Error:', error);
      return { statusCode: 500, body: { error: error.message } };
    }
  },

  duplicateSchema: async (c, req, res) => {
    try {
      const { schemaId } = c.request.params;
      const { newName } = c.request.requestBody || {};
      
      console.log(`[Duplicate Schema] Request for: ${schemaId}, newName: ${newName || 'auto-generated'}`);
      
      const result = await duplicateSchema(schemaId, newName);
      return { statusCode: 201, body: result };
    } catch (error) {
      console.error('[Duplicate Schema] Error:', error);
      return { statusCode: 500, body: { error: error.message } };
    }
  },
};



// S3 Functions for Namespace Icons
const uploadNamespaceIcon = async (namespaceId, iconFile) => {
  try {
    console.log('=== UPLOAD NAMESPACE ICON DEBUG ===');
    console.log('namespaceId:', namespaceId);
    console.log('iconFile:', iconFile);
    console.log('iconFile type:', typeof iconFile);
    console.log('iconFile keys:', iconFile ? Object.keys(iconFile) : 'null');
    
    if (!iconFile || !iconFile.buffer) {
      console.error('Icon file validation failed:', { hasIconFile: !!iconFile, hasBuffer: !!iconFile?.buffer });
      throw new Error('Icon file is required');
    }

    // Generate unique filename
    const fileExtension = iconFile.originalname.split('.').pop();
    const fileName = `${namespaceId}-${Date.now()}.${fileExtension}`;
    const s3Key = `${NAMESPACE_ICON_FOLDER}/${fileName}`;

    console.log('S3 Upload Details:');
    console.log('- Bucket:', S3_BUCKET_NAME);
    console.log('- Key:', s3Key);
    console.log('- File size:', iconFile.buffer.length, 'bytes');
    console.log('- Content type:', iconFile.mimetype);
    console.log('- Original name:', iconFile.originalname);

    // Upload to S3 (without ACL since bucket blocks public access)
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: s3Key,
      Body: iconFile.buffer,
      ContentType: iconFile.mimetype,
      Metadata: {
        namespaceId: namespaceId,
        originalName: iconFile.originalname,
        uploadedAt: new Date().toISOString()
      }
    }));

    // Return the S3 URL
    const s3Url = `https://${S3_BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${s3Key}`;
    console.log('S3 Upload successful. URL:', s3Url);
    return s3Url;
  } catch (error) {
    console.error('Error uploading namespace icon:', error);
    throw new Error(`Failed to upload icon: ${error.message}`);
  }
};

const deleteNamespaceIcon = async (iconUrl) => {
  try {
    if (!iconUrl) return;

    // Extract S3 key from URL
    const urlParts = iconUrl.split('/');
    const s3Key = urlParts.slice(3).join('/'); // Remove https://bucket.s3.region.amazonaws.com/

    await s3Client.send(new DeleteObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: s3Key
    }));
  } catch (error) {
    console.error('Error deleting namespace icon:', error);
    // Don't throw error as this is cleanup operation
  }
};

// Function to serve icon through backend API
const serveIcon = async (iconUrl) => {
  try {
    if (!iconUrl) return null;

    // Extract S3 key from URL
    const urlParts = iconUrl.split('/');
    const s3Key = urlParts.slice(3).join('/'); // Remove https://bucket.s3.region.amazonaws.com/

    // Get the object from S3
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: s3Key
    }));

    // Convert the readable stream to buffer
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    return {
      buffer,
      contentType: response.ContentType || 'image/png',
      metadata: response.Metadata || {}
    };
  } catch (error) {
    console.error('Error serving icon:', error);
    return null;
  }
};

// Export individual functions for direct import
export { createNamespace, createNamespaceMethod }; 

// Indexing Configuration Management Functions
const createIndexingConfig = async (configData) => {
  try {
    const configId = uuidv4();
    const timestamp = new Date().toISOString();
    
    const indexingConfig = {
      id: configId,
      project: configData.project || 'default',
      table: configData.table,
      description: configData.description || '',
      customFields: configData.customFields || [],
      status: configData.status || 'active',
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await docClient.send(new PutCommand({
      TableName: 'brmh-indexing',
      Item: indexingConfig
    }));

    console.log(`✅ Created indexing configuration: ${configId}`);
    return indexingConfig;
  } catch (error) {
    console.error('❌ Error creating indexing configuration:', error);
    throw error;
  }
};

const getIndexingConfigsByTable = async (tableName) => {
  try {
    const command = new ScanCommand({
      TableName: 'brmh-indexing',
      FilterExpression: '#table = :table',
      ExpressionAttributeNames: {
        '#table': 'table'
      },
      ExpressionAttributeValues: {
        ':table': tableName
      }
    });
    
    const response = await docClient.send(command);
    return (response.Items || []).map(item => item.data || item);
  } catch (error) {
    console.error('❌ Error getting indexing configurations:', error);
    return [];
  }
};

const updateIndexingConfig = async (configId, updates) => {
  try {
    const timestamp = new Date().toISOString();
    const updateExpression = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    Object.entries(updates).forEach(([key, value]) => {
      updateExpression.push(`#${key} = :${key}`);
      expressionAttributeNames[`#${key}`] = key;
      expressionAttributeValues[`:${key}`] = value;
    });

    // Always update the updatedAt timestamp
    updateExpression.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = timestamp;

    const command = new UpdateCommand({
      TableName: 'brmh-indexing',
      Key: { id: configId },
      UpdateExpression: `SET ${updateExpression.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    });

    const result = await docClient.send(command);
    console.log(`✅ Updated indexing configuration: ${configId}`);
    return result.Attributes;
  } catch (error) {
    console.error('❌ Error updating indexing configuration:', error);
    throw error;
  }
};

const deleteIndexingConfig = async (configId) => {
  try {
    await docClient.send(new DeleteCommand({
      TableName: 'brmh-indexing',
      Key: { id: configId }
    }));

    console.log(`✅ Deleted indexing configuration: ${configId}`);
    return { success: true };
  } catch (error) {
    console.error('❌ Error deleting indexing configuration:', error);
    throw error;
  }
};

// Duplication Functions

/**
 * Duplicate a namespace with all its accounts, methods, and schemas
 * @param {string} namespaceId - The namespace ID to duplicate
 * @param {string} newNamespaceName - Optional new name for the duplicated namespace
 * @returns {Object} The duplicated namespace with all its entities
 */
const duplicateNamespace = async (namespaceId, newNamespaceName = null) => {
  try {
    console.log(`🔄 Starting namespace duplication for: ${namespaceId}`);
    
    // Get the original namespace
    const originalNamespace = await getNamespaceById(namespaceId);
    if (!originalNamespace) {
      throw new Error('Namespace not found');
    }

    // Create new namespace with new ID
    const newNamespaceId = uuidv4();
    const timestamp = new Date().toISOString();
    const namespaceName = newNamespaceName || `${originalNamespace['namespace-name']} (Copy)`;
    
    console.log(`📋 Original namespace: ${originalNamespace['namespace-name']}`);
    console.log(`📋 New namespace: ${namespaceName}`);

    // Duplicate the namespace folder in S3
    let newFolderPath = null;
    try {
      const folderResult = await createNamespaceFolder(newNamespaceId, namespaceName);
      newFolderPath = folderResult.folderPath;
      console.log(`✅ Created new namespace folder: ${newFolderPath}`);
    } catch (folderError) {
      console.warn(`⚠️ Failed to create namespace folder: ${folderError.message}`);
    }

    // Create duplicated namespace
    const newNamespaceData = {
      'namespace-id': newNamespaceId,
      'namespace-name': namespaceName,
      'namespace-url': originalNamespace['namespace-url'],
      'icon-url': originalNamespace['icon-url'], // Keep same icon or could duplicate
      'folder-path': newFolderPath,
      'tags': [...(originalNamespace['tags'] || []), 'duplicated'],
      'namespace-accounts': [],
      'namespace-methods': [],
      'schemaIds': [],
      'duplicated-from': namespaceId,
      'duplicated-at': timestamp
    };

    // Remove undefined values to prevent DynamoDB errors
    const cleanedNamespaceData = Object.fromEntries(
      Object.entries(newNamespaceData).filter(([_, value]) => value !== undefined)
    );

    await docClient.send(new PutCommand({
      TableName: 'brmh-namespace',
      Item: {
        id: newNamespaceId,
        type: 'namespace',
        data: cleanedNamespaceData
      }
    }));

    console.log(`✅ Created duplicated namespace: ${newNamespaceId}`);

    // Get all accounts for this namespace
    const accounts = await getNamespaceAccounts(namespaceId);
    console.log(`📋 Found ${accounts.length} accounts to duplicate`);

    // Map old account IDs to new account IDs
    const accountIdMap = {};
    const duplicatedAccounts = [];

    // Duplicate all accounts
    for (const account of accounts) {
      const newAccountId = uuidv4();
      accountIdMap[account['namespace-account-id']] = newAccountId;

      const newAccountData = {
        'namespace-id': newNamespaceId,
        'namespace-account-id': newAccountId,
        'namespace-account-name': `${account['namespace-account-name']} (Copy)`,
        'namespace-account-url-override': account['namespace-account-url-override'],
        'namespace-account-header': account['namespace-account-header'] || [],
        'variables': account['variables'] || [],
        'tags': [...(account['tags'] || []), 'duplicated'],
        'tableName': {}, // Will be populated when methods are duplicated
        'duplicated-from': account['namespace-account-id'],
        'duplicated-at': timestamp
      };

      // Remove undefined values to prevent DynamoDB errors
      const cleanedAccountData = Object.fromEntries(
        Object.entries(newAccountData).filter(([_, value]) => value !== undefined)
      );

      await docClient.send(new PutCommand({
        TableName: 'brmh-namespace-accounts',
        Item: {
          id: newAccountId,
          type: 'account',
          data: cleanedAccountData
        }
      }));

      duplicatedAccounts.push(cleanedAccountData);
      console.log(`✅ Duplicated account: ${account['namespace-account-name']} -> ${newAccountId}`);
    }

    // Get all methods for this namespace
    const methods = await getNamespaceMethods(namespaceId);
    console.log(`📋 Found ${methods.length} methods to duplicate`);

    // Map old method IDs to new method IDs
    const methodIdMap = {};
    const duplicatedMethods = [];

    // Duplicate all methods
    for (const method of methods) {
      const newMethodId = uuidv4();
      methodIdMap[method['namespace-method-id']] = newMethodId;

      const newMethodData = {
        'namespace-id': newNamespaceId,
        'namespace-method-id': newMethodId,
        'namespace-method-name': method['namespace-method-name'],
        'namespace-method-type': method['namespace-method-type'],
        'namespace-method-url-override': method['namespace-method-url-override'],
        'namespace-method-queryParams': method['namespace-method-queryParams'] || [],
        'namespace-method-header': method['namespace-method-header'] || [],
        'save-data': method['save-data'],
        'isInitialized': method['isInitialized'],
        'tags': [...(method['tags'] || []), 'duplicated'],
        'sample-request': method['sample-request'],
        'sample-response': method['sample-response'],
        'request-schema': method['request-schema'],
        'response-schema': method['response-schema'],
        'duplicated-from': method['namespace-method-id'],
        'duplicated-at': timestamp
      };

      // Remove undefined values to prevent DynamoDB errors
      const cleanedMethodData = Object.fromEntries(
        Object.entries(newMethodData).filter(([_, value]) => value !== undefined)
      );

      await docClient.send(new PutCommand({
        TableName: 'brmh-namespace-methods',
        Item: {
          id: newMethodId,
          type: 'method',
          data: cleanedMethodData
        }
      }));

      duplicatedMethods.push(cleanedMethodData);
      console.log(`✅ Duplicated method: ${method['namespace-method-name']} -> ${newMethodId}`);
    }

    // Get all schemas for this namespace
    const result = await docClient.send(new ScanCommand({
      TableName: 'brmh-schemas',
      FilterExpression: 'namespaceId = :nsid',
      ExpressionAttributeValues: { ':nsid': namespaceId }
    }));
    const schemas = result.Items || [];
    console.log(`📋 Found ${schemas.length} schemas to duplicate`);

    // Map old schema IDs to new schema IDs
    const schemaIdMap = {};
    const duplicatedSchemas = [];
    const newSchemaIds = [];

    // Duplicate all schemas
    for (const schema of schemas) {
      const newSchemaId = uuidv4();
      schemaIdMap[schema.id] = newSchemaId;
      newSchemaIds.push(newSchemaId);

      // Update method ID reference if it exists
      let newMethodId = schema.methodId;
      if (schema.methodId && methodIdMap[schema.methodId]) {
        newMethodId = methodIdMap[schema.methodId];
      }

      const newSchemaData = {
        id: newSchemaId,
        methodId: newMethodId,
        schemaName: `${schema.schemaName} (Copy)`,
        methodName: schema.methodName,
        namespaceId: newNamespaceId,
        schemaType: schema.schemaType,
        schema: schema.schema,
        isArray: schema.isArray,
        originalType: schema.originalType,
        url: schema.url,
        createdAt: timestamp,
        updatedAt: timestamp,
        duplicatedFrom: schema.id,
        duplicatedAt: timestamp
      };

      // Remove undefined values to prevent DynamoDB errors
      const cleanedSchemaData = Object.fromEntries(
        Object.entries(newSchemaData).filter(([_, value]) => value !== undefined)
      );

      await docClient.send(new PutCommand({
        TableName: 'brmh-schemas',
        Item: cleanedSchemaData
      }));

      duplicatedSchemas.push(cleanedSchemaData);
      console.log(`✅ Duplicated schema: ${schema.schemaName} -> ${newSchemaId}`);
    }

    // Update the namespace with schema IDs
    if (newSchemaIds.length > 0) {
      await docClient.send(new UpdateCommand({
        TableName: 'brmh-namespace',
        Key: { id: newNamespaceId },
        UpdateExpression: 'SET #data.#schemaIds = :schemaIds',
        ExpressionAttributeNames: { 
          '#data': 'data',
          '#schemaIds': 'schemaIds'
        },
        ExpressionAttributeValues: { 
          ':schemaIds': newSchemaIds
        }
      }));
    }

    console.log(`🎉 Namespace duplication completed successfully!`);
    
    return {
      success: true,
      namespace: cleanedNamespaceData,
      duplicatedAccounts: duplicatedAccounts.length,
      duplicatedMethods: duplicatedMethods.length,
      duplicatedSchemas: duplicatedSchemas.length,
      mapping: {
        namespaceId: newNamespaceId,
        accountIdMap,
        methodIdMap,
        schemaIdMap
      }
    };

  } catch (error) {
    console.error(`❌ Error duplicating namespace:`, error);
    throw new Error(`Failed to duplicate namespace: ${error.message}`);
  }
};

/**
 * Duplicate an account within the same namespace
 * @param {string} accountId - The account ID to duplicate
 * @param {string} newAccountName - Optional new name for the duplicated account
 * @returns {Object} The duplicated account
 */
const duplicateAccount = async (accountId, newAccountName = null) => {
  try {
    console.log(`🔄 Starting account duplication for: ${accountId}`);
    
    // Get the original account
    const response = await docClient.send(new GetCommand({
      TableName: 'brmh-namespace-accounts',
      Key: { id: accountId }
    }));

    if (!response.Item) {
      throw new Error('Account not found');
    }

    const originalAccount = response.Item.data;
    const newAccountId = uuidv4();
    const timestamp = new Date().toISOString();
    const accountName = newAccountName || `${originalAccount['namespace-account-name']} (Copy)`;

    console.log(`📋 Original account: ${originalAccount['namespace-account-name']}`);
    console.log(`📋 New account: ${accountName}`);

    // Create duplicated account
    const newAccountData = {
      'namespace-id': originalAccount['namespace-id'], // Keep same namespace
      'namespace-account-id': newAccountId,
      'namespace-account-name': accountName,
      'namespace-account-url-override': originalAccount['namespace-account-url-override'],
      'namespace-account-header': originalAccount['namespace-account-header'] || [],
      'variables': originalAccount['variables'] || [],
      'tags': [...(originalAccount['tags'] || []), 'duplicated'],
      'tableName': {}, // Empty initially, will be populated as methods are linked
      'duplicated-from': accountId,
      'duplicated-at': timestamp
    };

    // Remove undefined values to prevent DynamoDB errors
    const cleanedAccountData = Object.fromEntries(
      Object.entries(newAccountData).filter(([_, value]) => value !== undefined)
    );

    await docClient.send(new PutCommand({
      TableName: 'brmh-namespace-accounts',
      Item: {
        id: newAccountId,
        type: 'account',
        data: cleanedAccountData
      }
    }));

    console.log(`✅ Account duplicated successfully: ${newAccountId}`);

    return {
      success: true,
      account: cleanedAccountData,
      accountId: newAccountId
    };

  } catch (error) {
    console.error(`❌ Error duplicating account:`, error);
    throw new Error(`Failed to duplicate account: ${error.message}`);
  }
};

/**
 * Duplicate a method within the same namespace
 * @param {string} methodId - The method ID to duplicate
 * @param {string} newMethodName - Optional new name for the duplicated method
 * @returns {Object} The duplicated method
 */
const duplicateMethod = async (methodId, newMethodName = null) => {
  try {
    console.log(`🔄 Starting method duplication for: ${methodId}`);
    
    // Get the original method
    const originalMethod = await getNamespaceMethodById(methodId);
    if (!originalMethod) {
      throw new Error('Method not found');
    }

    const newMethodId = uuidv4();
    const timestamp = new Date().toISOString();
    const methodName = newMethodName || `${originalMethod['namespace-method-name']} (Copy)`;

    console.log(`📋 Original method: ${originalMethod['namespace-method-name']}`);
    console.log(`📋 New method: ${methodName}`);

    // Create duplicated method
    const newMethodData = {
      'namespace-id': originalMethod['namespace-id'], // Keep same namespace
      'namespace-method-id': newMethodId,
      'namespace-method-name': methodName,
      'namespace-method-type': originalMethod['namespace-method-type'],
      'namespace-method-url-override': originalMethod['namespace-method-url-override'],
      'namespace-method-queryParams': originalMethod['namespace-method-queryParams'] || [],
      'namespace-method-header': originalMethod['namespace-method-header'] || [],
      'save-data': originalMethod['save-data'],
      'isInitialized': originalMethod['isInitialized'],
      'tags': [...(originalMethod['tags'] || []), 'duplicated'],
      'sample-request': originalMethod['sample-request'],
      'sample-response': originalMethod['sample-response'],
      'request-schema': originalMethod['request-schema'],
      'response-schema': originalMethod['response-schema'],
      'duplicated-from': methodId,
      'duplicated-at': timestamp
    };

    // Remove undefined values to prevent DynamoDB errors
    const cleanedMethodData = Object.fromEntries(
      Object.entries(newMethodData).filter(([_, value]) => value !== undefined)
    );

    await docClient.send(new PutCommand({
      TableName: 'brmh-namespace-methods',
      Item: {
        id: newMethodId,
        type: 'method',
        data: cleanedMethodData
      }
    }));

    console.log(`✅ Method duplicated successfully: ${newMethodId}`);

    return {
      success: true,
      method: cleanedMethodData,
      methodId: newMethodId
    };

  } catch (error) {
    console.error(`❌ Error duplicating method:`, error);
    throw new Error(`Failed to duplicate method: ${error.message}`);
  }
};

/**
 * Duplicate a schema within the same namespace
 * @param {string} schemaId - The schema ID to duplicate
 * @param {string} newSchemaName - Optional new name for the duplicated schema
 * @returns {Object} The duplicated schema
 */
const duplicateSchema = async (schemaId, newSchemaName = null) => {
  try {
    console.log(`🔄 Starting schema duplication for: ${schemaId}`);
    
    // Get the original schema
    const originalSchema = await getSchema(schemaId);
    if (!originalSchema) {
      throw new Error('Schema not found');
    }

    const newSchemaId = uuidv4();
    const timestamp = new Date().toISOString();
    const schemaName = newSchemaName || `${originalSchema.schemaName} (Copy)`;

    console.log(`📋 Original schema: ${originalSchema.schemaName}`);
    console.log(`📋 New schema: ${schemaName}`);

    // Create duplicated schema
    const newSchemaData = {
      id: newSchemaId,
      methodId: originalSchema.methodId, // Keep same method reference or null
      schemaName: schemaName,
      methodName: originalSchema.methodName,
      namespaceId: originalSchema.namespaceId, // Keep same namespace
      schemaType: originalSchema.schemaType,
      schema: originalSchema.schema, // Deep copy the schema structure
      isArray: originalSchema.isArray,
      originalType: originalSchema.originalType,
      url: originalSchema.url,
      createdAt: timestamp,
      updatedAt: timestamp,
      duplicatedFrom: schemaId,
      duplicatedAt: timestamp
    };

    // Remove undefined values to prevent DynamoDB errors
    const cleanedSchemaData = Object.fromEntries(
      Object.entries(newSchemaData).filter(([_, value]) => value !== undefined)
    );

    await docClient.send(new PutCommand({
      TableName: 'brmh-schemas',
      Item: cleanedSchemaData
    }));

    // Update namespace's schemaIds array if namespace exists
    if (originalSchema.namespaceId) {
      try {
        const namespace = await getNamespaceById(originalSchema.namespaceId);
        if (namespace) {
          const currentSchemaIds = Array.isArray(namespace.schemaIds) ? namespace.schemaIds : [];
          const updatedSchemaIds = [...currentSchemaIds, newSchemaId];
          
          await docClient.send(new UpdateCommand({
            TableName: 'brmh-namespace',
            Key: { id: originalSchema.namespaceId },
            UpdateExpression: 'SET #data.#schemaIds = :schemaIds',
            ExpressionAttributeNames: { 
              '#data': 'data',
              '#schemaIds': 'schemaIds'
            },
            ExpressionAttributeValues: { 
              ':schemaIds': updatedSchemaIds
            }
          }));
        }
      } catch (err) {
        console.warn(`⚠️ Could not update namespace schemaIds: ${err.message}`);
      }
    }

    console.log(`✅ Schema duplicated successfully: ${newSchemaId}`);

    return {
      success: true,
      schema: cleanedSchemaData,
      schemaId: newSchemaId
    };

  } catch (error) {
    console.error(`❌ Error duplicating schema:`, error);
    throw new Error(`Failed to duplicate schema: ${error.message}`);
  }
};

// Export the new functions
export {
  // ... existing exports ...
  createIndexingConfig,
  getIndexingConfigsByTable,
  updateIndexingConfig,
  deleteIndexingConfig,
  // Duplication functions
  duplicateNamespace,
  duplicateAccount,
  duplicateMethod,
  duplicateSchema
};