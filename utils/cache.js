// import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
// import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
// import { unmarshall } from "@aws-sdk/util-dynamodb";
// import Redis from "ioredis";

// console.log('Cache service: importing modules and initializing clients');

// // Initialize Redis client
// const redis = new Redis({
//   host: process.env.REDIS_HOST || 'localhost',
//   port: process.env.REDIS_PORT || 6379,
//   tls: process.env.REDIS_TLS === 'true' ? {} : undefined, // Enable TLS if needed
//   password: process.env.REDIS_PASSWORD, // Optional password
//   retryDelayOnFailover: 100,
//   maxRetriesPerRequest: 3,
// });

// // Initialize DynamoDB clients
// const ddb = new DynamoDBClient({});
// const docClient = DynamoDBDocumentClient.from(ddb);

// // Redis connection event handlers
// redis.on('connect', () => {
//   console.log('✅ Redis connected successfully');
// });

// redis.on('error', (err) => {
//   console.error('❌ Redis connection error:', err);
// });

// redis.on('close', () => {
//   console.log('🔌 Redis connection closed');
// });

// /**
//  * Express handler for caching DynamoDB table data to Redis
//  * Request body: {
//  *   project: string,
//  *   table: string,
//  *   recordsPerKey: number,
//  *   ttl: number
//  * }
//  */
// export const cacheTableHandler = async (req, res) => {
//   const start = Date.now();

//   try {
//     const { project, table, recordsPerKey = 1, ttl = 3600 } = req.body;

//     console.log('Cache handler invoked with request:', JSON.stringify(req.body));

//     // Validation
//     if (!project || !table) {
//       console.error("Missing 'project' or 'table' in request");
//       return res.status(400).json({ 
//         error: "Missing 'project' or 'table'",
//         message: "Both project and table are required parameters"
//       });
//     }

//     if (recordsPerKey < 1) {
//       console.error("'recordsPerKey' must be >= 1");
//       return res.status(400).json({ 
//         error: "'recordsPerKey' must be >= 1",
//         message: "recordsPerKey must be a positive integer"
//       });
//     }

//     if (ttl < 1) {
//       console.error("'ttl' must be >= 1");
//       return res.status(400).json({ 
//         error: "'ttl' must be >= 1",
//         message: "TTL must be a positive integer (seconds)"
//       });
//     }

//     console.log(`📤 Starting bounded buffer cache operation for table: ${table}, project: ${project}`);
    
//     const {
//       totalScanned,
//       successfulWrites,
//       failedWrites,
//       attemptedKeys,
//       cacheKeys
//     } = await scanAndCacheWithBoundedBuffer(table, project, recordsPerKey, ttl);
    
//     const fillRate = attemptedKeys > 0 ? ((successfulWrites / attemptedKeys) * 100).toFixed(2) : '0.00';
//     const duration = Date.now() - start;

//     console.log("✅ Successful cache writes:", successfulWrites);
//     console.log("❌ Failed cache writes:", failedWrites);
//     console.log("📊 Cache Fill Rate:", `${fillRate}%`);
//     console.log("⏱️ Cache operation duration (ms):", duration);

//     return res.status(200).json({
//       message: "Caching complete (bounded buffer)",
//       project,
//       table,
//       totalRecords: totalScanned,
//       successfulWrites,
//       failedWrites,
//       attemptedKeys,
//       fillRate: `${fillRate}%`,
//       durationMs: duration,
//       cacheKeys: cacheKeys.slice(0, 10), // Return first 10 keys as sample
//       totalCacheKeys: cacheKeys.length
//     });

//   } catch (err) {
//     const duration = Date.now() - start;
//     console.error("🔥 Cache handler failed:", err);
//     console.log("⏱️ Failed after (ms):", duration);

//     return res.status(500).json({
//       message: "Cache operation failed",
//       error: err.message,
//       durationMs: duration,
//       timestamp: new Date().toISOString()
//     });
//   }
// };

// /**
//  * Scans DynamoDB and caches records in global chunks (across pages) to Redis using a bounded buffer.
//  */
// async function scanAndCacheWithBoundedBuffer(tableName, project, recordsPerKey, ttl) {
//   let ExclusiveStartKey;
//   let totalScanned = 0;
//   let successfulWrites = 0;
//   let failedWrites = 0;
//   let attemptedKeys = 0;
//   let chunkIndex = 0;
//   let buffer = [];
//   let page = 0;
//   let cacheKeys = [];

//   do {
//     page++;
//     console.log(`Scanning DynamoDB page ${page}: table=${tableName}, ExclusiveStartKey=${JSON.stringify(ExclusiveStartKey)}`);
    
//     const command = new ScanCommand({ 
//       TableName: tableName, 
//       ExclusiveStartKey,
//       // Optional: Add filter expression or projection if needed
//       // FilterExpression: "attribute_exists(id)",
//       // ProjectionExpression: "id, name, email"
//     });
    
//     const response = await ddb.send(command);
//     const scanned = response.Items.map(unmarshall);
//     totalScanned += scanned.length;
//     console.log(`Scanned ${scanned.length} items, total so far: ${totalScanned}`);

//     buffer.push(...scanned);

//     // Write out full chunks as soon as buffer is large enough
//     while (buffer.length >= recordsPerKey) {
//       const chunk = buffer.slice(0, recordsPerKey);
//       buffer = buffer.slice(recordsPerKey);
      
//       let key, value;
//       if (recordsPerKey === 1) {
//         const item = chunk[0];
//         // Try different ID fields
//         const itemId = item.id || item.pk || item.PK || item.Id || item.ID || chunkIndex;
//         key = `${project}:${tableName}:${itemId}`;
//         value = JSON.stringify(item);
//       } else {
//         key = `${project}:${tableName}:chunk:${chunkIndex}`;
//         value = JSON.stringify(chunk);
//       }
      
//       attemptedKeys++;
//       cacheKeys.push(key);
      
//       try {
//         await redis.set(key, value, 'EX', ttl);
//         successfulWrites++;
//         console.log(`✅ Redis write succeeded for key ${key} (chunk ${chunkIndex})`);
//       } catch (err) {
//         failedWrites++;
//         console.error(`❌ Redis write failed for key ${key} (chunk ${chunkIndex}):`, err);
//       }
//       chunkIndex++;
//     }

//     ExclusiveStartKey = response.LastEvaluatedKey;
//   } while (ExclusiveStartKey);

//   // Write any remaining items in buffer
//   if (buffer.length > 0) {
//     let key, value;
//     if (recordsPerKey === 1) {
//       const item = buffer[0];
//       const itemId = item.id || item.pk || item.PK || item.Id || item.ID || chunkIndex;
//       key = `${project}:${tableName}:${itemId}`;
//       value = JSON.stringify(item);
//     } else {
//       key = `${project}:${tableName}:chunk:${chunkIndex}`;
//       value = JSON.stringify(buffer);
//     }
    
//     attemptedKeys++;
//     cacheKeys.push(key);
    
//     try {
//       await redis.set(key, value, 'EX', ttl);
//       successfulWrites++;
//       console.log(`✅ Redis write succeeded for key ${key} (final chunk)`);
//     } catch (err) {
//       failedWrites++;
//       console.error(`❌ Redis write failed for key ${key} (final chunk):`, err);
//     }
//   }

//   return { totalScanned, successfulWrites, failedWrites, attemptedKeys, cacheKeys };
// }

// /**
//  * Get cached data from Redis
//  */
// export const getCachedDataHandler = async (req, res) => {
//   try {
//     const { project, table, key } = req.query;
//     const { pattern } = req.query;

//     if (pattern) {
//       // Get multiple keys matching pattern
//       const searchPattern = `${project}:${table}:${pattern}`;
//       const keys = await redis.keys(searchPattern);
      
//       if (keys.length === 0) {
//         return res.status(404).json({
//           message: "No cached keys found matching pattern",
//           pattern: searchPattern
//         });
//       }

//       const cachedData = {};
//       for (const k of keys) {
//         const value = await redis.get(k);
//         if (value) {
//           cachedData[k] = JSON.parse(value);
//         }
//       }

//       return res.status(200).json({
//         message: "Cached data retrieved",
//         keysFound: keys.length,
//         data: cachedData
//       });
//     } else if (key) {
//       // Get specific key
//       const cacheKey = `${project}:${table}:${key}`;
//       const value = await redis.get(cacheKey);
      
//       if (!value) {
//         return res.status(404).json({
//           message: "Cached key not found",
//           key: cacheKey
//         });
//       }

//       return res.status(200).json({
//         message: "Cached data retrieved",
//         key: cacheKey,
//         data: JSON.parse(value)
//       });
//     } else {
//       // Get all keys for project:table
//       const searchPattern = `${project}:${table}:*`;
//       const keys = await redis.keys(searchPattern);
      
//       return res.status(200).json({
//         message: "Cache keys retrieved",
//         keysFound: keys.length,
//         keys: keys
//       });
//     }

//   } catch (err) {
//     console.error("🔥 Get cached data failed:", err);
//     return res.status(500).json({
//       message: "Failed to retrieve cached data",
//       error: err.message
//     });
//   }
// };

// /**
//  * Clear cached data from Redis
//  */
// export const clearCacheHandler = async (req, res) => {
//   try {
//     const { project, table } = req.query;
//     const { pattern } = req.query;

//     let searchPattern;
//     if (pattern) {
//       searchPattern = `${project}:${table}:${pattern}`;
//     } else {
//       searchPattern = `${project}:${table}:*`;
//     }

//     const keys = await redis.keys(searchPattern);
    
//     if (keys.length === 0) {
//       return res.status(404).json({
//         message: "No cached keys found to clear",
//         pattern: searchPattern
//       });
//     }

//     const deletedCount = await redis.del(...keys);

//     return res.status(200).json({
//       message: "Cache cleared successfully",
//       keysDeleted: deletedCount,
//       pattern: searchPattern
//     });

//   } catch (err) {
//     console.error("🔥 Clear cache failed:", err);
//     return res.status(500).json({
//       message: "Failed to clear cache",
//       error: err.message
//     });
//   }
// };

// /**
//  * Get cache statistics
//  */
// export const getCacheStatsHandler = async (req, res) => {
//   try {
//     const { project, table } = req.query;
//     const searchPattern = `${project}:${table}:*`;
//     const keys = await redis.keys(searchPattern);
    
//     const stats = {
//       totalKeys: keys.length,
//       pattern: searchPattern,
//       project,
//       table,
//       timestamp: new Date().toISOString()
//     };

//     // Get TTL for first few keys as sample
//     if (keys.length > 0) {
//       const sampleKeys = keys.slice(0, 5);
//       const ttls = await Promise.all(sampleKeys.map(key => redis.ttl(key)));
//       stats.sampleTTLs = sampleKeys.map((key, index) => ({
//         key,
//         ttl: ttls[index]
//       }));
//     }

//     return res.status(200).json({
//       message: "Cache statistics retrieved",
//       stats
//     });

//   } catch (err) {
//     console.error("🔥 Get cache stats failed:", err);
//     return res.status(500).json({
//       message: "Failed to get cache statistics",
//       error: err.message
//     });
//   }
// };

// /**
//  * Health check for Redis connection
//  */
// export const cacheHealthHandler = async (req, res) => {
//   try {
//     const ping = await redis.ping();
//     const info = await redis.info('server');
    
//     return res.status(200).json({
//       message: "Cache service is healthy",
//       redis: {
//         connected: ping === 'PONG',
//         info: info.split('\r\n').slice(0, 5) // First 5 lines of info
//       },
//       timestamp: new Date().toISOString()
//     });

//   } catch (err) {
//     console.error("🔥 Cache health check failed:", err);
//     return res.status(503).json({
//       message: "Cache service is unhealthy",
//       error: err.message,
//       timestamp: new Date().toISOString()
//     });
//   }
// };

// /**
//  * Test connection to Redis/Valkey cache
//  */
// export const testCacheConnection = async (req, res) => {
//   try {
//     console.log('🔍 Testing cache connection...');
    
//     // Test basic connectivity
//     await redis.ping();
//     console.log('✅ Redis ping successful');
    
//     // Test basic operations
//     await redis.set('test-key', 'test-value', 'EX', 60);
//     const value = await redis.get('test-key');
//     await redis.del('test-key');
    
//     if (value === 'test-value') {
//       console.log('✅ Redis read/write operations successful');
//       res.json({
//         status: 'success',
//         message: 'Cache connection test passed',
//         endpoint: process.env.REDIS_HOST,
//         timestamp: new Date().toISOString()
//       });
//     } else {
//       throw new Error('Read/write test failed');
//     }
//   } catch (error) {
//     console.error('❌ Cache connection test failed:', error);
//     res.status(500).json({
//       status: 'error',
//       message: 'Cache connection test failed',
//       error: error.message,
//       endpoint: process.env.REDIS_HOST,
//       timestamp: new Date().toISOString()
//     });
//   }
// };

// // Graceful shutdown
// process.on('SIGINT', async () => {
//   console.log('🔄 Shutting down cache service...');
//   await redis.quit();
//   console.log('✅ Cache service shutdown complete');
//   process.exit(0);
// });

// process.on('SIGTERM', async () => {
//   console.log('🔄 Shutting down cache service...');
//   await redis.quit();
//   console.log('✅ Cache service shutdown complete');
//   process.exit(0);
// });
