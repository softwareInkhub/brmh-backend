import { v4 as uuidv4 } from 'uuid';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { handlers as dynamodbHandlers } from './lib/dynamodb-handlers.js';

// Initialize DynamoDB clients
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

// Execution status constants
const EXECUTION_STATUS = {
  STARTED: 'started',
  IN_PROGRESS: 'inProgress',
  COMPLETED: 'completed',
  ERROR: 'error'
};

// Handler to save execution logs
export const saveExecutionLog = async ({
  execId,
  childExecId,
  data,
  isParent = false
}) => {
  try {
    const timestamp = new Date().toISOString();
    
    // Format item IDs as DynamoDB list type
    const formattedItemIds = (data.itemIds || []).map(id => ({
      S: id.toString() // Convert each ID to string type for DynamoDB
    }));

    const logItem = {
      'exec-id': execId,
      'child-exec-id': childExecId,
      data: {
        'execution-id': execId,
        'iteration-no': data.iterationNo || 0,
        'total-items-processed': data.totalItemsProcessed || 0,
        'items-in-current-page': data.itemsInCurrentPage || 0,
        'request-url': data.requestUrl,
        'response-status': data.responseStatus,
        'pagination-type': data.paginationType || 'none',
        'timestamp': timestamp,
        'is-last': data.isLast || false,
        'max-iterations': data.maxIterations,
        'item-ids': {
          L: formattedItemIds // Use DynamoDB list type for item IDs
        }
      }
    };

    // Only add status field for parent execution logs
    if (isParent) {
      logItem.data.status = data.status || EXECUTION_STATUS.STARTED;
    }

    console.log('Saving execution log with item IDs:', {
      execId,
      childExecId,
      itemIdsCount: formattedItemIds.length,
      itemIds: formattedItemIds
    });

    // Create the DynamoDB command directly
    const command = new PutCommand({
      TableName: 'executions',
      Item: logItem
    });

    // Send the command directly using docClient
    await docClient.send(command);
    console.log('Successfully saved execution log');
    return logItem;
  } catch (error) {
    console.error('Error saving execution log:', error);
    return null;
  }
};

// Handler to update parent execution status
export const updateParentExecutionStatus = async ({
  execId,
  status,
  isLast = false
}) => {
  try {
    const command = new UpdateCommand({
      TableName: 'executions',
      Key: {
        'exec-id': execId,
        'child-exec-id': execId
      },
      UpdateExpression: "SET #data.#status = :status, #data.#isLast = :isLast",
      ExpressionAttributeNames: {
        "#data": "data",
        "#status": "status",
        "#isLast": "is-last"
      },
      ExpressionAttributeValues: {
        ":status": status,
        ":isLast": isLast
      },
      ReturnValues: 'ALL_NEW'
    });

    const response = await docClient.send(command);
    console.log('Successfully updated parent execution status');
    return response.Attributes;
  } catch (error) {
    console.error('Error updating parent execution status:', error);
    return null;
  }
};

// Handler to save paginated execution logs
export const savePaginatedExecutionLogs = async ({
  execId,
  method,
  url,
  queryParams,
  headers,
  maxIterations,
  tableName,
  saveData
}) => {
  try {
    // Save parent execution log
    const parentExecId = execId;
    await saveExecutionLog({
      execId: parentExecId,
      childExecId: parentExecId, // Same as execId for parent
      data: {
        requestUrl: url,
        responseStatus: 0, // Will be updated later
        paginationType: 'paginated',
        status: EXECUTION_STATUS.STARTED,
        isLast: false,
        maxIterations: maxIterations // Add maxIterations to the log data
      },
      isParent: true
    });

    return {
      parentExecId,
      updateParentStatus: async (status, isLast) => {
        return await updateParentExecutionStatus({
          execId: parentExecId,
          status,
          isLast
        });
      },
      saveChildExecution: async (pageData) => {
        const childExecId = uuidv4();
        return await saveExecutionLog({
          execId: parentExecId,
          childExecId,
          data: {
            iterationNo: pageData.pageNumber,
            totalItemsProcessed: pageData.totalItemsProcessed,
            itemsInCurrentPage: pageData.itemsInCurrentPage,
            requestUrl: pageData.url,
            responseStatus: pageData.status,
            paginationType: pageData.paginationType,
            isLast: pageData.isLast,
            itemIds: pageData.itemIds || []
          }
        });
      }
    };
  } catch (error) {
    console.error('Error saving paginated execution logs:', error);
    return null;
  }
};

// Handler to save single execution log
export const saveSingleExecutionLog = async ({
  execId,
  method,
  url,
  queryParams,
  headers,
  responseStatus,
  responseData
}) => {
  try {
    const timestamp = new Date().toISOString();
    
    const logItem = {
      'exec-id': execId,
      'child-exec-id': execId, // Same as execId for single executions
      data: {
        'execution-id': execId,
        'request-url': url,
        'response-status': responseStatus,
        'pagination-type': 'single',
        'status': EXECUTION_STATUS.COMPLETED,
        'is-last': true,
        'total-items-processed': responseData ? 1 : 0,
        'items-in-current-page': responseData ? 1 : 0,
        'timestamp': timestamp,
        'method': method,
        'query-params': queryParams || {},
        'headers': headers || {},
        'response-data': responseData || null
      }
    };

    console.log('Saving single execution log:', {
      execId,
      url,
      status: responseStatus
    });

    // Create the DynamoDB command directly
    const command = new PutCommand({
      TableName: 'executions',
      Item: logItem
    });

    // Send the command directly using docClient
    await docClient.send(command);
    console.log('Successfully saved execution log');
    return execId;
  } catch (error) {
    console.error('Error saving single execution log:', error);
    return null;
  }
}; 