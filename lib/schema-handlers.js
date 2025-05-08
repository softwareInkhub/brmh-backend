import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

// Generate OpenAPI schema from response data
const generateSchema = (data) => {
  const isArray = Array.isArray(data);
  const dataToAnalyze = isArray ? data[0] : data;
  
  const generatePropertySchema = (value) => {
    if (value === null) return { type: 'null' };
    if (Array.isArray(value)) {
      const items = value.length > 0 ? generatePropertySchema(value[0]) : {};
      return { type: 'array', items };
    }
    if (typeof value === 'object' && value !== null) {
      const properties = {};
      const required = [];
      Object.entries(value).forEach(([key, val]) => {
        properties[key] = generatePropertySchema(val);
        if (val !== null && val !== undefined) {
          required.push(key);
        }
      });
      return { type: 'object', properties, required };
    }
    return { type: typeof value };
  };

  const schema = generatePropertySchema(dataToAnalyze);
  return {
    schema,
    isArray,
    originalType: isArray ? 'array' : typeof dataToAnalyze
  };
};

// Save schema to DynamoDB
const saveSchema = async (schemaData) => {
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

  console.log('Saving schema for methodId:', methodId);

  const timestamp = new Date().toISOString();

  // 1. Check if a schema for this methodId and schemaType exists (no index, use scan)
  let existingSchema = null;
  try {
    const scanResult = await docClient.send(new ScanCommand({
      TableName: 'schemas',
      FilterExpression: '#methodId = :methodId AND #schemaType = :schemaType',
      ExpressionAttributeNames: {
        '#methodId': 'methodId',
        '#schemaType': 'schemaType'
      },
      ExpressionAttributeValues: {
        ':methodId': methodId,
        ':schemaType': schemaType
      }
    }));
    if (scanResult.Items && scanResult.Items.length > 0) {
      existingSchema = scanResult.Items[0];
    }
  } catch (err) {
    console.error('Error scanning for existing schema:', err);
  }

  let schemaId;
  if (existingSchema) {
    // 2. Update existing schema
    schemaId = existingSchema.id;
    try {
      await docClient.send(new UpdateCommand({
        TableName: 'schemas',
        Key: { id: schemaId },
        UpdateExpression: 'SET #schema = :schema, #isArray = :isArray, #originalType = :originalType, #updatedAt = :updatedAt, #url = :url',
        ExpressionAttributeNames: {
          '#schema': 'schema',
          '#isArray': 'isArray',
          '#originalType': 'originalType',
          '#updatedAt': 'updatedAt',
          '#url': 'url'
        },
        ExpressionAttributeValues: {
          ':schema': schema,
          ':isArray': isArray,
          ':originalType': originalType,
          ':updatedAt': timestamp,
          ':url': url
        }
      }));
    } catch (err) {
      console.error('Error updating schema:', err);
      throw new Error('Failed to update schema');
    }
  } else {
    // 3. Create new schema
    schemaId = uuidv4();
    const item = {
      id: schemaId,
      methodId,
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
    try {
      await docClient.send(new PutCommand({
        TableName: 'schemas',
        Item: item
      }));
    } catch (err) {
      console.error('Error saving new schema:', err);
      throw new Error('Failed to save schema');
    }
  }

  // 4. Update the method's response-schema field with the schema id
  try {
    const methodResult = await docClient.send(new GetCommand({
      TableName: 'brmh-namespace-methods',
      Key: { id: methodId }
    }));
    if (methodResult.Item) {
      await docClient.send(new UpdateCommand({
        TableName: 'brmh-namespace-methods',
        Key: { id: methodId },
        UpdateExpression: 'SET #data.#responseSchema = :schemaId',
        ExpressionAttributeNames: {
          '#data': 'data',
          '#responseSchema': 'response-schema'
        },
        ExpressionAttributeValues: {
          ':schemaId': schemaId
        }
      }));
    } else {
      console.warn('Method not found for updating response-schema:', methodId);
    }
  } catch (err) {
    console.error('Error updating method with schema reference:', err);
  }

  return { schemaId };
};

// Get schema by ID
const getSchema = async (schemaId) => {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: 'schemas',
      Key: { id: schemaId }
    }));

    return result.Item;
  } catch (error) {
    console.error('Error getting schema:', error);
    throw new Error('Failed to get schema');
  }
};

// Update schema
const updateSchema = async (schemaId, updates) => {
  const timestamp = new Date().toISOString();

  // Build update expression dynamically
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
  // Always update updatedAt
  updateExp.push('#updatedAt = :updatedAt');
  expAttrNames['#updatedAt'] = 'updatedAt';
  expAttrValues[':updatedAt'] = timestamp;

  const UpdateExpression = 'SET ' + updateExp.join(', ');

  try {
    const result = await docClient.send(new UpdateCommand({
      TableName: 'schemas',
      Key: { id: schemaId },
      UpdateExpression,
      ExpressionAttributeNames: expAttrNames,
      ExpressionAttributeValues: expAttrValues,
      ReturnValues: 'ALL_NEW'
    }));

    return result.Attributes;
  } catch (error) {
    console.error('Error updating schema:', error);
    throw new Error('Failed to update schema');
  }
};

// Get schemas for a method
const getMethodSchemas = async (methodId) => {
  try {
    const result = await docClient.send(new QueryCommand({
      TableName: 'schemas',
      IndexName: 'MethodIdIndex',
      KeyConditionExpression: 'methodId = :methodId',
      ExpressionAttributeValues: {
        ':methodId': methodId
      }
    }));

    return result.Items;
  } catch (error) {
    console.error('Error getting method schemas:', error);
    throw new Error('Failed to get method schemas');
  }
};

// Get all schemas
const listSchemas = async () => {
  try {
    const result = await docClient.send(new ScanCommand({
      TableName: 'schemas'
    }));
    return result.Items || [];
  } catch (error) {
    console.error('Error listing schemas:', error);
    throw new Error('Failed to list schemas');
  }
};

// Delete schema by id
const deleteSchema = async (schemaId) => {
  await docClient.send(new DeleteCommand({
    TableName: 'schemas',
    Key: { id: schemaId }
  }));
};

export const handlers = {
  generateSchema,
  saveSchema,
  getSchema,
  updateSchema,
  getMethodSchemas,
  listSchemas,
  deleteSchema
}; 