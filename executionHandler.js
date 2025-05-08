import { v4 as uuidv4 } from 'uuid';
import { handlers as dynamodbHandlers } from './lib/dynamodb-handlers.js';

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

    const response = await dynamodbHandlers.createItem({
      request: {
        params: {
          tableName: 'executions'
        },
        requestBody: logItem
      }
    });

    if (!response.ok) {
      console.error('Failed to save execution log:', response);
      return null;
    }

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
    const updateExpression = {
      UpdateExpression: "SET #data.#status = :status, #data.#isLast = :isLast",
      ExpressionAttributeNames: {
        "#data": "data",
        "#status": "status",
        "#isLast": "is-last"
      },
      ExpressionAttributeValues: {
        ":status": status,
        ":isLast": isLast
      }
    };

    const response = await dynamodbHandlers.updateItemsByPk({
      request: {
        params: {
          tableName: 'executions',
          id: execId
        },
        query: {
          sortKey: execId // Pass sortKey as a query parameter
        },
        requestBody: updateExpression
      }
    });

    if (!response.ok) {
      console.error('Failed to update parent execution status:', response);
      return null;
    }

    return response.body;
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
    const timestamp = new Date().toISOString();
    const parentExecutionLogItem = {
      'exec-id': execId,
      'child-exec-id': execId,
      data: {
        'execution-id': execId,
        'execution-type': 'paginated',
        'timestamp': timestamp,
        'status': 'initialized',
        'is-last': false,
        'total-items-processed': 0,
        'items-in-current-page': 0,
        'request-url': url,
        'request-method': method,
        'request-query-params': queryParams,
        'request-headers': headers,
        'max-iterations': maxIterations,
        'target-table': tableName,
        'save-data': saveData
      }
    };

    const response = await dynamodbHandlers.createItem({
      request: {
        params: {
          tableName: 'executions'
        },
        requestBody: parentExecutionLogItem
      }
    });

    // Check if the response indicates success (statusCode 200 or 201)
    if (response.statusCode !== 200 && response.statusCode !== 201) {
      console.error('Failed to create parent execution log:', response);
      return null;
    }

    return {
      async updateParentStatus(status, isLast) {
        try {
          const updateResponse = await dynamodbHandlers.getItemsByPk({
            request: {
              params: {
                tableName: 'executions',
                id: execId
              }
            }
          });

          if (updateResponse.statusCode === 200 && updateResponse.body.items && updateResponse.body.items.length > 0) {
            const currentItem = updateResponse.body.items[0];
            currentItem.data.status = status;
            currentItem.data['is-last'] = isLast;

            const saveResponse = await dynamodbHandlers.createItem({
              request: {
                params: {
                  tableName: 'executions'
                },
                requestBody: currentItem
              }
            });

            if (saveResponse.statusCode === 200 || saveResponse.statusCode === 201) {
              console.log('Successfully updated parent execution status:', {
                execId,
                status,
                isLast
              });
              return true;
            }
          }
          return false;
        } catch (error) {
          console.error('Error updating parent execution status:', error);
          return false;
        }
      },

      async saveChildExecution({ pageNumber, totalItemsProcessed, itemsInCurrentPage, url, status, paginationType, isLast, itemIds }) {
        try {
          const childExecId = `${execId}-${pageNumber}`;
          const childExecutionLogItem = {
            'exec-id': execId,
            'child-exec-id': childExecId,
            data: {
              'execution-id': execId,
              'child-execution-id': childExecId,
              'execution-type': 'paginated-child',
              'page-number': pageNumber,
              'timestamp': new Date().toISOString(),
              'status': status,
              'is-last': isLast,
              'total-items-processed': totalItemsProcessed,
              'items-in-current-page': itemsInCurrentPage,
              'request-url': url,
              'pagination-type': paginationType,
              'item-ids': itemIds || []
            }
          };

          const response = await dynamodbHandlers.createItem({
            request: {
              params: {
                tableName: 'executions'
              },
              requestBody: childExecutionLogItem
            }
          });

          if (response.statusCode === 200 || response.statusCode === 201) {
            console.log('Successfully saved child execution log:', {
              execId,
              childExecId,
              pageNumber,
              status
            });
            return true;
          }
          
          console.error('Failed to save child execution log:', response);
          return false;
        } catch (error) {
          console.error('Error saving child execution log:', error);
          return false;
        }
      }
    };
  } catch (error) {
    console.error('Error initializing paginated execution logs:', error);
    return null;
  }
};

// Handler to save single execution log
export async function saveSingleExecutionLog({ execId, method, url, queryParams, headers, responseStatus, responseData }) {
  try {
    const timestamp = new Date().toISOString();
    const executionLogItem = {
      'exec-id': execId,
      'child-exec-id': execId,
      data: {
        'execution-id': execId,
        'execution-type': 'single',
        'timestamp': timestamp,
        'status': 'completed',
        'is-last': true,
        'total-items-processed': 1,
        'items-in-current-page': 1,
        'request-url': url,
        'request-method': method,
        'request-query-params': queryParams,
        'request-headers': headers,
        'response-status': responseStatus,
        'response-data': responseData
      }
    };

    console.log('Saving execution log with item IDs:', {
      execId,
      childExecId: execId,
      itemIdsCount: 0,
      itemIds: []
    });

    console.log('[DynamoDB] Creating item in table: executions');
    const response = await dynamodbHandlers.createItem({
      request: {
        params: {
          tableName: 'executions'
        },
        requestBody: executionLogItem
      }
    });

    // Check if the response indicates success (statusCode 200 or 201)
    if (response.statusCode === 200 || response.statusCode === 201) {
      console.log('Successfully saved execution log:', {
        execId,
        status: 'completed',
        timestamp
      });
      return true;
    } else {
      console.error('Failed to save execution log:', response);
      return false;
    }
  } catch (error) {
    console.error('Error saving execution log:', error);
    return false;
  }
} 