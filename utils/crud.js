import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand
} from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" });
const docClient = DynamoDBDocumentClient.from(client);

export async function describeKeySchema(tableName) {
  const tableDesc = await client.send(new DescribeTableCommand({ TableName: tableName }));
  const keySchema = tableDesc.Table?.KeySchema;
  const partitionKey = keySchema.find(k => k.KeyType === "HASH")?.AttributeName;
  const sortKey = keySchema.find(k => k.KeyType === "RANGE")?.AttributeName;
  return { partitionKey, sortKey };
}

export async function createItem(tableName, body) {
  const { item, requestDetails, status, itemIndex, totalItems, originalId, notificationMeta } = body;
  if (!item) return { statusCode: 400, body: JSON.stringify({ error: "Item is required" }) };

  const { partitionKey, sortKey } = await describeKeySchema(tableName);
  if (!item[partitionKey]) return { statusCode: 400, body: JSON.stringify({ error: `Missing partition key: ${partitionKey}` }) };

  const { bookmark, url, ...cleanedItem } = item;

  if (typeof cleanedItem[partitionKey] === "number") cleanedItem[partitionKey] = cleanedItem[partitionKey].toString();
  if (sortKey && typeof cleanedItem[sortKey] === "number") cleanedItem[sortKey] = cleanedItem[sortKey].toString();

  const simplifiedItem = Object.fromEntries(
    Object.entries(cleanedItem).filter(([_, value]) =>
      ["string", "number", "boolean"].includes(typeof value) || value === null || Array.isArray(value) || typeof value === "object"
    )
  );

  // Only save the item as provided, no timestamp or _metadata
  await docClient.send(new PutCommand({ TableName: tableName, Item: simplifiedItem }));

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      [partitionKey]: simplifiedItem[partitionKey],
      ...(sortKey && { [sortKey]: simplifiedItem[sortKey] }),
      notificationMeta // Pass through for notification system
    })
  };
}

export async function updateItem(tableName, body) {
  const { updates, key, requestDetails, status, itemIndex, totalItems, originalId } = body;
  if (!updates || !key) return { statusCode: 400, body: JSON.stringify({ error: "Both key and updates are required" }) };

  const { partitionKey, sortKey } = await describeKeySchema(tableName);
  if (!key[partitionKey]) return { statusCode: 400, body: JSON.stringify({ error: `Missing partition key: ${partitionKey}` }) };

  const ExpressionAttributeNames = {};
  const ExpressionAttributeValues = {};
  const updateExpr = [];

  for (const [k, v] of Object.entries(updates)) {
    ExpressionAttributeNames[`#${k}`] = k;
    ExpressionAttributeValues[`:${k}`] = v;
    updateExpr.push(`#${k} = :${k}`);
  }

  ExpressionAttributeNames["#timestamp"] = "timestamp";
  ExpressionAttributeValues[":timestamp"] = new Date().toISOString();
  updateExpr.push("#timestamp = :timestamp");

  ExpressionAttributeNames["#_metadata"] = "_metadata";
  ExpressionAttributeValues[":_metadata"] = {
    requestDetails: requestDetails || {},
    status: status || 200,
    itemIndex: itemIndex || 0,
    totalItems: totalItems || 1,
    originalId: originalId || Object.values(key).join("#")
  };
  updateExpr.push("#_metadata = :_metadata");

  const result = await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: key,
    UpdateExpression: "SET " + updateExpr.join(", "),
    ExpressionAttributeNames,
    ExpressionAttributeValues,
    ReturnValues: "ALL_NEW"
  }));

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, updatedItem: result.Attributes })
  };
}

export async function getItem(tableName, query) {
  const { partitionKey, sortKey } = await describeKeySchema(tableName);
  const isPaginated = query.pagination === "true";

  // Case 1: Get single item by key
  if (!isPaginated && query?.[partitionKey]) {
    const key = { [partitionKey]: query[partitionKey] };
    if (sortKey && query[sortKey]) key[sortKey] = query[sortKey];

    const result = await docClient.send(new GetCommand({ TableName: tableName, Key: key }));
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, item: result.Item || null })
    };
  }

  // Case 2: Paginated scan
  const itemPerPage = Math.max(1, parseInt(query.itemPerPage) || 50);
  const maxPage = parseInt(query.maxPage) || Infinity;

  let items = [];
  let ExclusiveStartKey = undefined;
  let pageCount = 0;

  while (pageCount < maxPage) {
    const params = {
      TableName: tableName,
      Limit: itemPerPage,
      ExclusiveStartKey
    };

    const result = await docClient.send(new ScanCommand(params));
    items.push(...(result.Items || []));

    pageCount++;
    if (!result.LastEvaluatedKey) break;

    ExclusiveStartKey = result.LastEvaluatedKey;
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      count: items.length,
      pagesFetched: pageCount,
      items
    })
  };
}

export async function deleteItem(tableName, body) {
  const { partitionKey, sortKey } = await describeKeySchema(tableName);
  if (!body?.[partitionKey]) return { statusCode: 400, body: JSON.stringify({ error: `Missing body field: ${partitionKey}` }) };

  const key = { [partitionKey]: body[partitionKey] };
  if (sortKey && body[sortKey]) key[sortKey] = body[sortKey];

  await docClient.send(new DeleteCommand({ TableName: tableName, Key: key }));
  return {
    statusCode: 200,
    body: JSON.stringify({ success: true })
  };
}

export async function handler(event) {
  try {
    const method = event.requestContext?.http?.method || event.httpMethod || "UNKNOWN";
    const queryParams = event.queryStringParameters || {};
    const tableName = queryParams.tableName;

    console.log("Method:", method);
    console.log("Query Params:", queryParams);
    console.log("Body (raw):", event.body);

    const body = event.body ? JSON.parse(event.body) : {};

    if (!tableName) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing tableName in query parameters" }) };
    }

    switch (method.toUpperCase()) {
      case "POST":
        return await createItem(tableName, body);
      case "PUT":
        return await updateItem(tableName, body);
      case "GET":
        return await getItem(tableName, queryParams);
      case "DELETE":
        return await deleteItem(tableName, body);
      default:
        return { statusCode: 405, body: "Method Not Allowed" };
    }
  } catch (err) {
    console.error("Error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}

