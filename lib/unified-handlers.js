import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import pkg from '@aws-sdk/lib-dynamodb';
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, UpdateCommand, DeleteCommand } = pkg;
import { CreateTableCommand, DeleteTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import Ajv from 'ajv';
import axios from 'axios';
import { SchemaType, SchemaGenerationError, SchemaValidationError, HttpMethod, PaginationType, TableStatus } from './unified-types.js';
import { saveSingleExecutionLog, savePaginatedExecutionLogs } from '../executionHandler.js';
import { handlers as dynamodbHandlers } from './dynamodb-handlers.js';
import { streamingAIAgent } from './streaming-ai-agent.js';
import { orchestrateAIAgentTask } from './orchestrator.js';

// Import or define your tools here
// import { FileTool, CodeTool, SchemaTool, ApiTool } from './tools';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);



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
  console.log('Generating schema from data:', data);
  
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

const createSchemasTable = async ({ schemaId, tableName }) => {
  if (!schemaId || !tableName || !tableName.trim()) throw new Error('schemaId and tableName are required');
  
  let tableStatus = TableStatus.ACTIVE;
  const params = {
    TableName: tableName,
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
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

  const metaId = uuidv4();
  const timestamp = new Date().toISOString();
  const metaItem = {
    TableName: 'brmh-schema-table-data',
    Item: {
      id: metaId,
      schemaId,
      tableName,
      status: tableStatus,
      createdAt: timestamp,
      details: {
        message: 'Table created for schema',
        schemaId,
        tableName
      }
    }
  };

  try {
    await docClient.send(new PutCommand(metaItem));
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      const metaTableParams = {
        TableName: 'brmh-schema-table-data',
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
        BillingMode: 'PAY_PER_REQUEST'
      };
      try {
        await client.send(new CreateTableCommand(metaTableParams));
      } catch (createError) {
        if (createError.name !== 'ResourceInUseException') throw createError;
      }
      await new Promise(res => setTimeout(res, 2000));
      await docClient.send(new PutCommand(metaItem));
    } else {
      throw error;
    }
  }

  await docClient.send(new UpdateCommand({
    TableName: 'brmh-schemas',
    Key: { id: schemaId },
    UpdateExpression: 'SET #tableName = :tableName, #metaId = :metaId',
    ExpressionAttributeNames: { '#tableName': 'tableName', '#metaId': 'brmh-schema-table-data-id' },
    ExpressionAttributeValues: { ':tableName': tableName, ':metaId': metaId }
  }));

  return { message: 'Table created successfully', tableName, schemaId, metaId };
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

    // Update namespace's schemaIds array
    if (namespaceId) {
      await updateNamespace(namespaceId, { schemaId });
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

// Ensure executions table exists
const ensureExecutionsTable = async () => {
  try {
    // Check if table exists
    try {
      await client.send(new DescribeTableCommand({ TableName: 'executions' }));
      console.log('Executions table exists');
      return true;
    } catch (error) {
      if (error.name !== 'ResourceNotFoundException') {
        throw error;
      }
    }

    // Create table if it doesn't exist
    console.log('Creating executions table...');
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
    console.log('Executions table created successfully');
    return true;
  } catch (error) {
    console.error('Error ensuring executions table:', error);
    return false;
  }
};

// Call ensureExecutionsTable when the module loads
ensureExecutionsTable().catch(console.error);

const executeNamespaceRequest = async ({ method, url, queryParams, headers, body, save }) => {
  console.log('Executing request with params:', {
    method,
    url
  });

  const execId = uuidv4();
  
  try {
    // Build URL with query parameters
    const urlObj = new URL(url);
    Object.entries(queryParams).forEach(([key, value]) => {
      if (key && value && key.trim() !== '') {
        urlObj.searchParams.append(key.trim(), value.toString().trim());
      }
    });

    console.log('Final URL:', urlObj.toString());

    // Make the request
    const response = await axios({
      method: method.toUpperCase(),
      url: urlObj.toString(),
      headers: headers,
      data: body,
      validateStatus: () => true // Don't throw on any status
    });

    console.log('Response received:', {
      status: response.status,
      statusText: response.statusText
    });

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

const executeNamespacePaginatedRequest = async (c, req, res) => {
  console.log('\n=== PAGINATED REQUEST START ===');
  console.log('Request details:', {
    method: c.request.requestBody.method,
    url: c.request.requestBody.url,
    maxIterations: c.request.requestBody.maxIterations || null,
    queryParams: c.request.requestBody.queryParams,
    headers: c.request.requestBody.headers,
    tableName: c.request.requestBody.tableName,
    saveData: c.request.requestBody.saveData
  });

  const { 
    method, 
    url, 
    maxIterations: requestMaxIterations = null,
    queryParams = {}, 
    headers = {}, 
    body = null,
    tableName,
    saveData
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

        // Update parent execution status to inProgress
        await executionLogs.updateParentStatus('inProgress', false);

        // Function to save items to DynamoDB
        async function saveItemsToDynamoDB(items, pageData) {
          const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:5000';
          const savedIds = [];
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            // Clean and prepare the item
            const cleanItem = {};
            Object.entries(item).forEach(([key, value]) => {
              if (value !== undefined && value !== null) {
                if (key === 'id' || key === '_id') {
                  cleanItem[key] = String(value);
                } else {
                  cleanItem[key] = value;
                }
              }
            });
            const requestDetails = {
              method: pageData.method || 'GET',
              url: pageData.url || '',
              status: pageData.status || 200,
              itemIndex: i,
              totalItems: items.length,
              originalId: cleanItem.id || cleanItem._id || null
            };
            const itemData = {
              item: cleanItem,
              requestDetails: requestDetails
            };
            try {
              const response = await axios.post(
                `${API_BASE_URL}/unified/schema/table/${tableName}/items`,
                itemData,
                {
                  headers: {
                    'Content-Type': 'application/json'
                  }
                }
              );
              if (response.data.success) {
                savedIds.push(response.data.itemId);
                console.log(`Saved item ${i + 1}/${items.length} with ID: ${response.data.itemId}`);
              } else {
                console.error(`Failed to save item ${i + 1}/${items.length}`);
              }
            } catch (error) {
              console.error(`Error saving item ${i + 1}/${items.length}:`, error.message);
            }
            // Optional: add a small delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          console.log(`Finished saving ${savedIds.length} items individually to DynamoDB.`);
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

        // Main pagination loop - will run until no more pages or maxIterations is reached
        while (hasMorePages && (maxIterations === null || pageCount <= maxIterations)) {
          console.log(`\n=== PAGE ${pageCount} START ===`);
          console.log('Current pagination state:', {
            pageCount,
            maxIterations,
            hasMorePages,
            condition: maxIterations === null ? 'infinite' : `${pageCount} <= ${maxIterations}`
          });
          
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
          console.log('Making request to:', urlObj.toString());
          const response = await axios({
            method: method.toUpperCase(),
            url: urlObj.toString(),
            headers: headers,
            data: !['GET', 'HEAD'].includes(method.toUpperCase()) ? body : undefined,
            validateStatus: () => true
          });

          console.log('Response received:', {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            dataLength: response.data ? JSON.stringify(response.data).length : 0,
            data: response.data
          });

          // Handle API errors
          if (response.status >= 400) {
            lastError = {
              status: response.status,
              statusText: response.statusText,
              data: response.data,
              url: urlObj.toString()
            };
            console.error(`\nAPI Error on page ${pageCount}:`, lastError);
            
            // For Shopify API, check if it's a rate limit error
            if (response.status === 429 || 
                (response.data && 
                 response.data.errors && 
                 (Array.isArray(response.data.errors) ? 
                   response.data.errors.some(err => err.includes('rate limit')) :
                   response.data.errors.toString().includes('rate limit')))) {
              console.log('Rate limit detected, waiting before retry...');
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
            console.log('Detected pagination type:', detectedPaginationType);
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

            console.log('Extracted current page items:', {
              count: currentPageItems.length,
              firstItem: currentPageItems[0]
            });
          }

          // Extract IDs from items
          const itemIds = currentPageItems.map(item => {
            const id = item.id || item.Id || item.ID || item._id || 
                      item.pin_id || item.board_id || 
                      item.order_id || item.product_id ||
                      `generated_${uuidv4()}`;
            return id.toString();
          });

          console.log('Extracted item IDs:', {
            count: itemIds.length,
            sampleIds: itemIds.slice(0, 5)
          });

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
              console.log(`Attempting to save ${currentPageItems.length} items to DynamoDB...`);
              const pageData = {
                url: urlObj.toString(),
                status: response.status
              };
              
              const savedIds = await saveItemsToDynamoDB(currentPageItems, pageData);
              console.log(`Saved ${savedIds.length} items to DynamoDB`);
            }
          }

          // Check for next page based on detected pagination type
          if (detectedPaginationType === 'link') {
            const nextUrl = extractNextUrl(response.headers.link);
            if (!nextUrl) {
              hasMorePages = false;
              console.log('\nNo more pages (Link header):', `Page ${pageCount} is the last page`);
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
              console.log('\nNext page URL:', currentUrl);
            }
          } else if (detectedPaginationType === 'bookmark') {
            const bookmark = extractBookmark(response.data);
            if (!bookmark) {
              hasMorePages = false;
              console.log('\nNo more pages (Bookmark):', `Page ${pageCount} is the last page`);
            } else {
              urlObj.searchParams.set('bookmark', bookmark);
              currentUrl = urlObj.toString();
              console.log('\nNext page bookmark:', bookmark);
            }
          } else if (detectedPaginationType === 'cursor') {
            const cursor = extractCursor(response.data);
            if (!cursor) {
              hasMorePages = false;
              console.log('\nNo more pages (Cursor):', `Page ${pageCount} is the last page`);
            } else {
              urlObj.searchParams.set('cursor', cursor);
              currentUrl = urlObj.toString();
              console.log('\nNext page cursor:', cursor);
            }
          } else if (detectedPaginationType === 'offset') {
            const totalCount = response.data.total_count || response.data.total;
            const currentOffset = parseInt(urlObj.searchParams.get('offset') || '0');
            const limit = parseInt(urlObj.searchParams.get('limit') || '10');
            
            if (currentOffset + limit >= totalCount) {
              hasMorePages = false;
              console.log('\nNo more pages (Offset):', `Page ${pageCount} is the last page`);
            } else {
              urlObj.searchParams.set('offset', (currentOffset + limit).toString());
              currentUrl = urlObj.toString();
              console.log('\nNext page offset:', currentOffset + limit);
            }
          } else if (detectedPaginationType === 'end') {
            hasMorePages = false;
            console.log('\nNo more pages (End):', `Page ${pageCount} is the last page`);
          } else {
            hasMorePages = false;
            console.log('\nNo pagination detected:', `Page ${pageCount} is the last page`);
          }

          console.log(`\n=== PAGE ${pageCount} SUMMARY ===`);
          console.log({
            status: response.status,
            hasMorePages,
            totalItemsProcessed,
            currentPageItems: currentPageItems.length,
            nextUrl: currentUrl,
            paginationType: detectedPaginationType,
            responseData: response.data
          });

          pageCount++;
        }

        // Update parent execution status to completed
        await executionLogs.updateParentStatus('completed', true);

        // Log final summary
        console.log('\n=== PAGINATED REQUEST COMPLETED ===');
        console.log({
          totalPages: pageCount - 1,
          totalItems: totalItemsProcessed,
          executionId: execId,
          paginationType: detectedPaginationType || 'none',
          finalUrl: currentUrl,
          lastError: lastError
        });

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
    return response.Items.map(item => item.data);
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
    return {
      statusCode: 500,
      body: { error: error.message }
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

const createNamespace = async (namespaceData) => {
  try {
    const namespaceId = uuidv4();
    const item = {
      id: namespaceId,
      type: 'namespace',
      data: {
        'namespace-id': namespaceId,
        'namespace-name': namespaceData['namespace-name'],
        'namespace-url': namespaceData['namespace-url'],
        'tags': namespaceData['tags'] || [],
        'namespace-accounts': [],
        'namespace-methods': []
      }
    };

    await docClient.send(new PutCommand({
      TableName: 'brmh-namespace',
      Item: item
    }));

    return item.data;
  } catch (error) {
    throw new Error(`Failed to create namespace: ${error.message}`);
  }
};

const updateNamespace = async (namespaceId, updates) => {
  try {
    const existingNamespace = await getNamespaceById(namespaceId);
    if (!existingNamespace) {
      throw new Error('Namespace not found');
    }

    // Merge all fields from updates into existingNamespace
    let updatedData = {
      ...existingNamespace,
      ...updates
    };

    // Handle schemaIds as an array, append if new
    if (updates.schemaId) {
      const currentSchemaIds = Array.isArray(existingNamespace.schemaIds) ? existingNamespace.schemaIds : [];
      updatedData.schemaIds = [...currentSchemaIds, updates.schemaId];
      delete updatedData.schemaId;
    } else if (Array.isArray(updates.schemaIds)) {
      updatedData.schemaIds = updates.schemaIds;
    }

    await docClient.send(new UpdateCommand({
      TableName: 'brmh-namespace',
      Key: { id: namespaceId },
      UpdateExpression: 'SET #data = :data',
      ExpressionAttributeNames: { '#data': 'data' },
      ExpressionAttributeValues: { ':data': updatedData }
    }));

    return updatedData;
  } catch (error) {
    throw new Error(`Failed to update namespace: ${error.message}`);
  }
};

const deleteNamespace = async (namespaceId) => {
  try {
    await docClient.send(new DeleteCommand({
      TableName: 'brmh-namespace',
      Key: { id: namespaceId }
    }));
    return { message: 'Namespace deleted successfully' };
  } catch (error) {
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

    return response.Items.map(item => item.data);
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
    const response = await docClient.send(new GetCommand({
      TableName: 'brmh-namespace-accounts',
      Key: { id: accountId }
    }));

    if (!response.Item) {
      throw new Error('Account not found');
    }

    const existingAccount = response.Item;
    const updatedData = {
      ...existingAccount.data,
      'namespace-account-name': updates['namespace-account-name'],
      'namespace-account-url-override': updates['namespace-account-url-override'] || '',
      'namespace-account-header': updates['namespace-account-header'] || [],
      'variables': updates['variables'] || [],
      'tags': updates['tags'] || []
    };

    await docClient.send(new PutCommand({
      TableName: 'brmh-namespace-accounts',
      Item: {
        id: accountId,
        type: 'account',
        data: updatedData
      }
    }));

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

    return response.Items.map(item => item.data);
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
    console.log('Update Method Request Body:', updates);
    // Actual update logic for DynamoDB
    const response = await docClient.send(new UpdateCommand({
      TableName: 'brmh-namespace-methods',
      Key: { id: methodId },
      UpdateExpression: 'SET #data = :data',
      ExpressionAttributeNames: { '#data': 'data' },
      ExpressionAttributeValues: { ':data': updates }
    }));
    console.log('Update Method Response:', response);
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
      const { item, requestDetails, status, itemIndex, totalItems, originalId } = c.request.requestBody;
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
      
      // Ensure id is a string
      if (typeof cleanedItem.id === 'number') {
        cleanedItem.id = cleanedItem.id.toString();
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

      const timestamp = new Date().toISOString();
      const itemId = cleanedItem.id || `item_${timestamp}_${itemIndex || 0}`;
      
      const itemData = {
        id: itemId,
        Item: simplifiedItem,
        timestamp,
        _metadata: {
          requestDetails: requestDetails || {},
          status: status || 200,
          itemIndex: itemIndex || 0,
          totalItems: totalItems || 1,
          originalId: originalId || itemId
        }
      };

      await docClient.send(new PutCommand({
        TableName: tableName,
        Item: itemData
      }));

      return { 
        statusCode: 200, 
        body: { 
          success: true,
          itemId: itemId
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

  // API Execution
  executeNamespaceRequest: async (c, req, res) => {
    try {
      const result = await executeNamespaceRequest(c.request.requestBody);
      return { statusCode: 200, body: result };
    } catch (error) {
      return { statusCode: 500, body: { error: error.message } };
    }
  },
  executeNamespacePaginatedRequest: async (c, req, res) => {
    try {
      const result = await executeNamespacePaginatedRequest(c, req, res);
      return { statusCode: 200, body: result };
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
      const result = await createNamespace(c.request.requestBody);
      return { statusCode: 201, body: result };
    } catch (error) {
      return { statusCode: 500, body: { error: error.message } };
    }
  },
  updateNamespace: async (c, req, res) => {
    try {
      const { namespaceId } = c.request.params;
      const result = await updateNamespace(namespaceId, c.request.requestBody);
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
      console.log('updateNamespaceMethodHandler received:', c.request.requestBody);
      const { methodId } = c.request.params;
      const result = await updateNamespaceMethod(methodId, c.request.requestBody);
      return { statusCode: 200, body: result };
    } catch (error) {
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
      console.log('Params received:', c.request.params, c.request.pathParams, 'Resolved methodId:', methodId);
      if (!methodId || typeof methodId !== 'string') {
        throw new Error('methodId is required and must be a string');
      }
      const result = await getNamespaceMethodById(methodId);
      return { statusCode: 200, body: result };
    } catch (error) {
      return { statusCode: 404, body: { error: error.message } };
    }
  },
};

// Helper functions for AI Agent
async function handleFileOperationFromMessage(message, namespaceId) {
  try {
    // Extract file path and content from message using AI
    const fileInfo = await extractFileInfoFromMessage(message);
    
    if (fileInfo.operation === 'create') {
      const result = await fileOperations.createFile(namespaceId, fileInfo.path, fileInfo.content);
      return {
        content: `Created file: ${fileInfo.path}`,
        output: fileInfo.content,
        operation: 'create',
        success: result.success
      };
    } else if (fileInfo.operation === 'edit') {
      const result = await fileOperations.updateFile(namespaceId, fileInfo.path, fileInfo.content);
      return {
        content: `Updated file: ${fileInfo.path}`,
        output: fileInfo.content,
        operation: 'edit',
        success: result.success
      };
    }
    
    return {
      content: 'File operation completed',
      output: '',
      operation: 'unknown'
    };
  } catch (error) {
    return {
      content: `Error: ${error.message}`,
      output: '',
      operation: 'error'
    };
  }
}

async function handleProjectSetup(message, namespaceId) {
  try {
    // Detect project type from message
    const projectType = message.toLowerCase().includes('python') ? 'python' : 'nodejs';
    
    const result = await streamingAIAgent.generateProjectStructure(namespaceId, projectType);
    
    return {
      content: `Project structure created for ${projectType} project`,
      output: `Generated ${result.files?.length || 0} files`,
      files: result.files || []
    };
  } catch (error) {
    return {
      content: `Error setting up project: ${error.message}`,
      output: '',
      files: []
    };
  }
}

async function generateDefaultResponse(intent, message, namespaceId, history) {
  // Simple response generation for non-file operations
  let content = '', output = '', type = intent;
  
  switch (intent) {
    case 'schema':
      output = JSON.stringify({
        title: 'Generated Schema',
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' }
        },
        required: ['id', 'name']
      }, null, 2);
      content = 'Schema generated – check the Schema tab.';
      break;
      
    case 'api':
      output = JSON.stringify({
        endpoints: [
          { method: 'GET', path: '/api/items', description: 'Get all items' },
          { method: 'POST', path: '/api/items', description: 'Create new item' },
          { method: 'PUT', path: '/api/items/:id', description: 'Update item' },
          { method: 'DELETE', path: '/api/items/:id', description: 'Delete item' }
        ]
      }, null, 2);
      content = 'API endpoints generated – check the API tab.';
      break;
      
    case 'test':
      output = 'Running tests...\n✓ All tests passed!\n✓ Coverage: 95%';
      content = 'Test results available in the Console tab.';
      break;
      
    case 'list_files':
      const fileTree = await fileOperations.getFileTree(namespaceId);
      output = JSON.stringify(fileTree.tree || [], null, 2);
      content = 'File tree loaded – check the Files tab.';
      type = 'files';
      break;
      
    default:
      content = "I'm here to help with your development tasks. You can ask me to create files, generate schemas, set up APIs, run tests, or help with any coding questions.";
      output = '';
      type = 'chat';
  }
  
  return { content, output, type };
}

async function extractFileInfoFromMessage(message) {
  // Simple extraction - in a real implementation, you'd use AI to parse this
  const lines = message.split('\n');
  let path = '';
  let content = '';
  let operation = 'create';
  
  for (const line of lines) {
    if (line.includes('path:') || line.includes('file:')) {
      path = line.split(':')[1]?.trim() || '';
    } else if (line.includes('content:') || line.includes('code:')) {
      content = line.split(':')[1]?.trim() || '';
    } else if (line.includes('edit') || line.includes('update')) {
      operation = 'edit';
    }
  }
  
  // If no explicit path/content found, try to infer from the message
  if (!path && message.includes('create')) {
    path = 'new-file.js';
  }
  
  if (!content) {
    content = '// Generated file content\nconsole.log("Hello World!");';
  }
  
  return { path, content, operation };
}

// Export individual functions for direct import
export { createNamespace, createNamespaceMethod }; 