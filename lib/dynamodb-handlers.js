import { 
  ScanCommand,
  QueryCommand,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  CreateTableCommand,
  DeleteTableCommand,
  ListTablesCommand,
  DescribeTableCommand
} from "@aws-sdk/client-dynamodb";
import { 
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand as DocQueryCommand
} from "@aws-sdk/lib-dynamodb";
import { client, docClient } from './dynamodb-client.js';

// Add cache storage at the top of the file
const scanCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

// Helper function to generate cache key
function generateCacheKey(tableName, params) {
  return `${tableName}:${JSON.stringify(params)}`;
}

export const handlers = {
  // Table Operations
  async listTables(c, req, res) {
    try {
      console.log('[DynamoDB] Listing tables');
      const command = new ListTablesCommand({});
      const response = await client.send(command);
      return {
        statusCode: 200,
        body: {
          tables: response.TableNames || [],
          count: response.TableNames ? response.TableNames.length : 0
        }
      };
    } catch (error) {
      console.error('Error listing tables:', error);
      return {
        statusCode: 500,
        body: { 
          error: 'Failed to list tables',
          details: error.message
        }
      };
    }
  },

  async createTable(c, req, res) {
    try {
      console.log('[DynamoDB] Creating table:', c.request.requestBody);
      const command = new CreateTableCommand(c.request.requestBody);
      const response = await client.send(command);
      return {
        statusCode: 201,
        body: {
          message: 'Table created successfully',
          table: response.TableDescription
        }
      };
    } catch (error) {
      console.error('Error creating table:', error);
      return {
        statusCode: 500,
        body: { 
          error: 'Failed to create table',
          details: error.message
        }
      };
    }
  },

  async deleteTable(c, req, res) {
    try {
      const tableName = c.request.params.tableName;
      if (!tableName) {
        return {
          statusCode: 400,
          body: { error: 'Table name is required' }
        };
      }

      console.log('[DynamoDB] Deleting table:', tableName);
      const command = new DeleteTableCommand({
        TableName: tableName
      });
      await client.send(command);
      return {
        statusCode: 200,
        body: {
          message: 'Table deleted successfully'
        }
      };
    } catch (error) {
      console.error('Error deleting table:', error);
      return {
        statusCode: 500,
        body: { 
          error: 'Failed to delete table',
          details: error.message
        }
      };
    }
  },

  // Item Operations
  async getItems(c, req, res) {
    try {
      const tableName = c.request.params.tableName;
      if (!tableName) {
        return {
          statusCode: 400,
          body: { error: 'Table name is required' }
        };
      }

      console.log('[DynamoDB] Getting items from table:', tableName);
      const command = new ScanCommand({
        TableName: tableName
      });
      const response = await client.send(command);
      return {
        statusCode: 200,
        body: {
          items: response.Items || [],
          count: response.Count || 0
        }
      };
    } catch (error) {
      console.error('Error getting items:', error);
      return {
        statusCode: 500,
        body: { 
          error: 'Failed to get items',
          details: error.message
        }
      };
    }
  },

  async getItem(c, req, res) {
    try {
      const { tableName, pk, sk } = c.request.params;
      if (!tableName || !pk || !sk) {
        return {
          statusCode: 400,
          body: { error: 'Table name, PK, and SK are required' }
        };
      }

      console.log('[DynamoDB] Getting item:', { tableName, pk, sk });
      const command = new GetCommand({
        TableName: tableName,
        Key: {
          PK: pk,
          SK: sk
        }
      });
      const response = await docClient.send(command);
      
      if (!response.Item) {
        return {
          statusCode: 404,
          body: { error: 'Item not found' }
        };
      }

      return {
        statusCode: 200,
        body: response.Item
      };
    } catch (error) {
      console.error('Error getting item:', error);
      return {
        statusCode: 500,
        body: { 
          error: 'Failed to get item',
          details: error.message
        }
      };
    }
  },

  async createItem(c, req, res) {
    try {
      const tableName = c.request.params.tableName;
      if (!tableName) {
        return {
          statusCode: 400,
          body: { error: 'Table name is required' }
        };
      }

      console.log('[DynamoDB] Creating item in table:', tableName);
      const command = new PutCommand({
        TableName: tableName,
        Item: c.request.requestBody
      });
      await docClient.send(command);
      return {
        statusCode: 201,
        body: {
          message: 'Item created successfully',
          item: c.request.requestBody
        }
      };
    } catch (error) {
      console.error('Error creating item:', error);
      return {
        statusCode: 500,
        body: { 
          error: 'Failed to create item',
          details: error.message
        }
      };
    }
  },

  async updateItem(c, req, res) {
    try {
      const { tableName, pk, sk } = c.request.params;
      if (!tableName || !pk || !sk) {
        return {
          statusCode: 400,
          body: { error: 'Table name, PK, and SK are required' }
        };
      }

      console.log('[DynamoDB] Updating item:', { tableName, pk, sk });
      const command = new UpdateCommand({
        TableName: tableName,
        Key: {
          PK: pk,
          SK: sk
        },
        ...c.request.requestBody,
        ReturnValues: 'ALL_NEW'
      });
      const response = await docClient.send(command);
      return {
        statusCode: 200,
        body: response.Attributes
      };
    } catch (error) {
      console.error('Error updating item:', error);
      return {
        statusCode: 500,
        body: { 
          error: 'Failed to update item',
          details: error.message
        }
      };
    }
  },

  async deleteItem(c, req, res) {
    try {
      const { tableName, pk, sk } = c.request.params;
      if (!tableName || !pk || !sk) {
        return {
          statusCode: 400,
          body: { error: 'Table name, PK, and SK are required' }
        };
      }

      console.log('[DynamoDB] Deleting item:', { tableName, pk, sk });
      const command = new DeleteCommand({
        TableName: tableName,
        Key: {
          PK: pk,
          SK: sk
        }
      });
      await docClient.send(command);
      return {
        statusCode: 204,
        body: null
      };
    } catch (error) {
      console.error('Error deleting item:', error);
      return {
        statusCode: 500,
        body: { 
          error: 'Failed to delete item',
          details: error.message
        }
      };
    }
  },

  async queryItems(c, req, res) {
    try {
      const tableName = c.request.params.tableName;
      if (!tableName) {
        return {
          statusCode: 400,
          body: { error: 'Table name is required' }
        };
      }

      console.log('[DynamoDB] Querying items in table:', tableName);
      const command = new DocQueryCommand({
        TableName: tableName,
        ...c.request.requestBody
      });
      const response = await docClient.send(command);
      return {
        statusCode: 200,
        body: {
          items: response.Items || [],
          count: response.Count || 0
        }
      };
    } catch (error) {
      console.error('Error querying items:', error);
      return {
        statusCode: 500,
        body: { 
          error: 'Failed to query items',
          details: error.message
        }
      };
    }
  },

  async getItemsByPk(c, req, res) {
    try {
      const { tableName, id } = c.request.params;
      if (!tableName || !id) {
        return {
          statusCode: 400,
          body: { error: 'Table name and id are required' }
        };
      }

      console.log('[DynamoDB] Getting item by id:', { tableName, id });
      const command = new GetCommand({
        TableName: tableName,
        Key: {
          id: id
        }
      });

      const response = await docClient.send(command);
      if (!response.Item) {
        return {
          statusCode: 404,
          body: { error: 'Item not found' }
        };
      }

      return {
        statusCode: 200,
        body: {
          items: [response.Item],
          count: 1
        }
      };
    } catch (error) {
      console.error('Error getting item by id:', error);
      return {
        statusCode: 500,
        body: { 
          error: 'Failed to get item',
          details: error.message
        }
      };
    }
  },

  async updateItemsByPk(c, req, res) {
    try {
      const { tableName, id } = c.request.params;
      const { sortKey } = c.request.query;
      
      if (!tableName || !id) {
        return {
          statusCode: 400,
          body: { error: 'Table name and id are required' }
        };
      }

      console.log('[DynamoDB] Updating item by id:', { tableName, id, sortKey });
      
      // Get table description to determine key schema
      const describeCommand = new DescribeTableCommand({
        TableName: tableName
      });
      const tableDescription = await client.send(describeCommand);
      const keySchema = tableDescription.Table.KeySchema;

      // Construct the Key object based on table schema
      const Key = {};
      
      // Add partition key (HASH)
      const partitionKey = keySchema.find(key => key.KeyType === 'HASH');
      Key[partitionKey.AttributeName] = id;

      // Add sort key (RANGE) if it exists and is provided
      const sortKeyAttr = keySchema.find(key => key.KeyType === 'RANGE');
      if (sortKeyAttr && sortKey) {
        Key[sortKeyAttr.AttributeName] = sortKey;
      }

      console.log('[DynamoDB] Constructed Key:', Key);

      const command = new UpdateCommand({
        TableName: tableName,
        Key,
        ...c.request.requestBody,
        ReturnValues: 'ALL_NEW'
      });

      const response = await docClient.send(command);
      return {
        statusCode: 200,
        body: {
          items: [response.Attributes],
          count: 1
        }
      };
    } catch (error) {
      console.error('Error updating item by id:', error);
      return {
        statusCode: 500,
        body: { 
          error: 'Failed to update item',
          details: error.message
        }
      };
    }
  },

  async deleteItemsByPk(c, req, res) {
    try {
      const { tableName, id } = c.request.params;
      if (!tableName || !id) {
        return {
          statusCode: 400,
          body: { error: 'Table name and id are required' }
        };
      }

      console.log('[DynamoDB] Deleting item by id:', { tableName, id });
      const command = new DeleteCommand({
        TableName: tableName,
        Key: {
          id: id
        }
      });

      await docClient.send(command);
      return {
        statusCode: 204,
        body: null
      };
    } catch (error) {
      console.error('Error deleting item by id:', error);
      return {
        statusCode: 500,
        body: { 
          error: 'Failed to delete item',
          details: error.message
        }
      };
    }
  },

  async getItemsInLoop(c, req, res) {
    try {
      const tableName = c.request.params.tableName;
      const {
        pageSize = 1000,
        maxIterations = null,
        lastEvaluatedKey = null,
        filterExpression = null,
        expressionAttributeNames = {},
        expressionAttributeValues = {},
        useCache = true
      } = c.request.requestBody;

      console.log(`[DynamoDB] Starting getItemsInLoop for table: ${tableName}`);
      console.log(`[DynamoDB] Request parameters:`, {
        pageSize,
        maxIterations,
        lastEvaluatedKey: lastEvaluatedKey ? 'present' : 'not present',
        filterExpression,
        useCache
      });

      // Generate cache key based on request parameters including maxIterations
      const cacheKey = generateCacheKey(tableName, {
        filterExpression,
        expressionAttributeNames,
        expressionAttributeValues,
        maxIterations
      });

      // Check cache if enabled and no pagination is requested
      if (useCache && !lastEvaluatedKey) {
        const cachedResult = scanCache.get(cacheKey);
        if (cachedResult && 
            Date.now() - cachedResult.timestamp < CACHE_TTL && 
            (!maxIterations || cachedResult.data.iterations >= maxIterations)) {
          console.log(`[DynamoDB] CACHE HIT: Using cached data for table ${tableName}`);
          console.log(`[DynamoDB] Cached data details:`, {
            itemsCount: cachedResult.data.items.length,
            iterations: cachedResult.data.iterations,
            hasMoreItems: cachedResult.data.hasMoreItems,
            cacheAge: `${Math.round((Date.now() - cachedResult.timestamp) / 1000)} seconds`
          });
          return {
            statusCode: 200,
            body: {
              ...cachedResult.data,
              fromCache: true
            }
          };
        } else if (cachedResult) {
          console.log(`[DynamoDB] CACHE MISS: Cached data exists but doesn't meet requirements:`, {
            reason: !cachedResult.data.iterations >= maxIterations ? 'insufficient iterations' : 'cache expired',
            cacheAge: `${Math.round((Date.now() - cachedResult.timestamp) / 1000)} seconds`
          });
        }
      }

      console.log(`[DynamoDB] FETCHING FROM DATABASE: Starting scan for table ${tableName}`);
      let allItems = [];
      let iterations = 0;
      let lastKey = lastEvaluatedKey;
      let hasMoreItems = true;

      while (hasMoreItems && (maxIterations === null || iterations < maxIterations)) {
        const params = {
          TableName: tableName,
          Limit: pageSize,
          ReturnConsumedCapacity: 'TOTAL'
        };

        // Only add ExclusiveStartKey if lastKey is a valid object
        if (lastKey && typeof lastKey === 'object' && Object.keys(lastKey).length > 0) {
          params.ExclusiveStartKey = lastKey;
        }

        if (filterExpression) {
          params.FilterExpression = filterExpression;
        }

        if (Object.keys(expressionAttributeNames).length > 0) {
          params.ExpressionAttributeNames = expressionAttributeNames;
        }

        if (Object.keys(expressionAttributeValues).length > 0) {
          params.ExpressionAttributeValues = expressionAttributeValues;
        }

        console.log(`[DynamoDB] Database Scan Iteration ${iterations + 1}:`, {
          pageSize,
          hasLastKey: !!lastKey,
          hasFilter: !!filterExpression,
          params: JSON.stringify(params)
        });

        const command = new ScanCommand(params);
        const response = await client.send(command);

        if (response.Items) {
          allItems = [...allItems, ...response.Items];
        }

        // Only update lastKey if we have a valid LastEvaluatedKey
        if (response.LastEvaluatedKey && Object.keys(response.LastEvaluatedKey).length > 0) {
          lastKey = response.LastEvaluatedKey;
          hasMoreItems = true;
        } else {
          lastKey = null;
          hasMoreItems = false;
        }

        iterations++;

        console.log(`[DynamoDB] Scan Iteration ${iterations} Complete:`, {
          itemsFetched: response.Items?.length || 0,
          totalItemsSoFar: allItems.length,
          hasMoreItems,
          consumedCapacity: response.ConsumedCapacity
        });
        
        if (maxIterations !== null && iterations >= maxIterations) {
          console.log(`[DynamoDB] Reached maximum iterations (${maxIterations}), stopping scan`);
          break;
        }
      }

      const result = {
        items: allItems,
        count: allItems.length,
        lastEvaluatedKey: lastKey,
        iterations,
        hasMoreItems: hasMoreItems && (maxIterations === null || iterations < maxIterations)
      };

      // Store in cache if this is a complete fetch (no lastEvaluatedKey in request)
      if (useCache && !lastEvaluatedKey) {
        console.log(`[DynamoDB] Caching new data for table ${tableName}:`, {
          itemsCount: result.items.length,
          iterations: result.iterations,
          hasMoreItems: result.hasMoreItems
        });
        scanCache.set(cacheKey, {
          timestamp: Date.now(),
          data: result
        });
      }

      return {
        statusCode: 200,
        body: result
      };
    } catch (error) {
      console.error('[DynamoDB] Error fetching items in loop:', error);
      return {
        statusCode: 500,
        body: { 
          error: 'Failed to fetch items in loop',
          details: error.message
        }
      };
    }
  }
}; 