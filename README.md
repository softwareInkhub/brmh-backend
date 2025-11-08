# BRMH Backend - Cache System Documentation

## 🎯 Project Overview

The BRMH (Backend Resource Management Hub) cache system provides high-performance data caching using AWS ElastiCache (Valkey) with Redis-compatible operations. The system supports both individual item caching and chunked data storage with automatic duplicate detection, non-blocking operations, and optimized performance.

## Recent Optimizations (Latest Update)

### Performance Improvements
- **Non-blocking cache updates**: Background processing prevents API blocking
- **Parallel cache configuration processing**: Multiple configs processed simultaneously
- **Optimized logging**: Reduced verbosity with one-liner status messages
- **Queue system**: Prevents data loss during concurrent bulk operations
- **Enhanced pagination**: Better handling of large datasets with improved limits

## Architecture

### Components
- **AWS ElastiCache (Valkey)**: Redis-compatible managed caching service
- **DynamoDB**: Primary data source for caching
- **Express.js**: API endpoints for cache operations
- **ioredis**: Redis client for Node.js
- **Lambda Functions**: Data streaming and cache update triggers
- **Queue System**: In-memory queue for pending cache updates

### Cache Key Structure
```
{project}:{tableName}:{identifier}
```

**Examples:**
- Individual items: `my-app:shopify-inkhub-get-products:12345`
- Chunked data: `my-app:shopify-inkhub-get-products:chunk:0`
- Individual items with ID: `my-app:shopify-inkhub-get-products:0000`

## Cache Strategies

### 1. Individual Item Caching (`recordsPerKey = 1`)
- Each DynamoDB item is cached separately
- Key format: `{project}:{tableName}:{itemId}`
- **Benefits:**
  - Granular access to individual items
  - Better cache hit rates
  - Easy item-level updates/deletes
- **Use case:** When you need frequent access to specific items

### 2. Chunked Data Caching (`recordsPerKey > 1`)
- Multiple items grouped into chunks
- Key format: `{project}:{tableName}:chunk:{chunkIndex}`
- **Benefits:**
  - Efficient bulk operations
  - Reduced key overhead
  - Better for large datasets
- **Use case:** When you need bulk data retrieval

## API Endpoints

### Cache Table Data
**POST** `/cache/table`

Caches entire DynamoDB table data with duplicate detection.

**Request Body:**
```json
{
  "project": "my-app",
  "table": "shopify-inkhub-get-products",
  "recordsPerKey": 100,
  "ttl": 3600
}
```

**Response:**
```json
{
  "message": "Caching complete (bounded buffer)",
  "project": "my-app",
  "table": "shopify-inkhub-get-products",
  "totalRecords": 1000,
  "successfulWrites": 850,
  "failedWrites": 0,
  "attemptedKeys": 850,
  "skippedDuplicates": 150,
  "fillRate": "100.00%",
  "durationMs": 5000,
  "cacheKeys": ["key1", "key2"],
  "totalCacheKeys": 850
}
```

### Get Cache Keys
**GET** `/cache/data?project={project}&table={table}`

Retrieves all cache keys for a specific project and table (keys only, no data).

**Response:**
```json
{
  "message": "Cache keys retrieved in sequence (keys only)",
  "keysFound": 132,
  "keys": [
    "my-app:shopify-inkhub-get-products:chunk:0",
    "my-app:shopify-inkhub-get-products:chunk:1"
  ],
  "note": "Use ?key=specific_key to get actual data for a specific key"
}
```

### Get Cache Data in Sequence (Paginated)
**GET** `/cache/data-in-sequence?project={project}&table={table}&page={page}&limit={limit}&includeData={true|false}`

Retrieves cached data with pagination support. By default, returns keys only unless `includeData=true` is specified.

**Parameters:**
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 1000)
- `includeData`: Whether to include actual data (default: false)

**Response (Keys Only - Default):**
```json
{
  "message": "Cache keys retrieved in sequence with pagination (keys only)",
  "keysFound": 100,
  "totalKeys": 132,
  "keys": ["chunk:0", "chunk:1", "chunk:2"],
  "note": "Use ?includeData=true to get actual data for these keys",
  "pagination": {
    "currentPage": 1,
    "totalPages": 2,
    "hasMore": true,
    "totalItems": 132
  }
}
```

**Response (With Data):**
```json
{
  "namespace-id": "uuid",
  "namespace-name": "Shopify",
  "namespace-url": "https://api.shopify.com",
  "tags": ["ecommerce", "api"],
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

#### Accounts Table
```json
{
  "account-id": "uuid",
  "namespace-id": "uuid",
  "namespace-account-name": "Production Store",
  "namespace-account-url-override": "https://mystore.myshopify.com",
  "namespace-account-header": [
    {"key": "Authorization", "value": "Bearer token123"}
  ],
  "variables": [
    {"key": "store_id", "value": "12345"}
  ],
  "tags": ["production"],
  "createdAt": "timestamp"
}
```

#### Methods Table
```json
{
  "method-id": "uuid",
  "namespace-id": "uuid",
  "namespace-method-name": "Get Orders",
  "namespace-method-type": "GET",
  "namespace-method-url-override": "/admin/api/2023-10/orders.json",
  "namespace-method-header": [
    {"key": "Content-Type", "value": "application/json"}
  ],
  "namespace-method-queryParams": {
    "limit": "50",
    "status": "any"
  },
  "namespace-method-body": {},
  "tags": ["orders", "read"],
  "createdAt": "timestamp"
}
```

## 🔄 Execution Flow

### 1. Namespace Request Execution
```javascript
// Example: Execute a Shopify order fetch
POST /unified/execute
{
  "namespaceId": "shopify-namespace-id",
  "accountId": "production-store-account-id", 
  "methodId": "get-orders-method-id",
  "save": true,
  "tableName": "shopify-orders"
}
```

### 2. Pagination Configuration
```javascript
{
  port: parseInt(process.env.REDIS_PORT),
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
  lazyConnect: true,
  connectTimeout: 15000,
  commandTimeout: 15000,
  enableOfflineQueue: true,
  maxRetriesPerRequest: 5
}
```

## Performance Optimizations

### 1. Non-Blocking Operations
- **Background processing**: Cleanup operations run in background using `setImmediate()`
- **Parallel processing**: Multiple cache configurations processed simultaneously
- **Immediate response**: API responds immediately while processing continues
- **No API blocking**: Other endpoints remain responsive during cache updates

### 2. Queue System
- **Concurrency control**: Prevents data loss during concurrent bulk operations
- **In-memory queue**: Pending updates queued when bulk operations are active
- **Automatic processing**: Queued updates processed after bulk operation completes
- **Race condition protection**: Ensures data integrity during high concurrency

### 3. Optimized Logging
- **One-liner messages**: Reduced verbosity with concise status updates
- **No repetitive logs**: Eliminated duplicate and verbose logging
- **Performance tracking**: Duration and success rate logging
- **Clean PM2 logs**: Minimal noise in production logs

### 4. Enhanced Pagination
- **Improved limits**: Default limit increased from 10 to 1000
- **Keys-only default**: Returns keys by default to prevent timeouts
- **Explicit data retrieval**: Data only fetched when `includeData=true`
- **Better pagination info**: Enhanced pagination metadata

### 5. Bounded Buffer
- Processes data in chunks to manage memory usage
- Writes chunks as soon as buffer is full
- Prevents memory overflow with large datasets

### 6. SCAN vs KEYS
- Uses `SCAN` command for Valkey compatibility
- Avoids blocking operations on large datasets
- Supports pattern matching for key retrieval

### 7. Sequential Chunking
- Chunks are numbered sequentially (chunk:0, chunk:1, etc.)
- Enables efficient data retrieval in order
- Supports pagination for large datasets

## Error Handling

### Common Errors & Solutions

1. **Connection Timeout**
   ```
   Error: connect ETIMEDOUT
   ```
   **Solution:** Check security groups and network ACLs

2. **Unknown Command**
   ```
   ReplyError: ERR unknown command 'keys'
   ```
   **Solution:** Use `SCAN` instead of `KEYS` for Valkey

3. **Stream Not Writable**
   ```
   Error: Stream isn't writeable and enableOfflineQueue options is false
   ```
   **Solution:** Enable offline queue in Redis configuration

4. **Cache Update Queued**
   ```
   Status: 202 Accepted
   Message: "Cache update queued for later processing"
   ```
   **Solution:** This is normal during bulk operations. Updates will be processed automatically.

5. **Gateway Timeout (504)**
   ```
   Error: 504 Gateway Timeout
   ```
   **Solution:** Use pagination or set `includeData=false` for large datasets

## Monitoring & Debugging

### Cache Health Check
**GET** `/test-valkey-connection`

Tests connectivity to Valkey cache.

### Cache Cleanup
**POST** `/cache/cleanup-timestamp-chunks`

Converts timestamp-based chunks to sequential numbering.

**POST** `/cache/clear-unwanted-order-data`

Removes non-cache-config data from cache table.

### Queue Management
**GET** `/cache/bulk-operations`

Check currently active bulk cache operations.

**GET** `/cache/pending-updates`

View pending cache updates in queue.

## Best Practices

### 1. Cache Strategy Selection
- Use individual caching for frequently accessed specific items
- Use chunked caching for bulk data operations
- Consider data access patterns when choosing strategy

### 2. TTL Management
- Set appropriate TTL based on data freshness requirements
- Monitor cache hit rates and adjust TTL accordingly
- Use longer TTL for stable data, shorter for frequently changing data

### 3. Memory Management
- Monitor cache size and memory usage
- Implement cache eviction policies if needed
- Use bounded buffer for large dataset processing

### 4. Performance Optimization
- Use `includeData=false` for key-only operations to prevent timeouts
- Leverage pagination for large datasets
- Monitor queue status during high concurrency periods
- Use parallel processing for multiple cache configurations

### 5. Error Recovery
- Implement retry logic for failed cache operations
- Log cache errors for debugging
- Have fallback mechanisms for cache failures
- Monitor queue system for stuck operations

## Example Usage

### Frontend Integration
```javascript
// Cache a table
const cacheTable = async (tableName) => {
  const response = await fetch('/cache/table', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project: 'my-app',
      table: tableName,
      recordsPerKey: 100,
      ttl: 3600
    })
  });
  return response.json();
};

// Get cache keys only (fast, no data)
const getCacheKeys = async (tableName) => {
  const response = await fetch(
    `/cache/data-in-sequence?project=my-app&table=${tableName}&page=1&limit=1000`
  );
  return response.json();
};

// Get cached data with pagination
const getCachedData = async (tableName, page = 1, limit = 100) => {
  const response = await fetch(
    `/cache/data-in-sequence?project=my-app&table=${tableName}&page=${page}&limit=${limit}&includeData=true`
  );
  return response.json();
};

// Get specific cache key data
const getSpecificCacheData = async (tableName, key) => {
  const response = await fetch(
    `/cache/data?project=my-app&table=${tableName}&key=${key}`
  );
  return response.json();
};
```

### Monitoring Cache Performance
```javascript
// Check cache keys and counts
const getCacheKeys = async (tableName) => {
  const response = await fetch(
    `/cache/data?project=my-app&table=${tableName}`
  );
  return response.json();
};

// Monitor queue status
const getQueueStatus = async () => {
  const [bulkOps, pendingUpdates] = await Promise.all([
    fetch('/cache/bulk-operations').then(r => r.json()),
    fetch('/cache/pending-updates').then(r => r.json())
  ]);
  return { bulkOps, pendingUpdates };
};
```

## Troubleshooting

### Cache Not Updating
1. Check Lambda trigger configuration
2. Verify DynamoDB stream settings
3. Ensure cache update endpoint is accessible
4. Check queue status for stuck operations

### Performance Issues
1. Monitor cache hit rates
2. Check for memory pressure
3. Optimize chunk sizes based on data patterns
4. Use `includeData=false` for key-only operations
5. Monitor queue system during high concurrency

### Data Inconsistency
1. Verify TTL settings
2. Check for cache invalidation logic
3. Monitor duplicate detection logs
4. Check for queued updates that haven't been processed

### Timeout Issues
1. Use pagination for large datasets
2. Set `includeData=false` for key-only operations
3. Increase API Gateway timeout limits
4. Monitor cache update queue status

## Support

For issues related to the cache system:
1. Check console logs for detailed error messages
2. Monitor cache metrics and performance
3. Review this documentation for common solutions
4. Contact the development team for complex issues
