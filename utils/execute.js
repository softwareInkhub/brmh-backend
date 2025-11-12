import axios from 'axios';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { createItem, updateItem, getItem, deleteItem } from './crud.js';
import { 
  cacheTableHandler, 
  getCachedDataHandler, 
  getPaginatedCacheKeysHandler,
  clearCacheHandler, 
  getCacheStatsHandler,
  cacheHealthHandler,
  testCacheConnection,
  clearUnwantedOrderDataHandler,
  cleanupTimestampChunksHandler,
  getCachedDataInSequenceHandler
} from './cache.js';
import {
  indexTableHandler,
  searchIndexHandler,
  listIndicesHandler,
  deleteIndicesHandler,
  searchHealthHandler
} from './search-indexing.js';

// DynamoDB table names
const NAMESPACES_TABLE = 'brmh-namespaces';
const ACCOUNTS_TABLE = 'brmh-namespace-accounts';
const METHODS_TABLE = 'brmh-namespace-methods';

const client = new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});
const docClient = DynamoDBDocumentClient.from(client);

export const getAllSync = async (event) => {
  try {
    let body = {};

    try {
      body = typeof event.body === "string"
        ? JSON.parse(event.body)
        : (event.body || event); // fallback to event itself if body is missing
    } catch (err) {
      console.error("Error parsing event body:", err);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid JSON body" })
      };
    }

    const {
      tableName,
      url,
      headers = {},
      idField = "id",
      executeType = "sync", // "sync" or "get-all"
      stopOnExisting = true,
      nextPageField = "nextPageToken",
      nextPageIn = "body",
      tokenParam = "pageToken",
      isAbsoluteUrl = false,
      maxPages = null
    } = body;

    if (!tableName || !url) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "tableName and url are required" }),
      };
    }

    const desc = await client.send(new DescribeTableCommand({ TableName: tableName }));
    const keySchema = desc.Table?.KeySchema;
    const partitionKey = keySchema?.find(k => k.KeyType === "HASH")?.AttributeName;

    if (!partitionKey) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Partition key not found in table" }),
      };
    }

    let nextUrl = url;
    let page = 0;
    const saved = [], skipped = [];

    // Initial logging
    console.log(`\n🚀 [STARTING] ${executeType.toUpperCase()} operation`);
    console.log(`📋 [Config] Table: ${tableName}, URL: ${url}`);
    console.log(`⚙️  [Settings] Max Pages: ${maxPages || 'Infinite'}, Stop on Existing: ${stopOnExisting}`);
    console.log(`🔍 [Pagination] Next Page In: ${nextPageIn}, Field: ${nextPageField}, Absolute URL: ${isAbsoluteUrl}`);

    while (nextUrl && (maxPages === null || page < maxPages)) {
      page++;

      console.log(`\n🔄 [Page ${page}] Fetching data from: ${nextUrl}`);
      const res = await axios.get(nextUrl, { headers });
      const items = Array.isArray(res.data)
        ? res.data
        : Object.values(res.data).find(v => Array.isArray(v)) || [];

      if (!Array.isArray(items)) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "API did not return an array of items" }),
        };
      }

      console.log(`📊 [Page ${page}] Found ${items.length} items in this page`);
      let pageSavedCount = 0;
      let pageSkippedCount = 0;

      for (const item of items) {
        const itemId = item[idField]?.toString();
        if (!itemId) continue;

        if (executeType === "sync") {
          // 🔄 SYNC MODE: Check existence before saving
          const result = await docClient.send(new GetCommand({
            TableName: tableName,
            Key: { [partitionKey]: itemId }
          }));

          if (result.Item) {
            skipped.push(itemId);
            pageSkippedCount++;

            // ✅ Auto-stop if 200 existing items matched
            if (skipped.length >= 2000) {
              console.log(`\n🛑 [Page ${page}] Auto-stopped: 2000 existing items found`);
              console.log(`📈 [Final Stats] Total Saved: ${saved.length}, Total Skipped: ${skipped.length}`);
              return {
                statusCode: 200,
                body: JSON.stringify({
                  success: true,
                  message: "Stopped sync: 200 existing items matched in DynamoDB",
                  reason: "auto-stop-after-200",
                  savedCount: saved.length,
                  skippedCount: skipped.length,
                  saved,
                  skipped
                }),
              };
            }

            // ✅ User requested stop on first match
            if (stopOnExisting) {
              console.log(`\n🛑 [Page ${page}] Stopped: Item ${itemId} already exists`);
              console.log(`📈 [Final Stats] Total Saved: ${saved.length}, Total Skipped: ${skipped.length}`);
              return {
                statusCode: 200,
                body: JSON.stringify({
                  success: true,
                  message: `Stopped sync: item with id ${itemId} already exists`,
                  reason: "stopOnExisting",
                  savedCount: saved.length,
                  skippedCount: skipped.length,
                  saved,
                  skipped
                }),
              };
            }

            continue;
          }
        }

        // ✅ SAVE ITEM (either new item in sync mode or all items in get-all mode)
        await docClient.send(new PutCommand({
          TableName: tableName,
          Item: {
            ...item,
            [partitionKey]: itemId
          }
        }));

        saved.push(itemId);
        pageSavedCount++;
      }

      // Log page completion stats
      console.log(`✅ [Page ${page}] Completed: ${pageSavedCount} saved, ${pageSkippedCount} skipped`);
      console.log(`📈 [Running Total] Total Saved: ${saved.length}, Total Skipped: ${skipped.length}`);

      // Pagination logic
      const token = nextPageIn === 'header'
        ? extractNextLink(res.headers?.[nextPageField])
        : getNested(res.data, nextPageField);

      nextUrl = token
        ? (isAbsoluteUrl ? token : appendToken(nextUrl, token, tokenParam))
        : null;

      if (nextUrl) {
        console.log(`🔗 [Page ${page}] Next page URL found: ${nextUrl}`);
      } else {
        console.log(`🏁 [Page ${page}] No more pages available - pagination complete`);
      }
    }

    // Final completion logging
    console.log(`\n🎉 [COMPLETED] All pages processed successfully!`);
    console.log(`📊 [Final Stats] Pages Scanned: ${page}, Total Saved: ${saved.length}, Total Skipped: ${skipped.length}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: "Sync completed",
        pagesScanned: page,
        savedCount: saved.length,
        skippedCount: skipped.length,
        saved,
        skipped
      }),
    };

  } catch (err) {
    console.error(`\n❌ [ERROR] ${executeType.toUpperCase()} operation failed:`, err.message);
    console.error(`🔍 [Debug] Error details:`, err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};


const executeSingle = async (event) => {
    try {
      const body = typeof event.body === "string" ? JSON.parse(event.body) : (event.body || event);
      const { method = "GET", url, headers = {}, queryParams = {}, body: requestBody, save = false, tableName, idField = "id" } = body;
  
      if (!url) return { statusCode: 400, body: JSON.stringify({ error: "URL required" }) };
      
      // Validate tableName is provided when save is true
      if (save && !tableName) {
        return { statusCode: 400, body: JSON.stringify({ error: "tableName is required when save is true" }) };
      }
  
      // Build URL with query params
      const urlObj = new URL(url);
      Object.entries(queryParams).forEach(([key, value]) => {
        if (key && value) urlObj.searchParams.append(key.trim(), value.toString().trim());
      });
  
      // Make request
      const response = await axios({
        method: method.toUpperCase(),
        url: urlObj.toString(),
        headers,
        data: requestBody,
        validateStatus: () => true
      });
  
      // Save to DynamoDB if requested
      let savedItems = [];
      if (save && tableName && response.status === 200) {
        try {
          const desc = await client.send(new DescribeTableCommand({ TableName: tableName }));
          const partitionKey = desc.Table?.KeySchema?.find(k => k.KeyType === "HASH")?.AttributeName;
          
          if (partitionKey) {
            const items = Array.isArray(response.data) ? response.data : Object.values(response.data).find(v => Array.isArray(v)) || [];
            
            for (const item of items) {
              const itemId = item[idField]?.toString();
              if (itemId) {
                await docClient.send(new PutCommand({
                  TableName: tableName,
                  Item: { ...item, [partitionKey]: itemId }
                }));
                savedItems.push(itemId);
              }
            }
          }
        } catch (error) {
          console.error("Save error:", error);
        }
      }
  
      return {
        statusCode: response.status,
        body: JSON.stringify({
          success: response.status < 400,
          status: response.status,
          data: response.data,
          savedCount: savedItems.length
        })
      };
  
    } catch (error) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message })
      };
    }
  };

// Helper: Parse Link header (for Shopify-style pagination)
function extractNextLink(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

// Helper: Append token to URL query string
function appendToken(currentUrl, token, paramName = "pageToken") {
  const url = new URL(currentUrl);
  url.searchParams.set(paramName, token);
  return url.toString();
}

// Helper: Get nested field via dot notation
function getNested(obj, path) {
  return path?.split('.').reduce((acc, key) => acc?.[key], obj);
}

    // Namespace execution handler - fetches details from namespace, account, and method IDs
const executeNamespace = async (event) => {
  try {
    const body = typeof event.body === "string" ? JSON.parse(event.body) : (event.body || event);
    const { namespaceId, accountId, methodId, save = false, tableName, idField = "id", requestBody: overrideBody } = body;

    // Validate required parameters
    if (!namespaceId || !accountId || !methodId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "namespaceId, accountId, and methodId are required" })
      };
    }

    // Determine backend URL - use environment variable or try to infer from request
    // If event has headers with host, use that; otherwise use env var or default
    let backendUrl = process.env.BACKEND_URL || process.env.CRUD_API_BASE_URL;
    if (!backendUrl && event.headers && event.headers.Host) {
      const protocol = event.headers['X-Forwarded-Proto'] || 'https';
      backendUrl = `${protocol}://${event.headers.Host}`;
    }
    if (!backendUrl) {
      backendUrl = 'http://localhost:5001';
    }
    // Remove trailing slash
    backendUrl = backendUrl.replace(/\/+$/, '');

    console.log(`[Namespace Execute] Using backend URL: ${backendUrl}`);
    console.log(`[Namespace Execute] Fetching details for namespace: ${namespaceId}, account: ${accountId}, method: ${methodId}`);

    // Fetch namespace details using API route
    let namespace;
    try {
      const namespaceResponse = await axios.get(`${backendUrl}/unified/namespaces/${namespaceId}`, {
        validateStatus: () => true // Don't throw on 404
      });
      if (namespaceResponse.status !== 200) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: `Namespace with id ${namespaceId} not found (status: ${namespaceResponse.status})` })
        };
      }
      // Response data might be wrapped in a 'data' field
      const namespaceData = namespaceResponse.data;
      namespace = namespaceData.data || namespaceData;
    } catch (error) {
      console.error(`[Namespace Execute] Error fetching namespace:`, error.message);
      return {
        statusCode: 404,
        body: JSON.stringify({ error: `Failed to fetch namespace with id ${namespaceId}: ${error.message}` })
      };
    }

    // Fetch account details using API route
    let account;
    try {
      const accountResponse = await axios.get(`${backendUrl}/unified/accounts/${accountId}`, {
        validateStatus: () => true // Don't throw on 404
      });
      if (accountResponse.status !== 200) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: `Account with id ${accountId} not found (status: ${accountResponse.status})` })
        };
      }
      // Response data might be wrapped in a 'data' field
      const accountData = accountResponse.data;
      account = accountData.data || accountData;
    } catch (error) {
      console.error(`[Namespace Execute] Error fetching account:`, error.message);
      return {
        statusCode: 404,
        body: JSON.stringify({ error: `Failed to fetch account with id ${accountId}: ${error.message}` })
      };
    }

    // Fetch method details using API route
    let method;
    try {
      const methodResponse = await axios.get(`${backendUrl}/unified/methods/${methodId}`, {
        validateStatus: () => true // Don't throw on 404
      });
      if (methodResponse.status !== 200) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: `Method with id ${methodId} not found (status: ${methodResponse.status})` })
        };
      }
      // Response data might be wrapped in a 'data' field
      const methodData = methodResponse.data;
      method = methodData.data || methodData;
    } catch (error) {
      console.error(`[Namespace Execute] Error fetching method:`, error.message);
      return {
        statusCode: 404,
        body: JSON.stringify({ error: `Failed to fetch method with id ${methodId}: ${error.message}` })
      };
    }

    console.log(`[Namespace Execute] Found namespace: ${namespace['namespace-name']}, account: ${account['namespace-account-name']}, method: ${method['namespace-method-name']}`);

    // Extract method configuration
    const methodConfig = method;
    const url = methodConfig['namespace-method-url-override'] || methodConfig.url;
    const methodType = methodConfig['namespace-method-type'] || 'GET';
    const headers = methodConfig['namespace-method-header'] || {};
    const queryParams = methodConfig['namespace-method-queryParams'] || {};
    const requestBody = overrideBody || methodConfig['namespace-method-body'] || {};

    if (!url) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Method does not have a valid URL configuration" })
      };
    }

    // Merge account credentials with method headers
    const finalHeaders = { ...headers };
    
    // Add authorization if account has credentials
    if (account['namespace-account-header']) {
      // Convert array of header objects to key-value pairs
      const accountHeaders = {};
      account['namespace-account-header'].forEach(header => {
        if (header.key && header.value) {
          accountHeaders[header.key] = header.value;
        }
      });
      
      // Merge account headers with method headers
      Object.assign(finalHeaders, accountHeaders);
    }

    // Determine table name for saving
    let finalTableName = tableName;
    if (save && !finalTableName) {
      // Auto-generate table name if not provided
      const namespaceName = namespace['namespace-name'] || namespaceId;
      const accountName = account['namespace-account-name'] || accountId;
      const methodName = method['namespace-method-name'] || methodId;
      finalTableName = `${namespaceName}-${accountName}-${methodName}`;
    }

           // Construct the full URL by combining account base URL with method path
    let fullUrl = url;
    if (account['namespace-account-url-override']) {
      // If account has a base URL, combine it with the method path
      const baseUrl = account['namespace-account-url-override'];
      if (url.startsWith('/')) {
        // Method path starts with /, append to base URL
        fullUrl = `${baseUrl}${url}`;
      } else {
        // Method path doesn't start with /, add / between base and path
        fullUrl = `${baseUrl}/${url}`;
      }
    }

    console.log(`[Namespace Execute] Executing ${methodType} request to: ${fullUrl}`);
    console.log(`[Namespace Execute] Headers:`, finalHeaders);
    console.log(`[Namespace Execute] Query params:`, queryParams);
    console.log(`[Namespace Execute] Request body:`, requestBody);

    // Build URL with query params
    const urlObj = new URL(fullUrl);
    Object.entries(queryParams).forEach(([key, value]) => {
      if (key && value) urlObj.searchParams.append(key.trim(), value.toString().trim());
    });

    // Make the request
    const response = await axios({
      method: methodType.toUpperCase(),
      url: urlObj.toString(),
      headers: finalHeaders,
      data: requestBody, // Add request body support
      validateStatus: () => true
    });

    // Save to DynamoDB if requested
    let savedItems = [];
    if (save && finalTableName && response.status === 200) {
      try {
        const desc = await client.send(new DescribeTableCommand({ TableName: finalTableName }));
        const partitionKey = desc.Table?.KeySchema?.find(k => k.KeyType === "HASH")?.AttributeName;
        
        if (partitionKey) {
          const items = Array.isArray(response.data) ? response.data : Object.values(response.data).find(v => Array.isArray(v)) || [];
          
          for (const item of items) {
            const itemId = item[idField]?.toString();
            if (itemId) {
              await docClient.send(new PutCommand({
                TableName: finalTableName,
                Item: { ...item, [partitionKey]: itemId }
              }));
              savedItems.push(itemId);
            }
          }
        }
      } catch (error) {
        console.error("Save error:", error);
      }
    }

    return {
      statusCode: response.status,
      body: JSON.stringify({
        success: response.status < 400,
        status: response.status,
        data: response.data,
        savedCount: savedItems.length,
        metadata: {
          namespace: namespace['namespace-name'],
          account: account['namespace-account-name'],
          method: method['namespace-method-name'],
          tableName: finalTableName
        }
      })
    };

  } catch (error) {
    console.error("[Namespace Execute] Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// CRUD execution handler
const executeCrud = async (event) => {
  try {
    const body = typeof event.body === "string" ? JSON.parse(event.body) : (event.body || event);
    const { crudOperation, tableName, ...crudParams } = body;

    if (!crudOperation || !tableName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "crudOperation and tableName are required for CRUD operations" })
      };
    }

    console.log(`[CRUD Execute] Operation: ${crudOperation}, Table: ${tableName}`);

    // Route to appropriate CRUD function
    switch (crudOperation.toLowerCase()) {
      case 'post':
        return await createItem(tableName, crudParams);
      
      case 'put':
        return await updateItem(tableName, crudParams);
      
      case 'patch':
        return await updateItem(tableName, crudParams);
      
      case 'get':
        return await getItem(tableName, crudParams);
      
      case 'delete':
        return await deleteItem(tableName, crudParams);
      
      default:
        return {
          statusCode: 400,
          body: JSON.stringify({ error: `Invalid CRUD operation: ${crudOperation}. Valid operations: GET, POST, PUT, PATCH, DELETE` })
        };
    }

  } catch (error) {
    console.error("[CRUD Execute] Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// Cache execution handler
const executeCache = async (event) => {
  try {
    const body = typeof event.body === "string" ? JSON.parse(event.body) : (event.body || event);
    const { cacheOperation, ...cacheParams } = body;

    if (!cacheOperation) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "cacheOperation is required for cache operations" })
      };
    }

    console.log(`[Cache Execute] Operation: ${cacheOperation}`);

    // Create mock request and response objects for the handlers
    const mockReq = { body: cacheParams, query: cacheParams };
    const mockRes = {
      status: (code) => ({ code }),
      json: (data) => ({ statusCode: code || 200, body: JSON.stringify(data) })
    };

    // Route to appropriate cache function using HTTP method names
    switch (cacheOperation.toLowerCase()) {
      case 'get':
        // Get cached data
        return await getCachedDataHandler(mockReq, mockRes);
      
      case 'post':
        // Cache table data
        return await cacheTableHandler(mockReq, mockRes);
      
      case 'put':
        // Update cache data (same as POST for now)
        return await cacheTableHandler(mockReq, mockRes);
      
      case 'patch':
        // Partial cache update (same as POST for now)
        return await cacheTableHandler(mockReq, mockRes);
      
      case 'delete':
        // Clear cache
        return await clearCacheHandler(mockReq, mockRes);
      
      default:
        return {
          statusCode: 400,
          body: JSON.stringify({ 
            error: `Invalid cache operation: ${cacheOperation}. Valid operations: GET, POST, PUT, PATCH, DELETE` 
          })
        };
    }

  } catch (error) {
    console.error("[Cache Execute] Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// Indexing execution handler
const executeIndexing = async (event) => {
  try {
    const body = typeof event.body === "string" ? JSON.parse(event.body) : (event.body || event);
    const { indexingOperation, ...indexingParams } = body;

    if (!indexingOperation) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "indexingOperation is required for indexing operations" })
      };
    }

    console.log(`[Indexing Execute] Operation: ${indexingOperation}`);

    // Create mock request and response objects for the handlers
    const mockReq = { body: indexingParams, query: indexingParams };
    const mockRes = {
      status: (code) => ({ code }),
      json: (data) => ({ statusCode: code || 200, body: JSON.stringify(data) })
    };

    // Route to appropriate indexing function
    switch (indexingOperation.toLowerCase()) {
      case 'index-table':
        return await indexTableHandler(mockReq, mockRes);
      
      case 'search-index':
        return await searchIndexHandler(mockReq, mockRes);
      
      case 'list-indices':
        return await listIndicesHandler(mockReq, mockRes);
      
      case 'delete-indices':
        return await deleteIndicesHandler(mockReq, mockRes);
      
      case 'search-health':
        return await searchHealthHandler(mockReq, mockRes);
      
      default:
        return {
          statusCode: 400,
          body: JSON.stringify({ 
            error: `Invalid indexing operation: ${indexingOperation}. Valid operations: index-table, search-index, list-indices, delete-indices, search-health` 
          })
        };
    }

  } catch (error) {
    console.error("[Indexing Execute] Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// Main execute handler - routes to paginated, single, namespace, CRUD, cache, or indexing execution
export const execute = async (event) => {
  try {
    const body = typeof event.body === "string" ? JSON.parse(event.body) : (event.body || event);
    const { executeType = "single" } = body;

    // Route to appropriate handler based on executeType
    if (executeType === "sync" || executeType === "get-all") {
      // Use paginated execution
      return await getAllSync(event);
    } else if (executeType === "namespace") {
      // Use namespace execution
      return await executeNamespace(event);
    } else if (executeType === "crud") {
      // Use CRUD execution
      return await executeCrud(event);
    } else if (executeType === "cache") {
      // Use cache execution
      return await executeCache(event);
    } else if (executeType === "indexing") {
      // Use indexing execution
      return await executeIndexing(event);
    } else {
      // Use single execution
      return await executeSingle(event);
    }

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// Simple single request handler

// Simple single request handler

// Simple single request handler

// Simple single request handler
