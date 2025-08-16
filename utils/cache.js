import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import Redis from "ioredis";

console.log('Cache service: importing modules and initializing clients');

// Initialize Redis client with enhanced configuration
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
  password: process.env.REDIS_PASSWORD,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 5,
  lazyConnect: true,
  connectTimeout: 15000,
  commandTimeout: 15000,
  showFriendlyErrorStack: true,
  // Add connection debugging
  enableOfflineQueue: true,
  maxLoadingTimeout: 15000,
  // Add retry strategy
  retryDelayOnClusterDown: 300,
  retryDelayOnFailover: 100,
  // Add keep-alive
  keepAlive: 30000,
  family: 4, // Force IPv4
  // Add reconnection settings
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 5,
  // Add connection pool
  maxLoadingTimeout: 15000,
  // Add connection monitoring
  lazyConnect: false, // Connect immediately
  // Add error recovery
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 5,
});

// Initialize DynamoDB clients
const ddb = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddb);

// Enhanced connection event handlers
redis.on('connect', () => {
  console.log('✅ Redis connected successfully');
  console.log('🔍 Connection details:', {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    tls: process.env.REDIS_TLS,
    tlsEnabled: process.env.REDIS_TLS === 'true'
  });
});

redis.on('error', (err) => {
  console.error('❌ Redis connection error:', err);
  console.error('🔍 Error details:', {
    code: err.code,
    errno: err.errno,
    syscall: err.syscall,
    address: err.address,
    port: err.port,
    host: process.env.REDIS_HOST,
    tls: process.env.REDIS_TLS
  });
});

redis.on('close', () => {
  console.log('🔌 Redis connection closed');
});

redis.on('ready', () => {
  console.log('🚀 Redis is ready to accept commands');
});

// Add a simple connection test function
export const testRedisConnection = async () => {
  try {
    console.log('🔍 Testing Redis connection...');
    console.log('📋 Connection config:', {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
      tls: process.env.REDIS_TLS === 'true' ? 'enabled' : 'disabled',
      password: process.env.REDIS_PASSWORD ? '***' : 'none'
    });
    
    await redis.ping();
    console.log('✅ Redis ping successful');
    return true;
  } catch (error) {
    console.error('❌ Redis connection test failed:', error);
    return false;
  }
};

/**
 * Express handler for caching DynamoDB table data to Redis
 * Request body: {
 *   project: string,
 *   table: string,
 *   recordsPerKey: number,
 *   ttl: number
 * }
 */
export const cacheTableHandler = async (req, res) => {
  const start = Date.now();

  try {
    const { project, table, recordsPerKey = 1, ttl = 3600 } = req.body;

    console.log('Cache handler invoked with request:', JSON.stringify(req.body));

    // Validation
    if (!project || !table) {
      console.error("Missing 'project' or 'table' in request");
      return res.status(400).json({ 
        error: "Missing 'project' or 'table'",
        message: "Both project and table are required parameters"
      });
    }

    if (recordsPerKey < 1) {
      console.error("'recordsPerKey' must be >= 1");
      return res.status(400).json({ 
        error: "'recordsPerKey' must be >= 1",
        message: "recordsPerKey must be a positive integer"
      });
    }

    if (ttl !== undefined && ttl !== null && ttl < 0) {
      console.error("'ttl' must be >= 0 (0 = no expiration)");
      return res.status(400).json({ 
        error: "'ttl' must be >= 0",
        message: "TTL must be >= 0 (0 = no expiration, positive = seconds)"
      });
    }

    console.log(`📤 Starting bounded buffer cache operation for table: ${table}, project: ${project}`);
    
    const {
      totalScanned,
      successfulWrites,
      failedWrites,
      attemptedKeys,
      skippedDuplicates,
      cacheKeys
    } = await scanAndCacheWithBoundedBuffer(table, project, recordsPerKey, ttl);
    
    const fillRate = attemptedKeys > 0 ? ((successfulWrites / attemptedKeys) * 100).toFixed(2) : '0.00';
    const duration = Date.now() - start;

    console.log("✅ Successful cache writes:", successfulWrites);
    console.log("❌ Failed cache writes:", failedWrites);
    console.log("⏭️ Skipped duplicates:", skippedDuplicates);
    console.log("📊 Cache Fill Rate:", `${fillRate}%`);
    console.log("⏱️ Cache operation duration (ms):", duration);

    return res.status(200).json({
      message: "Caching complete (bounded buffer)",
      project,
      table,
      totalRecords: totalScanned,
      successfulWrites,
      failedWrites,
      attemptedKeys,
      skippedDuplicates,
      fillRate: `${fillRate}%`,
      durationMs: duration,
      cacheKeys: cacheKeys.slice(0, 10), // Return first 10 keys as sample
      totalCacheKeys: cacheKeys.length
    });

  } catch (err) {
    const duration = Date.now() - start;
    console.error("🔥 Cache handler failed:", err);
    console.log("⏱️ Failed after (ms):", duration);

    return res.status(500).json({
      message: "Cache operation failed",
      error: err.message,
      durationMs: duration,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Check if an item already exists in cache
 */
async function isItemAlreadyCached(project, tableName, itemId) {
  try {
    const key = `${project}:${tableName}:${itemId}`;
    const exists = await redis.exists(key);
    return exists === 1;
  } catch (err) {
    console.error(`❌ Error checking if item ${itemId} exists in cache:`, err);
    return false; // Assume not cached if error occurs
  }
}

/**
 * Check if any items in a chunk already exist in cache
 */
async function getDuplicateItems(project, tableName, items) {
  const duplicates = [];
  
  for (const item of items) {
    const itemId = item.id || item.pk || item.PK || item.Id || item.ID;
    if (itemId && await isItemAlreadyCached(project, tableName, itemId)) {
      duplicates.push(itemId);
    }
  }
  
  return duplicates;
}

/**
 * Scan DynamoDB table and cache data with bounded buffer
 */
async function scanAndCacheWithBoundedBuffer(tableName, project, recordsPerKey, ttl) {
  let ExclusiveStartKey;
  let totalScanned = 0;
  let successfulWrites = 0;
  let failedWrites = 0;
  let attemptedKeys = 0;
  let skippedDuplicates = 0;
  let chunkIndex = 0;
  let buffer = [];
  let page = 0;
  let cacheKeys = [];

  do {
    page++;
    console.log(`Scanning DynamoDB page ${page}: table=${tableName}, ExclusiveStartKey=${JSON.stringify(ExclusiveStartKey)}`);
    
    const command = new ScanCommand({ 
      TableName: tableName, 
      ExclusiveStartKey,
      // Optional: Add filter expression or projection if needed
      // FilterExpression: "attribute_exists(id)",
      // ProjectionExpression: "id, name, email"
    });
    
    const response = await ddb.send(command);
    const scanned = response.Items.map(unmarshall);
    totalScanned += scanned.length;
    console.log(`Scanned ${scanned.length} items, total so far: ${totalScanned}`);

    buffer.push(...scanned);

    // Write out full chunks as soon as buffer is large enough
    while (buffer.length >= recordsPerKey) {
      const chunk = buffer.slice(0, recordsPerKey);
      buffer = buffer.slice(recordsPerKey);
      
      let key, value;
      if (recordsPerKey === 1) {
        const item = chunk[0];
        // Try different ID fields
        const itemId = item.id || item.pk || item.PK || item.Id || item.ID || chunkIndex;
        key = `${project}:${tableName}:${itemId}`;
        value = JSON.stringify(item);
        
        // Check for duplicate before inserting
        if (await isItemAlreadyCached(project, tableName, itemId)) {
          console.log(`⏭️ Skipping duplicate item: ${itemId}`);
          skippedDuplicates++;
          chunkIndex++;
          continue;
        }
      } else {
        key = `${project}:${tableName}:chunk:${chunkIndex}`;
        value = JSON.stringify(chunk);
        
        // Check for duplicates in chunk
        const duplicates = await getDuplicateItems(project, tableName, chunk);
        if (duplicates.length > 0) {
          console.log(`⚠️ Found ${duplicates.length} duplicate items in chunk ${chunkIndex}:`, duplicates);
          // Filter out duplicates from chunk
          const uniqueItems = chunk.filter(item => {
            const itemId = item.id || item.pk || item.PK || item.Id || item.ID;
            return !itemId || !duplicates.includes(itemId);
          });
          
          if (uniqueItems.length === 0) {
            console.log(`⏭️ Skipping chunk ${chunkIndex} - all items are duplicates`);
            skippedDuplicates += chunk.length;
            chunkIndex++;
            continue;
          }
          
          value = JSON.stringify(uniqueItems);
          skippedDuplicates += duplicates.length;
        }
      }
      
      attemptedKeys++;
      cacheKeys.push(key);
      
      try {
        if (ttl && ttl > 0) {
          await redis.set(key, value, 'EX', ttl);
        } else {
          await redis.set(key, value); // No expiration
        }
        successfulWrites++;
        console.log(`✅ Redis write succeeded for key ${key} (chunk ${chunkIndex})${ttl && ttl > 0 ? ` with TTL ${ttl}s` : ' with no expiration'}`);
      } catch (err) {
        failedWrites++;
        console.error(`❌ Redis write failed for key ${key} (chunk ${chunkIndex}):`, err);
      }
      chunkIndex++;
    }

    ExclusiveStartKey = response.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  // Write any remaining items in buffer
  if (buffer.length > 0) {
    let key, value;
    if (recordsPerKey === 1) {
      const item = buffer[0];
      const itemId = item.id || item.pk || item.PK || item.Id || item.ID || chunkIndex;
      key = `${project}:${tableName}:${itemId}`;
      value = JSON.stringify(item);
      
      // Check for duplicate before inserting
      if (await isItemAlreadyCached(project, tableName, itemId)) {
        console.log(`⏭️ Skipping duplicate item: ${itemId}`);
        skippedDuplicates++;
      } else {
        attemptedKeys++;
        cacheKeys.push(key);
        
        try {
          await redis.set(key, value, 'EX', ttl);
          successfulWrites++;
          console.log(`✅ Redis write succeeded for key ${key} (final chunk)`);
        } catch (err) {
          failedWrites++;
          console.error(`❌ Redis write failed for key ${key} (final chunk):`, err);
        }
      }
    } else {
      key = `${project}:${tableName}:chunk:${chunkIndex}`;
      value = JSON.stringify(buffer);
      
      // Check for duplicates in final buffer
      const duplicates = await getDuplicateItems(project, tableName, buffer);
      if (duplicates.length > 0) {
        console.log(`⚠️ Found ${duplicates.length} duplicate items in final buffer:`, duplicates);
        // Filter out duplicates from buffer
        const uniqueItems = buffer.filter(item => {
          const itemId = item.id || item.pk || item.PK || item.Id || item.ID;
          return !itemId || !duplicates.includes(itemId);
        });
        
        if (uniqueItems.length === 0) {
          console.log(`⏭️ Skipping final buffer - all items are duplicates`);
          skippedDuplicates += buffer.length;
        } else {
          value = JSON.stringify(uniqueItems);
          skippedDuplicates += duplicates.length;
          
          attemptedKeys++;
          cacheKeys.push(key);
          
          try {
            if (ttl && ttl > 0) {
              await redis.set(key, value, 'EX', ttl);
            } else {
              await redis.set(key, value); // No expiration
            }
            successfulWrites++;
            console.log(`✅ Redis write succeeded for key ${key} (final chunk)${ttl && ttl > 0 ? ` with TTL ${ttl}s` : ' with no expiration'}`);
          } catch (err) {
            failedWrites++;
            console.error(`❌ Redis write failed for key ${key} (final chunk):`, err);
          }
        }
      } else {
        attemptedKeys++;
        cacheKeys.push(key);
        
        try {
          await redis.set(key, value, 'EX', ttl);
          successfulWrites++;
          console.log(`✅ Redis write succeeded for key ${key} (final chunk)`);
        } catch (err) {
          failedWrites++;
          console.error(`❌ Redis write failed for key ${key} (final chunk):`, err);
        }
      }
    }
  }

  return { totalScanned, successfulWrites, failedWrites, attemptedKeys, skippedDuplicates, cacheKeys };
}

/**
 * Get cached data from Redis
 */
export const getCachedDataHandler = async (req, res) => {
  console.log('🔍 Get cached data request:', req.query);
  try {
    const { project, table, key } = req.query;
    const { pattern } = req.query;

    console.log(`📋 Query params: project=${project}, table=${table}, key=${key}, pattern=${pattern}`);

         if (pattern) {
       // Get multiple keys matching pattern
       const searchPattern = `${project}:${table}:${pattern}`;
       console.log(`🔎 Searching with pattern: ${searchPattern}`);
       
       // Use SCAN for Valkey compatibility
       const keys = [];
       let cursor = '0';
       
       do {
         const result = await redis.scan(cursor, 'MATCH', searchPattern, 'COUNT', '100');
          cursor = result[0];
          keys.push(...result[1]);
        } while (cursor !== '0');
       
       console.log(`📦 Found ${keys.length} keys matching pattern`);
      
      if (keys.length === 0) {
        console.log(`❌ No cached keys found matching pattern: ${searchPattern}`);
        return res.status(404).json({
          message: "No cached keys found matching pattern",
          pattern: searchPattern
        });
      }

      const cachedData = {};
      for (const k of keys) {
        const value = await redis.get(k);
        if (value) {
          cachedData[k] = JSON.parse(value);
          console.log(`✅ Retrieved data for key: ${k}`);
        }
      }

      console.log(`📊 Returning ${Object.keys(cachedData).length} cached items`);
      return res.status(200).json({
        message: "Cached data retrieved",
        keysFound: keys.length,
        data: cachedData
      });
    } else if (key) {
      // Get specific key
      const cacheKey = `${project}:${table}:${key}`;
      console.log(`🔎 Looking for specific key: ${cacheKey}`);
      const value = await redis.get(cacheKey);
      
      if (!value) {
        console.log(`❌ Cached key not found: ${cacheKey}`);
        return res.status(404).json({
          message: "Cached key not found",
          key: cacheKey
        });
      }

      const parsedData = JSON.parse(value);
      console.log(`✅ Retrieved data for key: ${cacheKey}`, parsedData);
      
      return res.status(200).json({
        message: "Cached data retrieved",
        key: cacheKey,
        data: parsedData
      });
         } else {
       // Get all keys for project:table
       const searchPattern = `${project}:${table}:*`;
       console.log(`🔎 Searching for all keys with pattern: ${searchPattern}`);
       
       // Use SCAN for Valkey compatibility
        const keys = [];
        let cursor = '0';
       
       do {
         const result = await redis.scan(cursor, 'MATCH', searchPattern, 'COUNT', '100');
          cursor = result[0];
          keys.push(...result[1]);
        } while (cursor !== '0');
       
       console.log(`📦 Found ${keys.length} total keys for ${project}:${table}`);
        
        if (keys.length > 0) {
          console.log(`📋 Keys found:`, keys);
          
          // Sort keys to get chunks in sequence
          const sortedKeys = keys.sort((a, b) => {
            // Extract chunk numbers for comparison
            const aMatch = a.match(/chunk:(\d+)$/);
            const bMatch = b.match(/chunk:(\d+)$/);
            
            if (aMatch && bMatch) {
              // Both are chunk keys, sort by chunk number
              return parseInt(aMatch[1]) - parseInt(bMatch[1]);
            } else if (aMatch) {
              // Only a is a chunk key, put chunks after individual items
              return 1;
            } else if (bMatch) {
              // Only b is a chunk key, put chunks after individual items
              return -1;
            } else {
              // Both are individual items, sort alphabetically
              return a.localeCompare(b);
            }
          });
          
          console.log(`📋 Sorted keys:`, sortedKeys);
          
          // Get data count for each key
          const keysWithCounts = [];
          let totalItems = 0;
          
          for (const key of sortedKeys) {
            try {
              const value = await redis.get(key);
              if (value) {
                const data = JSON.parse(value);
                const itemCount = Array.isArray(data) ? data.length : 1;
                totalItems += itemCount;
                
                keysWithCounts.push({
                  key: key,
                  itemCount: itemCount,
                  dataType: Array.isArray(data) ? 'array' : 'object'
                });
                
                console.log(`📊 ${key}: ${itemCount} item${itemCount !== 1 ? 's' : ''} (${Array.isArray(data) ? 'array' : 'object'})`);
              } else {
                keysWithCounts.push({
                  key: key,
                  itemCount: 0,
                  dataType: 'empty'
                });
                console.log(`📊 ${key}: 0 items (empty)`);
              }
            } catch (err) {
              console.error(`❌ Error reading data for key ${key}:`, err);
              keysWithCounts.push({
                key: key,
                itemCount: 0,
                dataType: 'error'
              });
            }
          }
          
          console.log(`📈 Total items across all keys: ${totalItems}`);
          
          return res.status(200).json({
            message: "Cache keys retrieved in sequence",
            keysFound: sortedKeys.length,
            keys: sortedKeys
          });
        }
      
      return res.status(200).json({
        message: "Cache keys retrieved",
        keysFound: keys.length,
        keys: keys
      });
    }

  } catch (err) {
    console.error("🔥 Get cached data failed:", err);
    return res.status(500).json({
      message: "Failed to retrieve cached data",
      error: err.message
    });
  }
};

/**
 * Get cached data in sequence with pagination
 */
export const getCachedDataInSequenceHandler = async (req, res) => {
  console.log('🔍 Get cached data in sequence request:', req.query);
  try {
    const { project, table, page = 1, limit = 10 } = req.query;

    console.log(`📋 Query params: project=${project}, table=${table}, page=${page}, limit=${limit}`);

    if (!project || !table) {
      return res.status(400).json({
        error: "Missing parameters",
        message: "Both project and table are required"
      });
    }

    // Get all keys for project:table
    const searchPattern = `${project}:${table}:*`;
    console.log(`🔎 Searching for all keys with pattern: ${searchPattern}`);
    
    // Use SCAN for Valkey compatibility
    const keys = [];
    let cursor = '0';
    
    do {
      const result = await redis.scan(cursor, 'MATCH', searchPattern, 'COUNT', '100');
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== '0');
    
    console.log(`📦 Found ${keys.length} total keys for ${project}:${table}`);
    
    if (keys.length === 0) {
      return res.status(404).json({
        message: "No cached keys found",
        pattern: searchPattern,
        keysFound: 0,
        data: [],
        pagination: {
          currentPage: parseInt(page),
          totalPages: 0,
          hasMore: false,
          totalItems: 0
        }
      });
    }

    // Sort keys to get chunks in sequence
    const sortedKeys = keys.sort((a, b) => {
      // Extract chunk numbers for comparison
      const aMatch = a.match(/chunk:(\d+)$/);
      const bMatch = b.match(/chunk:(\d+)$/);
      
      if (aMatch && bMatch) {
        // Both are chunk keys, sort by chunk number
        return parseInt(aMatch[1]) - parseInt(bMatch[1]);
      } else if (aMatch) {
        // Only a is a chunk key, put chunks after individual items
        return 1;
      } else if (bMatch) {
        // Only b is a chunk key, put chunks after individual items
        return -1;
      } else {
        // Both are individual items, sort alphabetically
        return a.localeCompare(b);
      }
    });
    
    console.log(`📋 Sorted keys:`, sortedKeys);
    
    // Get all data in sequence first with detailed count information
    const allData = [];
    const keysWithData = [];
    const keysWithCounts = [];
    let totalItems = 0;
    
    for (const k of sortedKeys) {
      try {
        const value = await redis.get(k);
        if (value) {
          const parsedData = JSON.parse(value);
          const itemCount = Array.isArray(parsedData) ? parsedData.length : 1;
          totalItems += itemCount;
          
          // If it's an array (chunk), spread the items
          if (Array.isArray(parsedData)) {
            allData.push(...parsedData);
            console.log(`📦 Retrieved chunk ${k} with ${parsedData.length} items`);
          } else {
            // If it's a single item
            allData.push(parsedData);
            console.log(`📦 Retrieved single item ${k} with 1 item`);
          }
          
          keysWithData.push(k);
          keysWithCounts.push({
            key: k,
            itemCount: itemCount,
            dataType: Array.isArray(parsedData) ? 'array' : 'object'
          });
        } else {
          console.log(`📦 Empty key: ${k}`);
          keysWithCounts.push({
            key: k,
            itemCount: 0,
            dataType: 'empty'
          });
        }
      } catch (err) {
        console.error(`❌ Error reading data for key ${k}:`, err);
        keysWithCounts.push({
          key: k,
          itemCount: 0,
          dataType: 'error'
        });
      }
    }
    
    console.log(`📊 Total items retrieved: ${allData.length} from ${keysWithData.length} keys`);
    console.log(`📈 Total items across all keys: ${totalItems}`);
    
    // Apply pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const startIndex = (pageNum - 1) * limitNum;
    const endIndex = startIndex + limitNum;
    const totalPages = Math.ceil(allData.length / limitNum);
    const hasMore = pageNum < totalPages;
    
    const paginatedData = allData.slice(startIndex, endIndex);
    
    console.log(`📄 Pagination: page ${pageNum}/${totalPages}, showing ${paginatedData.length} items`);
    
    return res.status(200).json({
      message: "Cached data retrieved in sequence",
      keysFound: keysWithData.length,
      totalItems: allData.length,
      keys: keysWithData,
      data: paginatedData,
      pagination: {
        currentPage: pageNum,
        totalPages: totalPages,
        hasMore: hasMore,
        itemsPerPage: limitNum,
        startIndex: startIndex,
        endIndex: endIndex
      }
    });

  } catch (err) {
    console.error("🔥 Get cached data in sequence failed:", err);
    return res.status(500).json({
      message: "Failed to retrieve cached data in sequence",
      error: err.message
    });
  }
};

/**
 * Get paginated cache keys
 */
export const getPaginatedCacheKeysHandler = async (req, res) => {
  console.log('🔍 Get paginated cache keys request:', req.query);
  try {
    const { project, table, page = 1, limit = 1 } = req.query;

    console.log(`📋 Query params: project=${project}, table=${table}, page=${page}, limit=${limit}`);

    // Get all keys for project:table
    const searchPattern = `${project}:${table}:*`;
    console.log(`🔎 Searching for all keys with pattern: ${searchPattern}`);
    
    // Use SCAN for Valkey compatibility
    const allKeys = [];
    let cursor = '0';
    
    do {
      const result = await redis.scan(cursor, 'MATCH', searchPattern, 'COUNT', '100');
      cursor = result[0];
      allKeys.push(...result[1]);
    } while (cursor !== '0');
    
    console.log(`📦 Found ${allKeys.length} total keys for ${project}:${table}`);
    
    if (allKeys.length === 0) {
      console.log(`❌ No cached keys found for pattern: ${searchPattern}`);
      return res.status(404).json({
        message: "No cached keys found",
        pattern: searchPattern,
        keysFound: 0,
        keys: [],
        currentPage: parseInt(page),
        totalPages: 0,
        hasMore: false
      });
    }

    // Calculate pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const startIndex = (pageNum - 1) * limitNum;
    const endIndex = startIndex + limitNum;
    const totalPages = Math.ceil(allKeys.length / limitNum);
    const hasMore = pageNum < totalPages;

    // Get paginated keys
    const paginatedKeys = allKeys.slice(startIndex, endIndex);
    
    console.log(`📊 Pagination: page ${pageNum}/${totalPages}, showing ${paginatedKeys.length} keys`);
    console.log(`📋 Paginated keys:`, paginatedKeys);
    
    return res.status(200).json({
      message: "Paginated cache keys retrieved",
      keysFound: allKeys.length,
      keys: paginatedKeys,
      currentPage: pageNum,
      totalPages: totalPages,
      hasMore: hasMore
    });

  } catch (err) {
    console.error("🔥 Get paginated cache keys failed:", err);
    return res.status(500).json({
      message: "Failed to retrieve paginated cache keys",
      error: err.message
    });
  }
};

/**
 * Clear cached data from Redis
 */
export const clearCacheHandler = async (req, res) => {
  try {
    const { project, table } = req.query;
    const { pattern } = req.query;

    let searchPattern;
    if (pattern) {
      searchPattern = `${project}:${table}:${pattern}`;
    } else {
      searchPattern = `${project}:${table}:*`;
    }

         // Use SCAN for Valkey compatibility
     const keys = [];
     let cursor = '0';
     
     do {
       const result = await redis.scan(cursor, 'MATCH', searchPattern, 'COUNT', '100');
       cursor = result[0];
       keys.push(...result[1]);
     } while (cursor !== '0');
     
     if (keys.length === 0) {
      return res.status(404).json({
        message: "No cached keys found to clear",
        pattern: searchPattern
      });
    }

    // Delete keys individually to avoid cross-slot errors in Redis Cluster
    let deletedCount = 0;
    for (const key of keys) {
      try {
        const result = await redis.del(key);
        deletedCount += result;
        console.log(`🗑️ Deleted key: ${key}`);
      } catch (err) {
        console.error(`❌ Failed to delete key ${key}:`, err);
        // Continue with other keys even if one fails
      }
    }

    return res.status(200).json({
      message: "Cache cleared successfully",
      keysDeleted: deletedCount,
      pattern: searchPattern
    });

  } catch (err) {
    console.error("🔥 Clear cache failed:", err);
    return res.status(500).json({
      message: "Failed to clear cache",
      error: err.message
    });
  }
};

/**
 * Get cache statistics
 */
export const getCacheStatsHandler = async (req, res) => {
  try {
    const { project, table } = req.query;
    const searchPattern = `${project}:${table}:*`;
    // Use SCAN for Valkey compatibility
    const keys = [];
    let cursor = '0';
    
    do {
      const result = await redis.scan(cursor, 'MATCH', searchPattern, 'COUNT', '100');
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== '0');
    
    const stats = {
      totalKeys: keys.length,
      pattern: searchPattern,
      project,
      table,
      timestamp: new Date().toISOString()
    };

    // Get TTL for first few keys as sample
    if (keys.length > 0) {
      const sampleKeys = keys.slice(0, 5);
      const ttls = await Promise.all(sampleKeys.map(key => redis.ttl(key)));
      stats.sampleTTLs = sampleKeys.map((key, index) => ({
        key,
        ttl: ttls[index]
      }));
    }

    return res.status(200).json({
      message: "Cache statistics retrieved",
      stats
    });

  } catch (err) {
    console.error("🔥 Get cache stats failed:", err);
    return res.status(500).json({
      message: "Failed to get cache statistics",
      error: err.message
    });
  }
};

/**
 * Clear unwanted order data from cache
 */
export const clearUnwantedOrderDataHandler = async (req, res) => {
  try {
    const { project, table } = req.query;
    
    if (!project || !table) {
      return res.status(400).json({
        error: "Missing parameters",
        message: "Both project and table are required"
      });
    }
    
    console.log(`🧹 Manual cleanup requested for ${project}:${table}`);
    
    const deletedCount = await clearUnwantedOrderData(project, table);
    
    return res.status(200).json({
      message: "Cleanup completed",
      project,
      table,
      deletedCount,
      timestamp: new Date().toISOString()
    });
    
  } catch (err) {
    console.error("🔥 Clear unwanted data failed:", err);
    return res.status(500).json({
      message: "Failed to clear unwanted data",
      error: err.message
    });
  }
};

/**
 * Clean up timestamp-based chunks and convert to sequential numbering
 */
export const cleanupTimestampChunksHandler = async (req, res) => {
  try {
    const { project, table } = req.query;
    
    if (!project || !table) {
      return res.status(400).json({
        error: "Missing parameters",
        message: "Both project and table are required"
      });
    }
    
    console.log(`🧹 Manual timestamp cleanup requested for ${project}:${table}`);
    
    const convertedCount = await cleanupTimestampChunks(project, table);
    
    return res.status(200).json({
      message: "Timestamp cleanup completed",
      project,
      table,
      convertedCount,
      timestamp: new Date().toISOString()
    });
    
  } catch (err) {
    console.error("🔥 Timestamp cleanup failed:", err);
    return res.status(500).json({
      message: "Failed to cleanup timestamp chunks",
      error: err.message
    });
  }
};

/**
 * Health check for Redis connection
 */
export const cacheHealthHandler = async (req, res) => {
  try {
    const ping = await redis.ping();
    const info = await redis.info('server');
    
    return res.status(200).json({
      message: "Cache service is healthy",
      redis: {
        connected: ping === 'PONG',
        info: info.split('\r\n').slice(0, 5) // First 5 lines of info
      },
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error("🔥 Cache health check failed:", err);
    return res.status(503).json({
      message: "Cache service is unhealthy",
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Test connection to Redis/Valkey cache
 */
export const testCacheConnection = async (req, res) => {
  try {
    console.log('🔍 Testing cache connection...');
    
    // Test basic connectivity
    await redis.ping();
    console.log('✅ Redis ping successful');
    
    // Test basic operations
    await redis.set('test-key', 'test-value', 'EX', 60);
    const value = await redis.get('test-key');
    await redis.del('test-key');
    
    if (value === 'test-value') {
      console.log('✅ Redis read/write operations successful');
      res.json({
        status: 'success',
        message: 'Cache connection test passed',
        endpoint: process.env.REDIS_HOST,
        timestamp: new Date().toISOString()
      });
    } else {
      throw new Error('Read/write test failed');
    }
  } catch (error) {
    console.error('❌ Cache connection test failed:', error);
    res.status(500).json({
      status: 'error',
      message: 'Cache connection test failed',
      error: error.message,
      endpoint: process.env.REDIS_HOST,
      timestamp: new Date().toISOString()
    });
  }
};
/**
 * Clean up timestamp-based chunks and convert to sequential numbering
 */
async function cleanupTimestampChunks(project, tableName) {
  try {
    console.log(`🧹 Cleaning up timestamp-based chunks for ${project}:${tableName}`);
    
    const searchPattern = `${project}:${tableName}:chunk:*`;
    const keys = [];
    let cursor = '0';
    
    do {
      const result = await redis.scan(cursor, 'MATCH', searchPattern, 'COUNT', '100');
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== '0');
    
    console.log(`🔍 Found ${keys.length} chunk keys to check`);
    
    // Separate timestamp-based and sequential chunks
    const timestampChunks = [];
    const sequentialChunks = [];
    
    for (const key of keys) {
      const match = key.match(/chunk:(\d+)$/);
      if (match) {
        const chunkId = match[1];
        // If chunkId is 10+ digits, it's likely a timestamp
        if (chunkId.length >= 10) {
          timestampChunks.push(key);
        } else {
          sequentialChunks.push(key);
        }
      }
    }
    
    console.log(`📊 Found ${timestampChunks.length} timestamp chunks and ${sequentialChunks.length} sequential chunks`);
    
    if (timestampChunks.length === 0) {
      console.log(`✅ No timestamp chunks to clean up`);
      return 0;
    }
    
    // Find the highest sequential chunk number
    let maxSequential = -1;
    for (const key of sequentialChunks) {
      const match = key.match(/chunk:(\d+)$/);
      if (match) {
        const chunkNum = parseInt(match[1]);
        if (chunkNum > maxSequential) {
          maxSequential = chunkNum;
        }
      }
    }
    
    let nextChunkId = maxSequential + 1;
    let convertedCount = 0;
    
    // Convert timestamp chunks to sequential
    for (const timestampKey of timestampChunks) {
      try {
        const value = await redis.get(timestampKey);
        if (value) {
          const data = JSON.parse(value);
          
          // Create new sequential key
          const newKey = `${project}:${tableName}:chunk:${nextChunkId}`;
          
          // Copy data to new key
          await redis.set(newKey, value, 'EX', 3600); // Default TTL
          
          // Delete old timestamp key
          await redis.del(timestampKey);
          
          console.log(`🔄 Converted ${timestampKey} → ${newKey}`);
          nextChunkId++;
          convertedCount++;
        }
      } catch (err) {
        console.error(`❌ Error converting ${timestampKey}:`, err);
      }
    }
    
    console.log(`✅ Converted ${convertedCount} timestamp chunks to sequential`);
    return convertedCount;
  } catch (err) {
    console.error('❌ Error cleaning up timestamp chunks:', err);
    return 0;
  }
}

/**
 * Clear unwanted order data from brmh-cache table
 */
async function clearUnwantedOrderData(project, tableName) {
  try {
    console.log(`🧹 Cleaning up unwanted order data from ${project}:${tableName}`);
    
    const searchPattern = `${project}:${tableName}:chunk:*`;
    const keys = [];
    let cursor = '0';
    
    do {
      const result = await redis.scan(cursor, 'MATCH', searchPattern, 'COUNT', '100');
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== '0');
    
    console.log(`🔍 Found ${keys.length} chunk keys to check`);
    
    let deletedCount = 0;
    for (const key of keys) {
      try {
        const value = await redis.get(key);
        if (value) {
          const data = JSON.parse(value);
          
          // Check if this contains order data (not cache config data)
          const isOrderData = data.length > 0 && data[0] && (
            data[0].line_items ||
            data[0].billing_address ||
            data[0].shipping_address ||
            data[0].customer ||
            data[0].total_price ||
            data[0].order_number
          );
          
          if (isOrderData) {
            console.log(`🗑️ Deleting order data from key: ${key}`);
            await redis.del(key);
            deletedCount++;
          }
        }
      } catch (err) {
        console.error(`❌ Error checking key ${key}:`, err);
      }
    }
    
    console.log(`✅ Cleaned up ${deletedCount} unwanted order data chunks`);
    return deletedCount;
  } catch (err) {
    console.error('❌ Error cleaning up unwanted order data:', err);
    return 0;
  }
}

/**
 * Handler to update cache from Lambda function streaming DynamoDB changes
 * Request body: {
 *   type: "INSERT" | "MODIFY" | "REMOVE",
 *   newItem: DynamoDB item (unmarshalled),
 *   oldItem: DynamoDB item (unmarshalled) - for MODIFY/REMOVE
 * }
 */
export const updateCacheFromLambdaHandler = async (req, res) => {
  const start = Date.now();

  try {
    const { type, newItem, oldItem } = req.body;

    console.log('🔄 Cache update from Lambda:', { type, hasNewItem: !!newItem, hasOldItem: !!oldItem });

    // Validation
    if (!type || !['INSERT', 'MODIFY', 'REMOVE'].includes(type)) {
      console.error("Invalid type in request:", type);
      return res.status(400).json({ 
        error: "Invalid type",
        message: "Type must be INSERT, MODIFY, or REMOVE"
      });
    }

    if (!newItem && type === 'INSERT') {
      console.error("Missing newItem for INSERT operation");
      return res.status(400).json({ 
        error: "Missing newItem",
        message: "newItem is required for INSERT operations"
      });
    }

    if (!oldItem && (type === 'MODIFY' || type === 'REMOVE')) {
      console.error("Missing oldItem for MODIFY/REMOVE operation");
      return res.status(400).json({ 
        error: "Missing oldItem",
        message: "oldItem is required for MODIFY/REMOVE operations"
      });
    }

    // Get the table name from the request (already extracted by the endpoint)
    let tableName = req.body.extractedTableName;
    
    // If not provided in request, fall back to extracting from items
    if (!tableName) {
      console.log("No extracted table name in request, falling back to item extraction");
      tableName = newItem?.tableName || oldItem?.tableName;
      
      // If tableName is in DynamoDB format, extract the string value
      if (tableName && typeof tableName === 'object' && tableName.S) {
        tableName = tableName.S;
      }
      
      // If still no tableName, try to extract from the item structure
      if (!tableName) {
        const item = newItem || oldItem;
        if (item && item.tableName) {
          if (typeof item.tableName === 'object' && item.tableName.S) {
            tableName = item.tableName.S;
          } else if (typeof item.tableName === 'string') {
            tableName = item.tableName;
          }
        }
      }
      
      // If still no tableName, use a default
      if (!tableName) {
        console.log("No table name found in items, using default");
        tableName = 'brmh-cache'; // Default fallback
      }
    }

    console.log(`📋 Processing ${type} operation for table: ${tableName}`);

    // Prevent caching order data in brmh-cache table
    if (tableName === 'brmh-cache') {
      // Check if this is actually cache configuration data, not order data
      const item = newItem || oldItem;
      const isCacheConfig = item && (
        item.id || 
        item.methodId || 
        item.accountId || 
        item.project ||
        item.status === 'active' ||
        item.status === 'inactive'
      );
      
      if (!isCacheConfig) {
        console.log(`🚫 Skipping cache update for table ${tableName} - not cache configuration data`);
        return res.status(200).json({
          message: "Skipped - not cache configuration data",
          tableName,
          type,
          reason: "Only cache configuration data should be cached in brmh-cache table"
        });
      }
      
      // Clean up any existing unwanted order data
      const project = item?.project?.S || item?.project || 'default';
      await clearUnwantedOrderData(project, tableName);
      
      // Also clean up timestamp-based chunks
      await cleanupTimestampChunks(project, tableName);
    }

    // Find active cache configurations for this table
    const cacheConfigs = await findActiveCacheConfigs(tableName);
    
    if (cacheConfigs.length === 0) {
      console.log(`ℹ️ No active cache configurations found for table: ${tableName}`);
      console.log(`💡 Available tables in cache configs:`, cacheConfigs.map(c => c.tableName));
      return res.status(200).json({
        message: "No active cache configurations found",
        tableName,
        type,
        cacheConfigsFound: 0
      });
    }

    console.log(`📊 Found ${cacheConfigs.length} active cache configurations for table: ${tableName}`);

    // Process each cache configuration
    const results = [];
    for (const config of cacheConfigs) {
      try {
        const result = await processCacheUpdate(config, type, newItem, oldItem);
        results.push(result);
      } catch (err) {
        console.error(`❌ Failed to process cache config ${config.id}:`, err);
        results.push({
          configId: config.id,
          success: false,
          error: err.message
        });
      }
    }

    const successfulUpdates = results.filter(r => r.success).length;
    const failedUpdates = results.filter(r => !r.success).length;
    const duration = Date.now() - start;

    console.log(`✅ Cache update complete: ${successfulUpdates} successful, ${failedUpdates} failed`);
    console.log(`⏱️ Update duration (ms):`, duration);

    return res.status(200).json({
      message: "Cache update processed",
      tableName,
      type,
      totalConfigs: cacheConfigs.length,
      successfulUpdates,
      failedUpdates,
      results,
      durationMs: duration
    });

  } catch (err) {
    const duration = Date.now() - start;
    console.error("🔥 Cache update handler failed:", err);
    console.log("⏱️ Failed after (ms):", duration);

    return res.status(500).json({
      message: "Cache update failed",
      error: err.message,
      durationMs: duration,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Find active cache configurations for a given table
 */
async function findActiveCacheConfigs(tableName) {
  try {
    console.log(`🔍 Searching for active cache configs for table: ${tableName}`);
    
    // First, let's scan all cache configurations to see what we have
    const scanCommand = new ScanCommand({
      TableName: 'brmh-cache'
    });

    const scanResponse = await ddb.send(scanCommand);
    const allConfigs = scanResponse.Items.map(unmarshall);
    
    console.log(`📋 Found ${allConfigs.length} total cache configurations:`);
    allConfigs.forEach((config, index) => {
      console.log(`  Config ${index + 1}:`, {
        id: config.id,
        tableName: config.tableName,
        project: config.project,
        status: config.status,
        methodId: config.methodId,
        accountId: config.accountId
      });
    });

    // Filter for active configs matching the table name
    const activeConfigs = allConfigs.filter(config => 
      config.status === 'active' && 
      config.tableName === tableName
    );
    
    console.log(`✅ Found ${activeConfigs.length} active cache configurations for table: ${tableName}`);
    return activeConfigs;
  } catch (err) {
    console.error('❌ Error finding cache configs:', err);
    throw err;
  }
}

/**
 * Process cache update for a specific configuration
 */
async function processCacheUpdate(config, type, newItem, oldItem) {
  const { id: configId, itemsPerKey, timeToLive, tableName, project } = config;
  const projectName = project || 'default'; // Use project from config or default
  
  console.log(`🔄 Processing cache update for config ${configId}:`, { type, itemsPerKey, timeToLive, tableName, project: projectName });

  try {
    switch (type) {
      case 'INSERT':
        return await handleInsert(projectName, tableName, newItem, itemsPerKey, timeToLive);
      
      case 'MODIFY':
        return await handleModify(projectName, tableName, newItem, oldItem, itemsPerKey, timeToLive);
      
      case 'REMOVE':
        return await handleRemove(projectName, tableName, oldItem, itemsPerKey);
      
      default:
        throw new Error(`Unknown operation type: ${type}`);
    }
  } catch (err) {
    console.error(`❌ Error processing ${type} operation:`, err);
    throw err;
  }
}

/**
 * Handle INSERT operations
 */
async function handleInsert(project, tableName, newItem, itemsPerKey, ttl) {
  console.log(`➕ Handling INSERT for ${tableName}`);
  console.log(`📦 New item:`, newItem);
  console.log(`⚙️ Config: project=${project}, itemsPerKey=${itemsPerKey}, ttl=${ttl}`);
  
  // Unmarshall DynamoDB item to plain JSON
  const unmarshalledItem = unmarshall(newItem);
  console.log(`📦 Unmarshalled item:`, unmarshalledItem);
  
  // Helper function to extract item ID from DynamoDB format
  const extractItemId = (item) => {
    if (item.id && typeof item.id === 'object' && item.id.S) return item.id.S;
    if (item.id && typeof item.id === 'string') return item.id;
    if (item.pk && typeof item.pk === 'object' && item.pk.S) return item.pk.S;
    if (item.pk && typeof item.pk === 'string') return item.pk;
    if (item.PK && typeof item.PK === 'object' && item.PK.S) return item.PK.S;
    if (item.PK && typeof item.PK === 'string') return item.PK;
    return Date.now().toString(); // Fallback
  };
  
  // Generate cache key based on itemsPerKey
  let cacheKey;
  if (itemsPerKey === 1) {
    // Single item per key
    const itemId = extractItemId(newItem);
    cacheKey = `${project}:${tableName}:${itemId}`;
    const value = JSON.stringify(unmarshalledItem);
    if (ttl && ttl > 0) {
      await redis.set(cacheKey, value, 'EX', ttl);
    } else {
      await redis.set(cacheKey, value); // No expiration
    }
    console.log(`✅ Cached single item: ${cacheKey}${ttl && ttl > 0 ? ` with TTL ${ttl}s` : ' with no expiration'}`);
  } else {
    // Multiple items per key - find the best chunk to add to or create new one
    const searchPattern = `${project}:${tableName}:chunk:*`;
    // Use SCAN for Valkey compatibility
    const existingChunks = [];
    let cursor = '0';
    
    do {
      const result = await redis.scan(cursor, 'MATCH', searchPattern, 'COUNT', '100');
      cursor = result[0];
      existingChunks.push(...result[1]);
    } while (cursor !== '0');
    
    console.log(`🔍 Found ${existingChunks.length} existing chunks`);
    
    let bestChunkKey = null;
    let bestChunkSize = 0;
    
    // Find the chunk with the most space (closest to itemsPerKey but not full)
    for (const chunkKey of existingChunks) {
      const chunkValue = await redis.get(chunkKey);
      if (chunkValue) {
        const chunkItems = JSON.parse(chunkValue);
        const chunkSize = chunkItems.length;
        
        console.log(`📦 Chunk ${chunkKey}: ${chunkSize}/${itemsPerKey} items`);
        
        // Prefer chunks that have space and are closest to being full
        if (chunkSize < itemsPerKey && chunkSize > bestChunkSize) {
          bestChunkKey = chunkKey;
          bestChunkSize = chunkSize;
        }
      }
    }
    
    if (bestChunkKey && bestChunkSize < itemsPerKey) {
      // Add to existing chunk that has space
      const existingValue = await redis.get(bestChunkKey);
      const existingItems = JSON.parse(existingValue);
      existingItems.push(unmarshalledItem);
      if (ttl && ttl > 0) {
        await redis.set(bestChunkKey, JSON.stringify(existingItems), 'EX', ttl);
      } else {
        await redis.set(bestChunkKey, JSON.stringify(existingItems)); // No expiration
      }
      console.log(`✅ Added to existing chunk: ${bestChunkKey} (${existingItems.length}/${itemsPerKey} items)`);
      cacheKey = bestChunkKey;
    } else {
      // Create new chunk with sequential numbering
      let newChunkId = 0;
      
      // Find the highest existing chunk number
      for (const chunkKey of existingChunks) {
        const match = chunkKey.match(/chunk:(\d+)$/);
        if (match) {
          const chunkNum = parseInt(match[1]);
          if (chunkNum >= newChunkId) {
            newChunkId = chunkNum + 1;
          }
        }
      }
      
      const newChunkKey = `${project}:${tableName}:chunk:${newChunkId}`;
      if (ttl && ttl > 0) {
        await redis.set(newChunkKey, JSON.stringify([unmarshalledItem]), 'EX', ttl);
      } else {
        await redis.set(newChunkKey, JSON.stringify([unmarshalledItem])); // No expiration
      }
      console.log(`✅ Created new chunk: ${newChunkKey} (1/${itemsPerKey} items)`);
      cacheKey = newChunkKey;
    }
  }

  return {
    configId: project,
    success: true,
    operation: 'INSERT',
    cacheKey: cacheKey || 'chunk-based'
  };
}

/**
 * Handle MODIFY operations
 */
async function handleModify(project, tableName, newItem, oldItem, itemsPerKey, ttl) {
  console.log(`✏️ Handling MODIFY for ${tableName}`);
  
  // Unmarshall DynamoDB items to plain JSON
  const unmarshalledNewItem = unmarshall(newItem);
  const unmarshalledOldItem = unmarshall(oldItem);
  console.log(`📦 Unmarshalled new item:`, unmarshalledNewItem);
  console.log(`📦 Unmarshalled old item:`, unmarshalledOldItem);
  
  // Helper function to extract item ID from DynamoDB format
  const extractItemId = (item) => {
    if (item.id && typeof item.id === 'object' && item.id.S) return item.id.S;
    if (item.id && typeof item.id === 'string') return item.id;
    if (item.pk && typeof item.pk === 'object' && item.pk.S) return item.pk.S;
    if (item.pk && typeof item.pk === 'string') return item.pk;
    if (item.PK && typeof item.PK === 'object' && item.PK.S) return item.PK.S;
    if (item.PK && typeof item.PK === 'string') return item.PK;
    return null;
  };
  
  if (itemsPerKey === 1) {
    // Update single item
    const itemId = extractItemId(newItem) || extractItemId(oldItem);
    if (!itemId) {
      console.log(`❌ No valid item ID found for modification`);
      return {
        configId: project,
        success: false,
        operation: 'MODIFY',
        error: 'No valid item ID found'
      };
    }
    
    const cacheKey = `${project}:${tableName}:${itemId}`;
    const value = JSON.stringify(unmarshalledNewItem);
    if (ttl && ttl > 0) {
      await redis.set(cacheKey, value, 'EX', ttl);
    } else {
      await redis.set(cacheKey, value); // No expiration
    }
    console.log(`✅ Updated cached item: ${cacheKey}`);
    
    return {
      configId: project,
      success: true,
      operation: 'MODIFY',
      cacheKey
    };
  } else {
    // For chunked data, we need to find and update the chunk containing this item
    const searchPattern = `${project}:${tableName}:chunk:*`;
    console.log(`🔍 Searching for chunks with pattern: ${searchPattern}`);
    
    // Use SCAN for Valkey compatibility
    const keys = [];
    let cursor = '0';
    
    do {
      const result = await redis.scan(cursor, 'MATCH', searchPattern, 'COUNT', '100');
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== '0');
    
    console.log(`📦 Found ${keys.length} chunks to search through`);
    
    const targetItemId = extractItemId(newItem) || extractItemId(oldItem);
    if (!targetItemId) {
      console.log(`❌ No valid item ID found for modification`);
      return {
        configId: project,
        success: false,
        operation: 'MODIFY',
        error: 'No valid item ID found'
      };
    }
    
    for (const key of keys) {
      const value = await redis.get(key);
      if (value) {
        const items = JSON.parse(value);
        console.log(`🔍 Searching in chunk ${key} with ${items.length} items`);
        
        // Helper function to compare items considering DynamoDB format
        const findItemIndex = (items, targetId) => {
          return items.findIndex(item => {
            const currentItemId = extractItemId(item);
            return currentItemId === targetId;
          });
        };
        
        const itemIndex = findItemIndex(items, targetItemId);
        
        if (itemIndex !== -1) {
          console.log(`✅ Found item at index ${itemIndex} in chunk ${key}`);
          items[itemIndex] = unmarshalledNewItem;
          if (ttl && ttl > 0) {
            await redis.set(key, JSON.stringify(items), 'EX', ttl);
          } else {
            await redis.set(key, JSON.stringify(items)); // No expiration
          }
          console.log(`✅ Updated item in chunk: ${key}`);
          
          return {
            configId: project,
            success: true,
            operation: 'MODIFY',
            cacheKey: key
          };
        }
      }
    }
    
    // If not found in existing chunks, treat as insert
    console.log(`⚠️ Item not found in existing chunks, treating as INSERT`);
    return await handleInsert(project, tableName, newItem, itemsPerKey, ttl);
  }
}

/**
 * Handle REMOVE operations
 */
async function handleRemove(project, tableName, oldItem, itemsPerKey) {
  console.log(`🗑️ Handling REMOVE for ${tableName}`);
  console.log(`📦 Old item to remove:`, oldItem);
  
  // Unmarshall DynamoDB item to plain JSON
  const unmarshalledOldItem = unmarshall(oldItem);
  console.log(`📦 Unmarshalled old item:`, unmarshalledOldItem);
  
  // Helper function to extract item ID from DynamoDB format
  const extractItemId = (item) => {
    if (item.id && typeof item.id === 'object' && item.id.S) return item.id.S;
    if (item.id && typeof item.id === 'string') return item.id;
    if (item.pk && typeof item.pk === 'object' && item.pk.S) return item.pk.S;
    if (item.pk && typeof item.pk === 'string') return item.pk;
    if (item.PK && typeof item.PK === 'object' && item.PK.S) return item.PK.S;
    if (item.PK && typeof item.PK === 'string') return item.PK;
    return null;
  };
  
  const itemId = extractItemId(oldItem);
  console.log(`🔍 Looking for item with ID: ${itemId}`);
  
  if (itemsPerKey === 1) {
    // Remove single item
    if (!itemId) {
      console.log(`❌ No valid item ID found for removal`);
      return {
        configId: project,
        success: false,
        operation: 'REMOVE',
        error: 'No valid item ID found'
      };
    }
    
    const cacheKey = `${project}:${tableName}:${itemId}`;
    await redis.del(cacheKey);
    console.log(`✅ Removed cached item: ${cacheKey}`);
    
    return {
      configId: project,
      success: true,
      operation: 'REMOVE',
      cacheKey
    };
  } else {
    // For chunked data, find and remove from chunk
    const searchPattern = `${project}:${tableName}:chunk:*`;
    console.log(`🔍 Searching for chunks with pattern: ${searchPattern}`);
    
    // Use SCAN for Valkey compatibility
    const keys = [];
    let cursor = '0';
    
    do {
      const result = await redis.scan(cursor, 'MATCH', searchPattern, 'COUNT', '100');
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== '0');
    
    console.log(`📦 Found ${keys.length} chunks to search through`);
    
    for (const key of keys) {
      const value = await redis.get(key);
      if (value) {
        const items = JSON.parse(value);
        console.log(`🔍 Searching in chunk ${key} with ${items.length} items`);
        
        // Helper function to compare items considering DynamoDB format
        const findItemIndex = (items, targetId) => {
          return items.findIndex(item => {
            const currentItemId = extractItemId(item);
            console.log(`🔍 Comparing item ID: ${currentItemId} with target: ${targetId}`);
            return currentItemId === targetId;
          });
        };
        
        const itemIndex = findItemIndex(items, itemId);
        
        if (itemIndex !== -1) {
          console.log(`✅ Found item at index ${itemIndex} in chunk ${key}`);
          items.splice(itemIndex, 1);
          
          if (items.length === 0) {
            // Remove empty chunk
            await redis.del(key);
            console.log(`✅ Removed empty chunk: ${key}`);
          } else {
            // Update chunk with remaining items
            await redis.set(key, JSON.stringify(items));
            console.log(`✅ Updated chunk after removal: ${key} (${items.length} items remaining)`);
          }
          
          return {
            configId: project,
            success: true,
            operation: 'REMOVE',
            cacheKey: key
          };
        }
      }
    }
    
    console.log(`⚠️ Item with ID ${itemId} not found in any cache chunks`);
    return {
      configId: project,
      success: false,
      operation: 'REMOVE',
      cacheKey: 'not-found',
      error: `Item with ID ${itemId} not found in cache`
    };
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🔄 Shutting down cache service...');
  await redis.quit();
  console.log('✅ Cache service shutdown complete');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🔄 Shutting down cache service...');
  await redis.quit();
  console.log('✅ Cache service shutdown complete');
  process.exit(0);
});

