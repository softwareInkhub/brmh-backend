import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import Redis from "ioredis";

console.log('Cache service: importing modules and initializing clients');

// Initialize Redis client
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined, // Enable TLS if needed
  password: process.env.REDIS_PASSWORD, // Optional password
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
});

// Initialize DynamoDB clients
const ddb = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddb);

// Redis connection event handlers
redis.on('connect', () => {
  console.log('✅ Redis connected successfully');
});

redis.on('error', (err) => {
  console.error('❌ Redis connection error:', err);
});

redis.on('close', () => {
  console.log('🔌 Redis connection closed');
});

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

    if (ttl < 1) {
      console.error("'ttl' must be >= 1");
      return res.status(400).json({ 
        error: "'ttl' must be >= 1",
        message: "TTL must be a positive integer (seconds)"
      });
    }

    console.log(`📤 Starting bounded buffer cache operation for table: ${table}, project: ${project}`);
    
    const {
      totalScanned,
      successfulWrites,
      failedWrites,
      attemptedKeys,
      cacheKeys
    } = await scanAndCacheWithBoundedBuffer(table, project, recordsPerKey, ttl);
    
    const fillRate = attemptedKeys > 0 ? ((successfulWrites / attemptedKeys) * 100).toFixed(2) : '0.00';
    const duration = Date.now() - start;

    console.log("✅ Successful cache writes:", successfulWrites);
    console.log("❌ Failed cache writes:", failedWrites);
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
 * Scans DynamoDB and caches records in global chunks (across pages) to Redis using a bounded buffer.
 */
async function scanAndCacheWithBoundedBuffer(tableName, project, recordsPerKey, ttl) {
  let ExclusiveStartKey;
  let totalScanned = 0;
  let successfulWrites = 0;
  let failedWrites = 0;
  let attemptedKeys = 0;
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
      } else {
        key = `${project}:${tableName}:chunk:${chunkIndex}`;
        value = JSON.stringify(chunk);
      }
      
      attemptedKeys++;
      cacheKeys.push(key);
      
      try {
        await redis.set(key, value, 'EX', ttl);
        successfulWrites++;
        console.log(`✅ Redis write succeeded for key ${key} (chunk ${chunkIndex})`);
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
    } else {
      key = `${project}:${tableName}:chunk:${chunkIndex}`;
      value = JSON.stringify(buffer);
    }
    
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

  return { totalScanned, successfulWrites, failedWrites, attemptedKeys, cacheKeys };
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
      const keys = await redis.keys(searchPattern);
      
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
      const keys = await redis.keys(searchPattern);
      
      console.log(`📦 Found ${keys.length} total keys for ${project}:${table}`);
      if (keys.length > 0) {
        console.log(`📋 Keys found:`, keys);
        
        // Also get the actual data for the first few keys
        const sampleData = {};
        const sampleKeys = keys.slice(0, 3); // Get first 3 keys as sample
        for (const k of sampleKeys) {
          const value = await redis.get(k);
          if (value) {
            sampleData[k] = JSON.parse(value);
          }
        }
        console.log(`📊 Sample data from first ${sampleKeys.length} keys:`, sampleData);
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

    const keys = await redis.keys(searchPattern);
    
    if (keys.length === 0) {
      return res.status(404).json({
        message: "No cached keys found to clear",
        pattern: searchPattern
      });
    }

    const deletedCount = await redis.del(...keys);

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
    const keys = await redis.keys(searchPattern);
    
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

    // Get the table name from the item (assuming it's in the item structure)
    let tableName = newItem?.tableName || oldItem?.tableName;
    
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
    
    // If still no tableName, use a default based on the item structure
    if (!tableName) {
      // Try to infer table name from the item content or use a default
      console.log("No explicit table name found, using default");
      tableName = 'brmh-cache'; // Default fallback
    }

    console.log(`📋 Processing ${type} operation for table: ${tableName}`);

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
    const value = JSON.stringify(newItem);
    await redis.set(cacheKey, value, 'EX', ttl);
    console.log(`✅ Cached single item: ${cacheKey}`);
  } else {
    // Multiple items per key - need to update existing chunk or create new one
    // This is a simplified approach - you might want more sophisticated chunking
    const chunkKey = `${project}:${tableName}:chunk:${Math.floor(Date.now() / (itemsPerKey * 1000))}`;
    const existingValue = await redis.get(chunkKey);
    
    if (existingValue) {
      // Add to existing chunk
      const existingItems = JSON.parse(existingValue);
      existingItems.push(newItem);
      await redis.set(chunkKey, JSON.stringify(existingItems), 'EX', ttl);
      console.log(`✅ Updated existing chunk: ${chunkKey}`);
    } else {
      // Create new chunk
      await redis.set(chunkKey, JSON.stringify([newItem]), 'EX', ttl);
      console.log(`✅ Created new chunk: ${chunkKey}`);
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
    const value = JSON.stringify(newItem);
    await redis.set(cacheKey, value, 'EX', ttl);
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
    const keys = await redis.keys(searchPattern);
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
          items[itemIndex] = newItem;
          await redis.set(key, JSON.stringify(items), 'EX', ttl);
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
    const keys = await redis.keys(searchPattern);
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
