# Execute API Documentation

The `/execute` endpoint provides a unified interface for various types of operations including HTTP requests, CRUD operations, data synchronization, namespace-based executions, cache operations, and search indexing.

## Overview

The execute endpoint supports multiple execution types through the `executeType` parameter:

- **single** - Simple HTTP requests
- **sync/get-all** - Paginated data synchronization
- **namespace** - Namespace-based API execution
- **crud** - DynamoDB CRUD operations
- **cache** - Redis cache operations
- **indexing** - Algolia search indexing operations

## Base Endpoint

```
POST /execute
```

## Execution Types

### 1. Single Execution (`executeType: "single"`)

Simple HTTP requests to external APIs with optional data saving.

#### Parameters:
- `method` (string, default: "GET") - HTTP method
- `url` (string, required) - Target URL
- `headers` (object, optional) - Request headers
- `queryParams` (object, optional) - URL query parameters
- `body` (object, optional) - Request body
- `save` (boolean, optional) - Whether to save response to DynamoDB
- `tableName` (string, optional) - DynamoDB table name for saving
- `idField` (string, default: "id") - Field to use as item ID

#### Example:
```json
{
  "executeType": "single",
  "method": "GET",
  "url": "https://api.example.com/users",
  "headers": {
    "Authorization": "Bearer token123"
  },
  "queryParams": {
    "limit": "10"
  },
  "save": true,
  "tableName": "users-table",
  "idField": "userId"
}
```

### 2. Sync/Get-All Execution (`executeType: "sync"` or `"get-all"`)

Paginated data synchronization from external APIs to DynamoDB.

#### Parameters:
- `tableName` (string, required) - DynamoDB table name
- `url` (string, required) - Initial API URL
- `headers` (object, optional) - Request headers
- `idField` (string, default: "id") - Field to use as item ID
- `executeType` (string) - "sync" or "get-all"
- `stopOnExisting` (boolean, default: true) - Stop on first existing item (sync mode)
- `nextPageField` (string, default: "nextPageToken") - Field containing next page token
- `nextPageIn` (string, default: "body") - Where to find next page token ("body" or "header")
- `tokenParam` (string, default: "pageToken") - Query parameter name for page token
- `isAbsoluteUrl` (boolean, default: false) - Whether next page URL is absolute
- `maxPages` (number, default: 50) - Maximum pages to fetch

#### Example:
```json
{
  "executeType": "sync",
  "tableName": "products",
  "url": "https://api.shopify.com/admin/products.json",
  "headers": {
    "X-Shopify-Access-Token": "token123"
  },
  "idField": "id",
  "stopOnExisting": true,
  "nextPageField": "next_page_info",
  "maxPages": 10
}
```

### 3. Namespace Execution (`executeType: "namespace"`)

Execute API requests using pre-configured namespace, account, and method configurations.

#### Parameters:
- `namespaceId` (string, required) - Namespace ID
- `accountId` (string, required) - Account ID
- `methodId` (string, required) - Method ID
- `save` (boolean, optional) - Whether to save response to DynamoDB
- `tableName` (string, optional) - DynamoDB table name for saving
- `idField` (string, default: "id") - Field to use as item ID

#### Example:
```json
{
  "executeType": "namespace",
  "namespaceId": "shopify-namespace",
  "accountId": "shopify-account",
  "methodId": "get-products",
  "save": true,
  "tableName": "shopify-products",
  "idField": "id"
}
```

### 4. CRUD Execution (`executeType: "crud"`)

Direct DynamoDB CRUD operations using HTTP method names.

#### Parameters:
- `crudOperation` (string, required) - HTTP method: GET, POST, PUT, PATCH, DELETE
- `tableName` (string, required) - DynamoDB table name
- Additional parameters depend on the operation

#### CRUD Operations:

##### GET - Read Items
```json
{
  "executeType": "crud",
  "crudOperation": "GET",
  "tableName": "users",
  "pagination": "false",
  "id": "user123"
}
```

**Paginated Read:**
```json
{
  "executeType": "crud",
  "crudOperation": "GET",
  "tableName": "users",
  "pagination": "true",
  "itemPerPage": 50,
  "maxPage": 5
}
```

##### POST - Create Item
```json
{
  "executeType": "crud",
  "crudOperation": "POST",
  "tableName": "users",
  "item": {
    "id": "user123",
    "name": "John Doe",
    "email": "john@example.com"
  }
}
```

##### PUT - Full Update
```json
{
  "executeType": "crud",
  "crudOperation": "PUT",
  "tableName": "users",
  "key": {
    "id": "user123"
  },
  "updates": {
    "name": "John Smith",
    "email": "johnsmith@example.com",
    "status": "active"
  }
}
```

##### PATCH - Partial Update
```json
{
  "executeType": "crud",
  "crudOperation": "PATCH",
  "tableName": "users",
  "key": {
    "id": "user123"
  },
  "updates": {
    "status": "inactive"
  }
}
```

##### DELETE - Delete Item
```json
{
  "executeType": "crud",
  "crudOperation": "DELETE",
  "tableName": "users",
  "id": "user123"
}
```

### 5. Cache Execution (`executeType: "cache"`)

Redis cache operations for data caching and retrieval using standard HTTP method names.

**⚠️ Important Note:** For large datasets (60,000+ items), use `includeData=false` to avoid timeouts. The system will return only keys by default to prevent 504 Gateway Timeout errors.

**🔄 Race Condition Protection:** The system prevents conflicts between bulk caching operations and Lambda-triggered cache updates. If a bulk cache operation is in progress, cache updates are queued and processed automatically after the bulk operation completes.

#### Parameters:
- `cacheOperation` (string, required) - HTTP method: GET, POST, PUT, PATCH, DELETE
- Additional parameters depend on the operation

#### Cache Operations:

##### GET - Retrieve Cached Data
```json
{
  "executeType": "cache",
  "cacheOperation": "GET",
  "project": "my-app",
  "table": "users",
  "key": "user123"
}
```

**Get All Keys (keys only, no data):**
```json
{
  "executeType": "cache",
  "cacheOperation": "GET",
  "project": "my-app",
  "table": "users"
}
```

**Get Data in Sequence with Pagination:**
```json
{
  "executeType": "cache",
  "cacheOperation": "GET",
  "project": "my-app",
  "table": "users",
  "page": 1,
  "limit": 50,
  "includeData": "true"
}
```

**Get Keys Only (faster, no timeout):**
```json
{
  "executeType": "cache",
  "cacheOperation": "GET",
  "project": "my-app",
  "table": "users",
  "page": 1,
  "limit": 50,
  "includeData": "false"
}
```

##### POST - Cache Table Data
```json
{
  "executeType": "cache",
  "cacheOperation": "POST",
  "project": "my-app",
  "table": "users",
  "recordsPerKey": 10,
  "ttl": 3600
}
```

##### PUT - Update Cache Data
```json
{
  "executeType": "cache",
  "cacheOperation": "PUT",
  "project": "my-app",
  "table": "users",
  "recordsPerKey": 10,
  "ttl": 3600
}
```

##### PATCH - Partial Cache Update
```json
{
  "executeType": "cache",
  "cacheOperation": "PATCH",
  "project": "my-app",
  "table": "users",
  "recordsPerKey": 10,
  "ttl": 3600
}
```

##### DELETE - Clear Cache
```json
{
  "executeType": "cache",
  "cacheOperation": "DELETE",
  "project": "my-app",
  "table": "users"
}
```

**Clear Specific Pattern:**
```json
{
  "executeType": "cache",
  "cacheOperation": "DELETE",
  "project": "my-app",
  "table": "users",
  "pattern": "user*"
}
```

### Bulk Cache Operation Management

#### Get Active Bulk Cache Operations
```bash
GET /cache/bulk-operations
```

**Response:**
```json
{
  "message": "Active bulk cache operations retrieved",
  "activeOperations": ["my-app:orders", "my-app:products"],
  "count": 2,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### Clear All Active Bulk Cache Operations (Emergency Reset)
```bash
DELETE /cache/bulk-operations
```

**Response:**
```json
{
  "message": "Active bulk cache operations cleared",
  "clearedCount": 2,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Pending Cache Updates Management

#### Get Pending Cache Updates
```bash
GET /cache/pending-updates
```

**Response:**
```json
{
  "message": "Pending cache updates retrieved",
  "pendingUpdates": {
    "my-app:orders": {
      "count": 5,
      "updates": [
        {
          "type": "INSERT",
          "tableName": "orders",
          "timestamp": "2024-01-15T10:30:00.000Z"
        }
      ]
    }
  },
  "totalPending": 5,
  "operationCount": 1
}
```

#### Clear Pending Cache Updates
```bash
# Clear all pending updates
DELETE /cache/pending-updates

# Clear specific operation
DELETE /cache/pending-updates?operationKey=my-app:orders
```

**Response:**
```json
{
  "message": "All pending cache updates cleared",
  "totalCleared": 5,
  "operationCount": 1,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Race Condition Protection

The system automatically prevents conflicts between:
- **Bulk caching operations** (POST/PUT/PATCH cache operations)
- **Lambda-triggered cache updates** (INSERT/MODIFY/REMOVE operations)

**Behavior:**
- If a bulk cache operation is running, cache updates are **queued** for later processing
- Cache updates return `202 Accepted` with queue information
- Bulk operations complete without interruption
- Queued updates are **automatically processed** after bulk cache completes
- **No data loss** - all updates are preserved and processed

**Example Queue Response:**
```json
{
  "message": "Cache update queued for later processing",
  "reason": "Bulk cache operation in progress",
  "tableName": "orders",
  "type": "INSERT",
  "operationKey": "my-app:orders",
  "queuedUpdates": 3,
  "estimatedWaitTime": "Until bulk cache completes"
}
```

**Processing Flow:**
1. **Bulk cache starts** → Acquires lock
2. **Lambda update arrives** → Queued in memory
3. **Bulk cache completes** → Releases lock
4. **Queued updates processed** → All updates applied automatically
5. **Queue cleared** → Ready for next operation

### 6. Indexing Execution (`executeType: "indexing"`)

Algolia search indexing operations for full-text search capabilities.

#### Parameters:
- `indexingOperation` (string, required) - Indexing operation type
- Additional parameters depend on the operation

#### Indexing Operations:

##### Index Table to Algolia
```json
{
  "executeType": "indexing",
  "indexingOperation": "index-table",
  "project": "my-app",
  "table": "products",
  "customFields": ["name", "description", "category"]
}
```

##### Search Indexed Data
```json
{
  "executeType": "indexing",
  "indexingOperation": "search-index",
  "project": "my-app",
  "table": "products",
  "query": "laptop",
  "filters": "category:electronics",
  "hitsPerPage": 20,
  "page": 0
}
```

##### List Available Indices
```json
{
  "executeType": "indexing",
  "indexingOperation": "list-indices",
  "project": "my-app",
  "table": "products"
}
```

##### Delete Indices
```json
{
  "executeType": "indexing",
  "indexingOperation": "delete-indices",
  "project": "my-app",
  "table": "products",
  "keepLatest": 2
}
```

##### Search Health Check
```json
{
  "executeType": "indexing",
  "indexingOperation": "search-health"
}
```

## Response Format

All execution types return a consistent response format:

```json
{
  "success": true,
  "status": 200,
  "data": { /* response data */ },
  "savedCount": 0,
  "metadata": {
    "namespace": "namespace-name",
    "account": "account-name", 
    "method": "method-name",
    "tableName": "table-name"
  }
}
```

## Error Handling

Errors are returned with appropriate HTTP status codes:

```json
{
  "error": "Error message",
  "details": "Additional error details"
}
```

## Common Use Cases

### 1. Data Synchronization
Use sync execution to periodically sync data from external APIs to DynamoDB.

### 2. API Testing
Use single execution to test external APIs and optionally save responses.

### 3. Namespace Management
Use namespace execution to leverage pre-configured API integrations.

### 4. Direct Database Operations
Use CRUD execution for direct DynamoDB operations without external API calls.

### 5. Cache Management
Use cache execution for Redis-based data caching and retrieval operations.

### 6. Search Indexing
Use indexing execution for Algolia-based full-text search capabilities.

## Best Practices

1. **Error Handling**: Always check the `success` field in responses
2. **Pagination**: Use appropriate pagination parameters for large datasets
3. **Rate Limiting**: Consider API rate limits when using sync operations
4. **Data Validation**: Validate data before saving to DynamoDB
5. **Logging**: Monitor execution logs for debugging and monitoring
6. **Cache TTL**: Set appropriate TTL values for cached data
7. **Index Management**: Regularly clean up old search indices

## Environment Variables

Ensure these environment variables are set:
- `AWS_REGION` - AWS region for DynamoDB
- `AWS_ACCESS_KEY_ID` - AWS access key
- `AWS_SECRET_ACCESS_KEY`