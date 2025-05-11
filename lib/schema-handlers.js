import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import pkg from '@aws-sdk/lib-dynamodb';
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, UpdateCommand, DeleteCommand } = pkg;
import { CreateTableCommand, DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { SchemaType } from './schema-types.js';
import Ajv from 'ajv';


const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

// Custom error classes
class SchemaGenerationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'SchemaGenerationError';
    this.details = details;
  }
}

class SchemaValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'SchemaValidationError';
    this.details = details;
  }
}

// Validate input data
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

// Validate generated schema
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

// Generate schema from JSON data
const generateSchema = (data) => {
  console.log('Generating schema from data:', data);
  
  try {
    // Validate input data
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
    
    // Validate generated schema
    validateGeneratedSchema(schema);

    const result = {
    schema,
    isArray,
    originalType: isArray ? 'array' : typeof dataToAnalyze
  };

    return result;
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

// Create schemas table
const createSchemasTable = async (tableName = 'schemas') => {
  const params = {
    TableName: tableName,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  try {
    await client.send(new CreateTableCommand(params));
    return { message: 'Table created successfully', tableName };
  } catch (error) {
    if (error.name === 'ResourceInUseException') {
      throw new Error('Table already exists');
    }
    throw new Error(`Failed to create table: ${error.message}`);
  }
};

// Delete schemas table
const deleteSchemasTable = async (tableName = 'schemas') => {
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

// Save schema to DynamoDB
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

    // Validate required fields
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

    console.log('[saveSchema] Saving item to DynamoDB:', JSON.stringify(item, null, 2));

      await docClient.send(new PutCommand({
        TableName: 'schemas',
        Item: item
      }));

    console.log('[saveSchema] Saved schema with id:', schemaId);
    return { schemaId };
  } catch (error) {
    throw new Error(`Failed to save schema: ${error.message}`);
  }
};

// Get schema by ID
const getSchema = async (schemaId) => {
  try {
    if (!schemaId) {
      throw new Error('schemaId is required');
    }

    console.log('[getSchema] Fetching schema with id:', schemaId);
    const result = await docClient.send(new GetCommand({
      TableName: 'schemas',
      Key: { id: schemaId }
    }));

    if (!result.Item) {
      console.log('[getSchema] No item found for id:', schemaId);
      throw new Error('Schema not found');
    }

    console.log('[getSchema] Retrieved item:', JSON.stringify(result.Item, null, 2));
    return result.Item;
  } catch (error) {
    throw new Error(`Failed to get schema: ${error.message}`);
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

// Update schema
const updateSchema = async (schemaId, updates) => {
  try {
    if (!schemaId) {
      throw new Error('schemaId is required');
    }

    // First check if schema exists
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
      TableName: 'schemas',
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

// Delete schema
const deleteSchema = async (schemaId) => {
  try {
    if (!schemaId) {
      throw new Error('schemaId is required');
  }

    // First check if schema exists
    const existingSchema = await getSchema(schemaId);
    if (!existingSchema) {
      throw new Error('Schema not found');
    }

    await docClient.send(new DeleteCommand({
      TableName: 'schemas',
      Key: { id: schemaId }
    }));
  } catch (error) {
    throw new Error(`Failed to delete schema: ${error.message}`);
  }
};

// List all schemas
const listSchemas = async () => {
  try {
    const result = await docClient.send(new ScanCommand({
      TableName: 'schemas'
    }));
    return result.Items || [];
  } catch (error) {
    throw new Error(`Failed to list schemas: ${error.message}`);
  }
};

export const handlers = {
  generateSchema,
  createSchemasTable,
  deleteSchemasTable,
  saveSchema,
  getSchema,
  updateSchema,
  deleteSchema,
  listSchemas,
  validateSchema
}; 