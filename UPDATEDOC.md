# DynamoDB Loop Request Documentation

## Overview
The loop request functionality allows you to fetch items from a DynamoDB table in batches with pagination support. Results are cached for 5 minutes by default to improve performance and reduce DynamoDB costs.

## Endpoint
```
POST /api/dynamodb/tables/{tableName}/items/loop
```

## Request Parameters

### Path Parameters
- `tableName` (string, required): The name of the DynamoDB table to query

### Request Body
```json
{
  "pageSize": 1000,             // Number of items to fetch per iteration (default: 1000)
  "maxIterations": null,        // Maximum number of iterations (null for infinite loop)
  "lastEvaluatedKey": null,     // Last evaluated key from previous request for pagination
  "filterExpression": "#status = :active",  // Optional filter expression
  "expressionAttributeNames": {  // Required if using filterExpression
    "#status": "status"
  },
  "expressionAttributeValues": { // Required if using filterExpression
    ":active": "active"
  },
  "useCache": true             // Whether to use caching (default: true)
}
```

## Response
```json
{
  "items": [
    // Array of items from the table
  ],
  "count": 150,                 // Total number of items returned
  "lastEvaluatedKey": {         // Key to use for next pagination request
    "id": "123",
    "timestamp": "2024-01-01T00:00:00Z"
  },
  "iterations": 2,              // Number of iterations performed
  "hasMoreItems": true,         // Whether there are more items to fetch
  "fromCache": true            // Whether the response came from cache
}
```

## Example Usage

### Basic Request with Cache
```bash
curl -X POST http://localhost:4000/api/dynamodb/tables/my-table/items/loop \
-H "Content-Type: application/json" \
-d '{
  "pageSize": 1000,
  "maxIterations": null,
  "useCache": true
}'
```

### Force Fresh Data (No Cache)
```bash
curl -X POST http://localhost:4000/api/dynamodb/tables/my-table/items/loop \
-H "Content-Type: application/json" \
-d '{
  "pageSize": 1000,
  "maxIterations": 5,
  "useCache": false
}'
```

### Infinite Loop (Fetch All Items)
```bash
curl -X POST http://localhost:4000/api/dynamodb/tables/my-table/items/loop \
-H "Content-Type: application/json" \
-d '{
  "pageSize": 1000,
  "maxIterations": null
}'
```

### Limited Iterations
```bash
curl -X POST http://localhost:4000/api/dynamodb/tables/my-table/items/loop \
-H "Content-Type: application/json" \
-d '{
  "pageSize": 1000,
  "maxIterations": 5
}'
```

### With Filter Expression
```bash
curl -X POST http://localhost:4000/api/dynamodb/tables/my-table/items/loop \
-H "Content-Type: application/json" \
-d '{
  "pageSize": 1000,
  "maxIterations": null,
  "filterExpression": "#status = :active",
  "expressionAttributeNames": {
    "#status": "status"
  },
  "expressionAttributeValues": {
    ":active": "active"
  }
}'
```

### Pagination Example
```bash
# First request
curl -X POST http://localhost:4000/api/dynamodb/tables/my-table/items/loop \
-H "Content-Type: application/json" \
-d '{
  "pageSize": 1000,
  "maxIterations": 2
}'

# Second request using lastEvaluatedKey from first response
curl -X POST http://localhost:4000/api/dynamodb/tables/my-table/items/loop \
-H "Content-Type: application/json" \
-d '{
  "pageSize": 1000,
  "maxIterations": 2,
  "lastEvaluatedKey": {
    "id": "123",
    "timestamp": "2024-01-01T00:00:00Z"
  }
}'
```

## Notes
1. The endpoint will continue fetching items until either:
   - All items are retrieved
   - The maximum number of iterations is reached (if maxIterations is set)
   - No more items are available
2. Results are cached for 5 minutes by default when `useCache` is true
3. Cache is based on the combination of tableName, filterExpression, and expression attributes
4. Cache is bypassed when using pagination (lastEvaluatedKey)
5. Use `lastEvaluatedKey` from the response to continue pagination
6. Filter expressions follow DynamoDB's expression syntax
7. The `pageSize` parameter controls how many items are fetched per iteration (maximum: 1000 items)
8. Set `maxIterations` to `null` for infinite loop (fetch all items)
9. The `hasMoreItems` field in the response indicates if there are more items to fetch

## Error Handling
- 400 Bad Request: Invalid request parameters
- 404 Not Found: Table does not exist
- 500 Internal Server Error: Server-side error

## Best Practices
1. Start with a smaller `pageSize` (e.g., 100) and increase if needed, but never exceed the maximum of 1000 items
2. Use `maxIterations` to limit the number of iterations when testing or when you don't need all items
3. Use filter expressions to narrow down results when possible
4. Keep caching enabled for frequently accessed data that doesn't change often
5. Disable caching when real-time data is required
6. Use pagination with `lastEvaluatedKey` for very large datasets
7. Monitor memory usage when fetching large datasets
8. Consider the cache TTL (5 minutes) when planning your application's data refresh strategy
