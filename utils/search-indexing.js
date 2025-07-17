import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { algoliasearch } from 'algoliasearch';
import { v4 as uuidv4 } from 'uuid';

console.log('Search indexing service: importing modules and initializing clients');

// Initialize DynamoDB clients
const ddb = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddb);

// Helper to get nested value by dot notation
const getNested = (obj, path) =>
  path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);

// Helper to unwrap DynamoDB AttributeValue format to plain JSON
function unwrap(val) {
  if (val == null) return val;
  if (val.S !== undefined) return val.S;
  if (val.N !== undefined) return Number(val.N);
  if (val.BOOL !== undefined) return val.BOOL;
  if (val.NULL !== undefined) return null;
  if (val.L !== undefined) return val.L.map(unwrap);
  if (val.M !== undefined) {
    const obj = {};
    for (const k in val.M) obj[k] = unwrap(val.M[k]);
    return obj;
  }
  return val;
}

/**
 * Express handler for indexing DynamoDB table data to Algolia
 * Request body: {
 *   project: string,
 *   table: string,
 *   customFields: string[] (optional)
 * }
 */
export const indexTableHandler = async (req, res) => {
  const start = Date.now();

  try {
    console.log('Index handler invoked with request body:', req.body);
    console.log('Request body type:', typeof req.body);
    console.log('Content-Type:', req.headers['content-type']);
    
    // Handle different content types
    let requestBody = req.body;
    
    if (typeof req.body === 'string') {
      try {
        requestBody = JSON.parse(req.body);
        console.log('Parsed JSON from string:', requestBody);
      } catch (parseError) {
        console.error('Failed to parse JSON:', parseError);
        return res.status(400).json({
          error: "Invalid JSON format",
          message: "Request body must be valid JSON"
        });
      }
    }
    
    const { project, table, customFields = [] } = requestBody;

    // Validation
    if (!project || !table) {
      console.error("Missing 'project' or 'table' in request");
      return res.status(400).json({ 
        error: "Missing 'project' or 'table'",
        message: "Both project and table are required parameters"
      });
    }

    const ALGOLIA_APP_ID = process.env.ALGOLIA_APP_ID;
    const ALGOLIA_API_KEY = process.env.ALGOLIA_API_KEY;
    const ALGOLIA_INDEX_PREFIX = process.env.ALGOLIA_INDEX_PREFIX || '';

    if (!ALGOLIA_APP_ID || !ALGOLIA_API_KEY) {
      console.error("Missing Algolia credentials");
      return res.status(500).json({ 
        error: "Missing Algolia credentials",
        message: "ALGOLIA_APP_ID and ALGOLIA_API_KEY environment variables are required"
      });
    }

    console.log(`📤 Starting indexing operation for table: ${table}, project: ${project}`);
    
    // Scan DynamoDB table
    let records = [];
    let lastEvaluatedKey = null;
    let scanCount = 0;

    do {
      scanCount++;
      console.log(`Scanning DynamoDB page ${scanCount}: table=${table}`);
      
      const command = new ScanCommand({ 
        TableName: table, 
        ExclusiveStartKey: lastEvaluatedKey
      });
      
      const response = await ddb.send(command);
      const scanned = response.Items.map(unmarshall);
      records = records.concat(scanned);
      lastEvaluatedKey = response.LastEvaluatedKey;
      
      console.log(`Scanned ${scanned.length} items, total so far: ${records.length}`);
    } while (lastEvaluatedKey);

    console.log(`✅ DynamoDB scan complete. Total records: ${records.length}`);

    // Prepare records for Algolia
    const timestamp = Date.now();
    const indexName = `${ALGOLIA_INDEX_PREFIX}${project}_${table}_${timestamp}`;
    
    const enrichedRecords = records.map(item => {
      // Unwrap the whole item first
      const unwrapped = unwrap(item);

      const base = Array.isArray(customFields) && customFields.length > 0
        ? customFields.reduce((acc, key) => {
            const value = getNested(unwrapped, key);
            if (value !== undefined) acc[key.replace(/^Item\./, '')] = value;
            return acc;
          }, {})
        : unwrapped;

      return {
        ...base,
        _project: project,
        _table: table,
        _timestamp: timestamp,
        objectID: base.id || base.objectID || uuidv4()
      };
    });

    console.log(`📝 Preparing ${enrichedRecords.length} records for Algolia indexing`);

    // Index to Algolia
    const client = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_API_KEY);

    try {
      await client.saveObjects({
        indexName,
        objects: enrichedRecords
      });
      console.log(`✅ Algolia indexing successful for index: ${indexName}`);
    } catch (err) {
      console.error('❌ Algolia indexing failed:', err);
      return res.status(500).json({
        message: "Algolia indexing failed",
        error: err.message,
        durationMs: Date.now() - start
      });
    }

    const duration = Date.now() - start;

    console.log("✅ Indexing complete");
    console.log("📊 Records indexed:", enrichedRecords.length);
    console.log("⏱️ Indexing duration (ms):", duration);

    return res.status(200).json({
      message: "Indexing complete",
      project,
      table,
      indexName,
      recordCount: enrichedRecords.length,
      durationMs: duration,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    const duration = Date.now() - start;
    console.error("🔥 Index handler failed:", err);
    console.log("⏱️ Failed after (ms):", duration);

    return res.status(500).json({
      message: "Indexing operation failed",
      error: err.message,
      durationMs: duration,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Express handler for searching indexed data in Algolia
 * Request body: {
 *   project: string,
 *   table: string,
 *   query: string,
 *   filters?: string,
 *   hitsPerPage?: number,
 *   page?: number
 * }
 */
export const searchIndexHandler = async (req, res) => {
  try {
    const { project, table, query, filters, hitsPerPage = 20, page = 0 } = req.body;

    console.log('Search handler invoked with request:', JSON.stringify(req.body));

    // Validation
    if (!project || !table || !query) {
      console.error("Missing required parameters");
      return res.status(400).json({ 
        error: "Missing required parameters",
        message: "project, table, and query are required parameters"
      });
    }

    const ALGOLIA_APP_ID = process.env.ALGOLIA_APP_ID;
    const ALGOLIA_API_KEY = process.env.ALGOLIA_API_KEY;
    const ALGOLIA_INDEX_PREFIX = process.env.ALGOLIA_INDEX_PREFIX || '';

    if (!ALGOLIA_APP_ID || !ALGOLIA_API_KEY) {
      console.error("Missing Algolia credentials");
      return res.status(500).json({ 
        error: "Missing Algolia credentials",
        message: "ALGOLIA_APP_ID and ALGOLIA_API_KEY environment variables are required"
      });
    }

    const client = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_API_KEY);
    
    // Search across all indices for this project/table
    const searchPattern = `${ALGOLIA_INDEX_PREFIX}${project}_${table}_*`;
    
    try {
      // List indices to find matching ones
      const { items: indices } = await client.listIndices();
      const matchingIndices = indices.filter(index => 
        index.name.startsWith(`${ALGOLIA_INDEX_PREFIX}${project}_${table}_`)
      );

      if (matchingIndices.length === 0) {
        return res.status(404).json({
          message: "No indices found for the specified project and table",
          project,
          table,
          searchPattern
        });
      }

      // Use the most recent index (highest timestamp)
      const sortedIndices = matchingIndices.sort((a, b) => {
        const aTimestamp = parseInt(a.name.split('_').pop());
        const bTimestamp = parseInt(b.name.split('_').pop());
        return bTimestamp - aTimestamp;
      });

      const indexName = sortedIndices[0].name;
      console.log(`🔍 Searching in index: ${indexName}`);

      const index = client.initIndex(indexName);
      
      const searchParams = {
        query,
        hitsPerPage,
        page,
        ...(filters && { filters })
      };

      const searchResults = await index.search(query, searchParams);

      return res.status(200).json({
        message: "Search completed",
        project,
        table,
        indexName,
        query,
        hits: searchResults.hits,
        nbHits: searchResults.nbHits,
        page: searchResults.page,
        nbPages: searchResults.nbPages,
        hitsPerPage: searchResults.hitsPerPage,
        processingTimeMS: searchResults.processingTimeMS,
        timestamp: new Date().toISOString()
      });

    } catch (err) {
      console.error('❌ Algolia search failed:', err);
      return res.status(500).json({
        message: "Search failed",
        error: err.message
      });
    }

  } catch (err) {
    console.error("🔥 Search handler failed:", err);
    return res.status(500).json({
      message: "Search operation failed",
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Express handler for listing available indices
 * Request body: {
 *   project?: string,
 *   table?: string
 * }
 */
export const listIndicesHandler = async (req, res) => {
  try {
    const { project, table } = req.body;

    console.log('List indices handler invoked with request:', JSON.stringify(req.body));

    const ALGOLIA_APP_ID = process.env.ALGOLIA_APP_ID;
    const ALGOLIA_API_KEY = process.env.ALGOLIA_API_KEY;
    const ALGOLIA_INDEX_PREFIX = process.env.ALGOLIA_INDEX_PREFIX || '';

    if (!ALGOLIA_APP_ID || !ALGOLIA_API_KEY) {
      console.error("Missing Algolia credentials");
      return res.status(500).json({ 
        error: "Missing Algolia credentials",
        message: "ALGOLIA_APP_ID and ALGOLIA_API_KEY environment variables are required"
      });
    }

    const client = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_API_KEY);
    
    try {
      const { items: indices } = await client.listIndices();
      
      let filteredIndices = indices;
      
      if (project && table) {
        // Filter by specific project and table
        filteredIndices = indices.filter(index => 
          index.name.startsWith(`${ALGOLIA_INDEX_PREFIX}${project}_${table}_`)
        );
      } else if (project) {
        // Filter by project only
        filteredIndices = indices.filter(index => 
          index.name.startsWith(`${ALGOLIA_INDEX_PREFIX}${project}_`)
        );
      }

      // Group indices by project and table
      const groupedIndices = {};
      filteredIndices.forEach(index => {
        const parts = index.name.replace(ALGOLIA_INDEX_PREFIX, '').split('_');
        if (parts.length >= 3) {
          const projectName = parts[0];
          const tableName = parts[1];
          const timestamp = parts[2];
          
          if (!groupedIndices[projectName]) {
            groupedIndices[projectName] = {};
          }
          if (!groupedIndices[projectName][tableName]) {
            groupedIndices[projectName][tableName] = [];
          }
          
          groupedIndices[projectName][tableName].push({
            name: index.name,
            entries: index.entries,
            dataSize: index.dataSize,
            lastBuildTimeS: index.lastBuildTimeS,
            timestamp: parseInt(timestamp),
            createdAt: new Date(parseInt(timestamp)).toISOString()
          });
        }
      });

      // Sort by timestamp (newest first) within each table
      Object.keys(groupedIndices).forEach(project => {
        Object.keys(groupedIndices[project]).forEach(table => {
          groupedIndices[project][table].sort((a, b) => b.timestamp - a.timestamp);
        });
      });

      return res.status(200).json({
        message: "Indices retrieved",
        totalIndices: filteredIndices.length,
        groupedIndices,
        timestamp: new Date().toISOString()
      });

    } catch (err) {
      console.error('❌ Failed to list indices:', err);
      return res.status(500).json({
        message: "Failed to list indices",
        error: err.message
      });
    }

  } catch (err) {
    console.error("🔥 List indices handler failed:", err);
    return res.status(500).json({
      message: "List indices operation failed",
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Express handler for deleting indices
 * Request body: {
 *   project: string,
 *   table: string,
 *   keepLatest?: number (number of latest indices to keep)
 * }
 */
export const deleteIndicesHandler = async (req, res) => {
  try {
    const { project, table, keepLatest = 1 } = req.body;

    console.log('Delete indices handler invoked with request:', JSON.stringify(req.body));

    // Validation
    if (!project || !table) {
      console.error("Missing 'project' or 'table' in request");
      return res.status(400).json({ 
        error: "Missing 'project' or 'table'",
        message: "Both project and table are required parameters"
      });
    }

    const ALGOLIA_APP_ID = process.env.ALGOLIA_APP_ID;
    const ALGOLIA_API_KEY = process.env.ALGOLIA_API_KEY;
    const ALGOLIA_INDEX_PREFIX = process.env.ALGOLIA_INDEX_PREFIX || '';

    if (!ALGOLIA_APP_ID || !ALGOLIA_API_KEY) {
      console.error("Missing Algolia credentials");
      return res.status(500).json({ 
        error: "Missing Algolia credentials",
        message: "ALGOLIA_APP_ID and ALGOLIA_API_KEY environment variables are required"
      });
    }

    const client = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_API_KEY);
    
    try {
      // List indices to find matching ones
      const { items: indices } = await client.listIndices();
      const matchingIndices = indices.filter(index => 
        index.name.startsWith(`${ALGOLIA_INDEX_PREFIX}${project}_${table}_`)
      );

      if (matchingIndices.length === 0) {
        return res.status(404).json({
          message: "No indices found for the specified project and table",
          project,
          table
        });
      }

      // Sort by timestamp (newest first)
      const sortedIndices = matchingIndices.sort((a, b) => {
        const aTimestamp = parseInt(a.name.split('_').pop());
        const bTimestamp = parseInt(b.name.split('_').pop());
        return bTimestamp - aTimestamp;
      });

      // Keep the latest indices and delete the rest
      const indicesToDelete = sortedIndices.slice(keepLatest);
      
      if (indicesToDelete.length === 0) {
        return res.status(200).json({
          message: "No indices to delete",
          project,
          table,
          keptIndices: sortedIndices.slice(0, keepLatest).map(i => i.name)
        });
      }

      // Delete indices
      const deletePromises = indicesToDelete.map(index => 
        client.deleteIndex(index.name)
      );
      
      await Promise.all(deletePromises);

      console.log(`✅ Deleted ${indicesToDelete.length} indices`);

      return res.status(200).json({
        message: "Indices deleted successfully",
        project,
        table,
        deletedIndices: indicesToDelete.map(i => i.name),
        keptIndices: sortedIndices.slice(0, keepLatest).map(i => i.name),
        deletedCount: indicesToDelete.length,
        timestamp: new Date().toISOString()
      });

    } catch (err) {
      console.error('❌ Failed to delete indices:', err);
      return res.status(500).json({
        message: "Failed to delete indices",
        error: err.message
      });
    }

  } catch (err) {
    console.error("🔥 Delete indices handler failed:", err);
    return res.status(500).json({
      message: "Delete indices operation failed",
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Health check for Algolia connection
 */
export const searchHealthHandler = async (req, res) => {
  try {
    const ALGOLIA_APP_ID = process.env.ALGOLIA_APP_ID;
    const ALGOLIA_API_KEY = process.env.ALGOLIA_API_KEY;

    if (!ALGOLIA_APP_ID || !ALGOLIA_API_KEY) {
      return res.status(503).json({
        message: "Search service is unhealthy",
        error: "Missing Algolia credentials",
        timestamp: new Date().toISOString()
      });
    }

    const client = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_API_KEY);
    
    // Test connection by listing indices
    const { items: indices } = await client.listIndices();
    
    return res.status(200).json({
      message: "Search service is healthy",
      algolia: {
        appId: ALGOLIA_APP_ID,
        connected: true,
        totalIndices: indices.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error("🔥 Search health check failed:", err);
    return res.status(503).json({
      message: "Search service is unhealthy",
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
};
