# BRMH Backend - Cache System Documentation

## Overview

The BRMH (Backend Resource Management Hub) cache system provides high-performance data caching using AWS ElastiCache (Valkey) with Redis-compatible operations. The system supports both individual item caching and chunked data storage with automatic duplicate detection and management.

## Architecture

### Components
- **AWS ElastiCache (Valkey)**: Redis-compatible managed caching service
- **DynamoDB**: Primary data source for caching
- **Express.js**: API endpoints for cache operations
- **ioredis**: Redis client for Node.js

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

Retrieves all cache keys for a specific project and table.

**Response:**
```json
{
  "message": "Cache keys retrieved in sequence",
  "keysFound": 285,
  "keys": [
    "my-app:shopify-inkhub-get-products:chunk:0",
    "my-app:shopify-inkhub-get-products:chunk:1"
  ]
}
```

**Console Output:**
```
📊 my-app:shopify-inkhub-get-products:chunk:0: 100 items (array)
📊 my-app:shopify-inkhub-get-products:chunk:1: 100 items (array)
📈 Total items across all keys: 28500
```

### Get Cache Data in Sequence
**GET** `/cache/data-in-sequence?project={project}&table={table}&page={page}&limit={limit}`

Retrieves cached data with pagination support.

**Response:**
```json
{
  "message": "Cached data retrieved in sequence",
  "keysFound": 285,
  "totalItems": 1000,
  "keys": ["chunk:0", "chunk:1"],
  "data": [...],
  "pagination": {
    "currentPage": 1,
    "totalPages": 10,
    "hasMore": true,
    "itemsPerPage": 100,
    "startIndex": 0,
    "endIndex": 100
  }
}
```

### Update Cache from Lambda
**POST** `/cache/update`

Updates cache when DynamoDB data changes (triggered by Lambda).

**Request Body:**
```json
{
  "tableName": "shopify-inkhub-get-products",
  "newItem": {...},
  "oldItem": {...}
}
```

## Duplicate Detection & Management

### How It Works
The cache system automatically detects and handles duplicates during insert operations:

1. **Individual Items**: Checks if item ID already exists in cache
2. **Chunked Items**: Scans chunk for duplicate items and filters them out

### Duplicate Handling Strategies

| Scenario | Action | Result |
|----------|--------|---------|
| Individual duplicate item | Skip entirely | Item not cached |
| Chunk with some duplicates | Filter duplicates, cache unique items | Partial chunk cached |
| Chunk with all duplicates | Skip entire chunk | Chunk not cached |
| No duplicates | Cache normally | Full data cached |

### Console Output Examples
```
⏭️ Skipping duplicate item: 12345
⚠️ Found 2 duplicate items in chunk 5: ['67890', '11111']
✅ Redis write succeeded for key my-app:table:chunk:5 (with 3 unique items)
⏭️ Skipping chunk 10 - all items are duplicates
```

## Configuration

### Environment Variables
```env
REDIS_HOST=your-valkey-endpoint.amazonaws.com
REDIS_PORT=6379
REDIS_TLS=true
REDIS_PASSWORD=your-password
```

### Redis Client Configuration
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

### 1. Bounded Buffer
- Processes data in chunks to manage memory usage
- Writes chunks as soon as buffer is full
- Prevents memory overflow with large datasets

### 2. SCAN vs KEYS
- Uses `SCAN` command for Valkey compatibility
- Avoids blocking operations on large datasets
- Supports pattern matching for key retrieval

### 3. Sequential Chunking
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

## Monitoring & Debugging

### Cache Health Check
**GET** `/test-valkey-connection`

Tests connectivity to Valkey cache.

### Cache Cleanup
**POST** `/cache/cleanup-timestamp-chunks`

Converts timestamp-based chunks to sequential numbering.

**POST** `/cache/clear-unwanted-order-data`

Removes non-cache-config data from cache table.

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

### 4. Error Recovery
- Implement retry logic for failed cache operations
- Log cache errors for debugging
- Have fallback mechanisms for cache failures

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

// Get cached data
const getCachedData = async (tableName, page = 1, limit = 100) => {
  const response = await fetch(
    `/cache/data-in-sequence?project=my-app&table=${tableName}&page=${page}&limit=${limit}`
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
```

## Troubleshooting

### Cache Not Updating
1. Check Lambda trigger configuration
2. Verify DynamoDB stream settings
3. Ensure cache update endpoint is accessible

### Performance Issues
1. Monitor cache hit rates
2. Check for memory pressure
3. Optimize chunk sizes based on data patterns

### Data Inconsistency
1. Verify TTL settings
2. Check for cache invalidation logic
3. Monitor duplicate detection logs

## Support

For issues related to the cache system:
1. Check console logs for detailed error messages
2. Monitor cache metrics and performance
3. Review this documentation for common solutions
4. Contact the development team for complex issues
