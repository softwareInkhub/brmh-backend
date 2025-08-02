import axios from 'axios';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

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
      maxPages = 50
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

    while (nextUrl && page < maxPages) {
      page++;

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

            // ✅ Auto-stop if 200 existing items matched
            if (skipped.length >= 2000) {
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
      }

      // Pagination logic
      const token = nextPageIn === 'header'
        ? extractNextLink(res.headers?.[nextPageField])
        : getNested(res.data, nextPageField);

      nextUrl = token
        ? (isAbsoluteUrl ? token : appendToken(nextUrl, token, tokenParam))
        : null;
    }

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
    console.error("Sync Error:", err);
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

// Main execute handler - routes to paginated or single execution
export const execute = async (event) => {
  try {
    const body = typeof event.body === "string" ? JSON.parse(event.body) : (event.body || event);
    const { executeType = "single" } = body;

    // Route to appropriate handler based on executeType
    if (executeType === "sync" || executeType === "get-all") {
      // Use paginated execution
      return await getAllSync(event);
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

