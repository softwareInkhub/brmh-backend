import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import pkg from '@aws-sdk/lib-dynamodb';
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, UpdateCommand, DeleteCommand } = pkg;
import { CreateTableCommand, DeleteTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import Ajv from 'ajv';
import axios from 'axios';
import { SchemaType, SchemaGenerationError, SchemaValidationError, HttpMethod, PaginationType, TableStatus } from './unified-types.js';
import { saveSingleExecutionLog, savePaginatedExecutionLogs } from '../executionHandler.js';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

// Schema Generation and Validation
const validateInputData = (data) => {
  if (data === undefined) {
    throw new SchemaValidationError('Input data cannot be undefined');
  }

  // Allow null as a valid value
  if (data === null) {
    return;
  }

  if (typeof data !== 'object') {
    throw new SchemaValidationError('Input data must be an object or array');
  }

  // Allow empty arrays if they are explicitly provided
  if (Array.isArray(data) && data.length === 0) {
    return;
  }
};

const validateGeneratedSchema = (schema) => {
  if (!schema || typeof schema !== 'object') {
    throw new SchemaValidationError('Generated schema is invalid');
  }

  if (!schema.type) {
    throw new SchemaValidationError('Schema must have a type property');
  }

  // Allow null type schemas
  if (schema.type === SchemaType.NULL) {
    return;
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

    // Handle null data case
    if (data === null) {
      return {
        schema: { type: SchemaType.NULL },
        isArray: false,
        originalType: 'null'
      };
    }

    const isArray = Array.isArray(data);
    const dataToAnalyze = isArray ? (data.length > 0 ? data[0] : null) : data;
    
    const generatePropertySchema = (value, path = '') => {
      try {
        if (value === null) return { type: SchemaType.NULL };
        
        if (Array.isArray(value)) {
          if (value.length === 0) {
            // Return a schema for empty array with null items
            return { type: SchemaType.ARRAY, items: { type: SchemaType.NULL } };
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
              // Only add to required if the value is not null
              if (val !== null) {
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
      originalType: isArray ? 'array' : (dataToAnalyze === null ? 'null' : typeof dataToAnalyze)
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

const validateSchema = (schema, data) => {
  const ajv = new Ajv();
  const validate = ajv.compile(schema);
  const valid = validate(data);
  return {
    valid,
    errors: valid ? [] : (validate.errors || []).map(e => `${e.instancePath} ${e.message}`)
  };
};

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
const saveSchema = async (schemaData) => {
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
    } = schemaData;

    if (!schema) {
      throw new Error('schema is required');
    }

    const schemaId = uuidv4();
    const timestamp = new Date().toISOString();

    const item = {
      id: schemaId,
      methodId: methodId || null,
      schemaName: schemaName || methodName || '',
      namespaceId,
      schemaType,
      schema,
      isArray,
      originalType,
      url,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await docClient.send(new PutCommand({
      TableName: 'brmh-schemas',
      Item: item
    }));

    return { schemaId };
  } catch (error) {
    throw new Error(`Failed to save schema: ${error.message}`);
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

// API Execution Operations
const executeNamespaceRequest = async ({ method, url, queryParams, headers, body }) => {
  try {
    const response = await axios({
      method,
      url,
      params: queryParams,
      headers,
      data: body
    });
    return response.data;
  } catch (error) {
    throw new Error(`Failed to execute request: ${error.message}`);
  }
};

const executeNamespacePaginatedRequest = async ({ method, url, maxIterations = 10, paginationType = PaginationType.LINK, queryParams, headers, body }) => {
  try {
    let allData = [];
    let currentUrl = url;
    let iterations = 0;
    let totalItems = 0;
    const executionId = uuidv4();

    while (currentUrl && iterations < maxIterations) {
      const response = await axios({
        method,
        url: currentUrl,
        params: queryParams,
        headers,
        data: body
      });

      const responseData = response.data;
      totalItems += Array.isArray(responseData) ? responseData.length : 1;
      allData = allData.concat(Array.isArray(responseData) ? responseData : [responseData]);

      if (paginationType === PaginationType.LINK) {
        const linkHeader = response.headers.link;
        if (!linkHeader) break;
        currentUrl = extractNextUrl(linkHeader);
      } else {
        const nextBookmark = extractBookmark(responseData);
        if (!nextBookmark) break;
        queryParams = { ...queryParams, bookmark: nextBookmark };
      }

      iterations++;
    }

    return {
      status: 200,
      metadata: {
        totalPages: iterations,
        totalItems,
        executionId,
        paginationType
      },
      data: allData
    };
  } catch (error) {
    throw new Error(`Failed to execute paginated request: ${error.message}`);
  }
};

const extractNextUrl = (linkHeader) => {
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
};

const extractBookmark = (responseData) => {
  return responseData.next_bookmark || responseData.next_cursor || null;
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

    const updatedData = {
      ...existingNamespace,
      'namespace-name': updates['namespace-name'],
      'namespace-url': updates['namespace-url'],
      'tags': updates['tags'] || []
    };

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

const createNamespaceMethod = async (namespaceId, methodData) => {
  try {
    const methodId = uuidv4();
    const item = {
      id: methodId,
      type: 'method',
      data: {
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
      }
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
    const response = await docClient.send(new GetCommand({
      TableName: 'brmh-namespace-methods',
      Key: { id: methodId }
    }));

    if (!response.Item) {
      throw new Error('Method not found');
    }

    const existingMethod = response.Item;
    const updatedData = {
      ...existingMethod.data,
      'namespace-method-name': updates['namespace-method-name'],
      'namespace-method-type': updates['namespace-method-type'],
      'namespace-method-url-override': updates['namespace-method-url-override'] || '',
      'namespace-method-queryParams': updates['namespace-method-queryParams'] || [],
      'namespace-method-header': updates['namespace-method-header'] || [],
      'save-data': !!updates['save-data'],
      'isInitialized': !!updates['isInitialized'],
      'tags': updates['tags'] || [],
      'sample-request': updates['sample-request'] || null,
      'sample-response': updates['sample-response'] || null,
      'request-schema': updates['request-schema'] || null,
      'response-schema': updates['response-schema'] || null
    };

    await docClient.send(new PutCommand({
      TableName: 'brmh-namespace-methods',
      Item: {
        id: methodId,
        type: 'method',
        data: updatedData
      }
    }));

    return updatedData;
  } catch (error) {
    throw new Error(`Failed to update namespace method: ${error.message}`);
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

// --- WRAPPED HANDLERS FOR OPENAPI BACKEND ---

// Schema Operations
const generateSchemaHandler = async (c, req, res) => {
  try {
    const { data } = c.request.requestBody || {};
    const result = generateSchema(data);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 400, body: { error: error.message } };
  }
};

const validateSchemaHandler = async (c, req, res) => {
  try {
    const { schema, data } = c.request.requestBody || {};
    const result = validateSchema(schema, data);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 400, body: { error: error.message } };
  }
};

const saveSchemaHandler = async (c, req, res) => {
  try {
    const result = await saveSchema(c.request.requestBody);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
};

const getSchemaHandler = async (c, req, res) => {
  try {
    const { schemaId } = c.request.params;
    const result = await getSchema(schemaId);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 404, body: { error: error.message } };
  }
};

const updateSchemaHandler = async (c, req, res) => {
  try {
    const { schemaId } = c.request.params;
    const result = await updateSchema(schemaId, c.request.requestBody);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
};

const deleteSchemaHandler = async (c, req, res) => {
  try {
    const { schemaId } = c.request.params;
    await deleteSchema(schemaId);
    return { statusCode: 204 };
  } catch (error) {
    return { statusCode: 404, body: { error: error.message } };
  }
};

const listSchemasHandler = async (c, req, res) => {
  try {
    const result = await listSchemas();
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
};

// Table Operations
const createSchemasTableHandler = async (c, req, res) => {
  try {
    const result = await createSchemasTable(c.request.requestBody);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
};

const deleteSchemasTableHandler = async (c, req, res) => {
  try {
    const { tableName } = c.request.requestBody || {};
    const result = await deleteSchemasTable(tableName);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
};

const insertSchemaDataHandler = async (c, req, res) => {
  try {
    const result = await insertSchemaData(c.request.requestBody);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
};

const listSchemaTableMetaHandler = async (c, req, res) => {
  try {
    const result = await listSchemaTableMeta();
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
};

const getSchemaTableMetaHandler = async (c, req, res) => {
  try {
    const { metaId } = c.request.params;
    const result = await getSchemaTableMeta(metaId);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 404, body: { error: error.message } };
  }
};

const checkAndUpdateTableStatusHandler = async (c, req, res) => {
  try {
    const { metaId } = c.request.params;
    const result = await checkAndUpdateTableStatus(metaId);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
};

const getTableItemsHandler = async (c, req, res) => {
  try {
    const { tableName } = c.request.params;
    const result = await getTableItems(tableName);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 404, body: { error: error.message } };
  }
};

const getSchemaByTableNameHandler = async (c, req, res) => {
  try {
    const { tableName } = c.request.params;
    const result = await getSchemaByTableName(tableName);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 404, body: { error: error.message } };
  }
};

const checkAllTableStatusesHandler = async (c, req, res) => {
  try {
    const result = await checkAllTableStatuses();
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
};

// API Execution
const executeNamespaceRequestHandler = async (c, req, res) => {
  try {
    const result = await executeNamespaceRequest(c.request.requestBody);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
};

const executeNamespacePaginatedRequestHandler = async (c, req, res) => {
  try {
    const result = await executeNamespacePaginatedRequest(c.request.requestBody);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
};

// Namespace Operations (getNamespaces already fixed above)
const getNamespaceByIdHandler = async (c, req, res) => {
  try {
    const { namespaceId } = c.request.params;
    const result = await getNamespaceById(namespaceId);
    if (!result) return { statusCode: 404, body: { error: 'Namespace not found' } };
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
};

const createNamespaceHandler = async (c, req, res) => {
  try {
    const result = await createNamespace(c.request.requestBody);
    return { statusCode: 201, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
};

const updateNamespaceHandler = async (c, req, res) => {
  try {
    const { namespaceId } = c.request.params;
    const result = await updateNamespace(namespaceId, c.request.requestBody);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
};

const deleteNamespaceHandler = async (c, req, res) => {
  try {
    const { namespaceId } = c.request.params;
    await deleteNamespace(namespaceId);
    return { statusCode: 204 };
  } catch (error) {
    return { statusCode: 404, body: { error: error.message } };
  }
};

// Namespace Account Operations
const getNamespaceAccountsHandler = async (c, req, res) => {
  try {
    const { namespaceId } = c.request.params;
    const result = await getNamespaceAccounts(namespaceId);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
};

const createNamespaceAccountHandler = async (c, req, res) => {
  try {
    const { namespaceId } = c.request.params;
    const result = await createNamespaceAccount(namespaceId, c.request.requestBody);
    return { statusCode: 201, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
};

const updateNamespaceAccountHandler = async (c, req, res) => {
  try {
    const { accountId } = c.request.params;
    const result = await updateNamespaceAccount(accountId, c.request.requestBody);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
};

const deleteNamespaceAccountHandler = async (c, req, res) => {
  try {
    const { accountId } = c.request.params;
    await deleteNamespaceAccount(accountId);
    return { statusCode: 204 };
  } catch (error) {
    return { statusCode: 404, body: { error: error.message } };
  }
};

// Namespace Method Operations
const getNamespaceMethodsHandler = async (c, req, res) => {
  try {
    const { namespaceId } = c.request.params;
    const result = await getNamespaceMethods(namespaceId);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
};

const createNamespaceMethodHandler = async (c, req, res) => {
  try {
    const { namespaceId } = c.request.params;
    const result = await createNamespaceMethod(namespaceId, c.request.requestBody);
    return { statusCode: 201, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
};

const updateNamespaceMethodHandler = async (c, req, res) => {
  try {
    const { methodId } = c.request.params;
    const result = await updateNamespaceMethod(methodId, c.request.requestBody);
    return { statusCode: 200, body: result };
  } catch (error) {
    return { statusCode: 500, body: { error: error.message } };
  }
};

const deleteNamespaceMethodHandler = async (c, req, res) => {
  try {
    const { methodId } = c.request.params;
    await deleteNamespaceMethod(methodId);
    return { statusCode: 204 };
  } catch (error) {
    return { statusCode: 404, body: { error: error.message } };
  }
};

// Export all wrapped handlers
export const handlers = {
  // Schema Operations
  generateSchema: generateSchemaHandler,
  validateSchema: validateSchemaHandler,
  saveSchema: saveSchemaHandler,
  getSchema: getSchemaHandler,
  updateSchema: updateSchemaHandler,
  deleteSchema: deleteSchemaHandler,
  listSchemas: listSchemasHandler,

  // Table Operations
  createSchemasTable: createSchemasTableHandler,
  deleteSchemasTable: deleteSchemasTableHandler,
  insertSchemaData: insertSchemaDataHandler,
  listSchemaTableMeta: listSchemaTableMetaHandler,
  getSchemaTableMeta: getSchemaTableMetaHandler,
  checkAndUpdateTableStatus: checkAndUpdateTableStatusHandler,
  getTableItems: getTableItemsHandler,
  getSchemaByTableName: getSchemaByTableNameHandler,
  checkAllTableStatuses: checkAllTableStatusesHandler,

  // API Execution
  executeNamespaceRequest: executeNamespaceRequestHandler,
  executeNamespacePaginatedRequest: executeNamespacePaginatedRequestHandler,

  // Namespace Operations
  getNamespaces,
  getNamespaceById: getNamespaceByIdHandler,
  createNamespace: createNamespaceHandler,
  updateNamespace: updateNamespaceHandler,
  deleteNamespace: deleteNamespaceHandler,

  // Namespace Account Operations
  getNamespaceAccounts: getNamespaceAccountsHandler,
  createNamespaceAccount: createNamespaceAccountHandler,
  updateNamespaceAccount: updateNamespaceAccountHandler,
  deleteNamespaceAccount: deleteNamespaceAccountHandler,

  // Namespace Method Operations
  getNamespaceMethods: getNamespaceMethodsHandler,
  createNamespaceMethod: createNamespaceMethodHandler,
  updateNamespaceMethod: updateNamespaceMethodHandler,
  deleteNamespaceMethod: deleteNamespaceMethodHandler
}; 