import express from 'express';
import { OpenAPIBackend } from 'openapi-backend';
import swaggerUi from 'swagger-ui-express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import yaml from 'js-yaml';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors'
import axios from 'axios';
import { handlers as dynamodbHandlers } from './lib/dynamodb-handlers.js';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import { handlers as llmHandlers } from './lib/llm-handlers.js';
import { handlers as unifiedHandlers } from './lib/unified-handlers.js';

// Load environment variables
dotenv.config();

// Log AWS configuration status
console.log('AWS Configuration Check:', {
  hasAccessKeyId: !!process.env.AWS_ACCESS_KEY_ID ? 'Yes' : 'No',
  hasSecretKey: !!process.env.AWS_SECRET_ACCESS_KEY ? 'Yes' : 'No',
  hasRegion: !!process.env.AWS_REGION ? 'Yes' : 'No',
  nodeEnv: process.env.NODE_ENV
});

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
// File storage configuration
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let prismProcess = null;

// Utility to check if a port is in use
async function checkPortInUse(port) {
  const net = await import('net');
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', err => (err.code === 'EADDRINUSE' ? resolve(true) : resolve(false)))
      .once('listening', () => tester.once('close', () => resolve(false)).close())
      .listen(port);
  });
}

// Start Prism mock server
app.post('/api/mock-server/start', async (req, res) => {
  const { port = 4010, specPath = './openapi.yaml' } = req.body;
  const isPortInUse = await checkPortInUse(port);
  if (isPortInUse) {
    return res.status(400).json({ error: `Port ${port} is already in use.` });
  }
  if (prismProcess) {
    return res.status(400).json({ error: 'Mock server already running.' });
  }
  console.log(`[MOCK SERVER] Starting Prism mock server on port ${port} with spec: ${specPath}`);
  prismProcess = exec(`npx prism mock ${specPath} -p ${port}`, (err) => {
    if (err) {
      console.error('Prism error:', err);
      prismProcess = null;
    }
  });
  res.json({ success: true, port });
});

// Stop Prism mock server
app.post('/api/mock-server/stop', (req, res) => {
  if (prismProcess) {
    prismProcess.kill();
    prismProcess = null;
    console.log('[MOCK SERVER] Prism mock server stopped.');
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'No mock server running.' });
  }
});

app.get("/test",(req,res)=>{res.send("hello! world");
})


// Initialize AWS DynamoDB OpenAPI backend
const awsApi = new OpenAPIBackend({
  definition: './swagger/aws-dynamodb.yaml',
  quick: true,
  handlers: {
    validationFail: async (c, req, res) => ({
      statusCode: 400,
      error: c.validation.errors
    }),
    notFound: async (c, req, res) => ({
      statusCode: 404,
      error: 'Not Found'
    }),
    // Table Operations
    listTables: dynamodbHandlers.listTables,
    createTable: dynamodbHandlers.createTable,
    deleteTable: dynamodbHandlers.deleteTable,
    // Item Operations
    getItems: dynamodbHandlers.getItems,
    createItem: dynamodbHandlers.createItem,
    getItem: dynamodbHandlers.getItem,
    updateItem: dynamodbHandlers.updateItem,
    deleteItem: dynamodbHandlers.deleteItem,
    queryItems: dynamodbHandlers.queryItems,
    // New PK-only Operations
    getItemsByPk: dynamodbHandlers.getItemsByPk,
    updateItemsByPk: dynamodbHandlers.updateItemsByPk,
    deleteItemsByPk: dynamodbHandlers.deleteItemsByPk,
    // Loop Operations
    getItemsInLoop: dynamodbHandlers.getItemsInLoop
  }
});


// Initialize Unified OpenAPI backend
const unifiedApi = new OpenAPIBackend({
  definition: './swagger/unified-api.yaml',
  quick: true,
  handlers: {
    validationFail: async (c, req, res) => ({
      statusCode: 400,
      error: c.validation.errors
    }),
    notFound: async (c, req, res) => ({
      statusCode: 404,
      error: 'Not Found'
    }),
    // Schema Operations
    generateSchema: unifiedHandlers.generateSchema,
    validateSchema: unifiedHandlers.validateSchema,
    saveSchema: unifiedHandlers.saveSchema,
    getSchema: unifiedHandlers.getSchema,
    updateSchema: unifiedHandlers.updateSchema,
    deleteSchema: unifiedHandlers.deleteSchema,
    listSchemas: unifiedHandlers.listSchemas,

    // Table Operations
    createSchemasTable: unifiedHandlers.createSchemasTable,
    deleteSchemasTable: unifiedHandlers.deleteSchemasTable,
    insertSchemaData: unifiedHandlers.insertSchemaData,
    listSchemaTableMeta: unifiedHandlers.listSchemaTableMeta,
    getSchemaTableMeta: unifiedHandlers.getSchemaTableMeta,
    checkAndUpdateTableStatus: unifiedHandlers.checkAndUpdateTableStatus,
    getTableItems: unifiedHandlers.getTableItems,
    getSchemaByTableName: unifiedHandlers.getSchemaByTableName,
    checkAllTableStatuses: unifiedHandlers.checkAllTableStatuses,
    createTableByName: unifiedHandlers.createTableByName,
    getTableItemCount: unifiedHandlers.getTableItemCount,

    // API Execution
    executeNamespaceRequest: unifiedHandlers.executeNamespaceRequest,
    executeNamespacePaginatedRequest: unifiedHandlers.executeNamespacePaginatedRequest,

    // Namespace Operations
    getNamespaces: unifiedHandlers.getNamespaces,
    getNamespaceById: unifiedHandlers.getNamespaceById,
    createNamespace: unifiedHandlers.createNamespace,
    updateNamespace: unifiedHandlers.updateNamespace,
    deleteNamespace: unifiedHandlers.deleteNamespace,

    // Namespace Account Operations
    getNamespaceAccounts: unifiedHandlers.getNamespaceAccounts,
    createNamespaceAccount: unifiedHandlers.createNamespaceAccount,
    updateNamespaceAccount: unifiedHandlers.updateNamespaceAccount,
    deleteNamespaceAccount: unifiedHandlers.deleteNamespaceAccount,

    // Namespace Method Operations
    getNamespaceMethods: unifiedHandlers.getNamespaceMethods,
    createNamespaceMethod: unifiedHandlers.createNamespaceMethod,
    updateNamespaceMethod: unifiedHandlers.updateNamespaceMethod,
    deleteNamespaceMethod: unifiedHandlers.deleteNamespaceMethod,
    getNamespaceMethodById: unifiedHandlers.getNamespaceMethodById,
    createTableItem: unifiedHandlers.createTableItem
  }
});

// Initialize all APIs
await Promise.all([
  awsApi.init(),
  unifiedApi.init()
]);



// Serve Swagger UI for all APIs
const awsOpenapiSpec = yaml.load(fs.readFileSync(path.join(__dirname, 'swagger/aws-dynamodb.yaml'), 'utf8'));

// Serve main API docs
app.use('/api-docs', swaggerUi.serve);
app.get('/api-docs', (req, res) => {
  res.send(
    swaggerUi.generateHTML(mainOpenapiSpec, {
      customSiteTitle: "Main API Documentation",
      customfavIcon: "/favicon.ico",
      customCss: '.swagger-ui .topbar { display: none }',
      swaggerUrl: "/api-docs/swagger.json"
    })
  );
});



// Serve AWS API docs
app.use('/aws-api-docs', swaggerUi.serve);
app.get('/aws-api-docs', (req, res) => {
  res.send(
    swaggerUi.generateHTML(awsOpenapiSpec, {
      customSiteTitle: "AWS DynamoDB API Documentation",
      customfavIcon: "/favicon.ico",
      customCss: '.swagger-ui .topbar { display: none }',
      swaggerUrl: "/aws-api-docs/swagger.json"
    })
  );
});

// Serve AWS API docs at the DynamoDB base URL
app.use('/api/dynamodb', swaggerUi.serve);
app.get('/api/dynamodb', (req, res) => {
  res.send(
    swaggerUi.generateHTML(awsOpenapiSpec, {
      customSiteTitle: "AWS DynamoDB API Documentation",
      customfavIcon: "/favicon.ico",
      customCss: '.swagger-ui .topbar { display: none }',
      swaggerUrl: "/api/dynamodb/swagger.json"
    })
  );
});

// Serve DynamoDB OpenAPI specification
app.get('/api/dynamodb/swagger.json', (req, res) => {
  res.json(awsOpenapiSpec);
});
// Webhook handler functions
async function handleIncomingWebhook(req, res) {
  console.log('Received webhook request:', {
    method: req.method,
    path: req.path,
    headers: req.headers,
    body: req.body
  });

  try {
    // Get all registered webhooks to find matching route
    const webhooksResponse = await dynamodbHandlers.getItems({
      request: {
        params: {
          tableName: 'webhooks'
        }
      }
    });

    console.log('Retrieved webhooks:', webhooksResponse.body);

    if (!webhooksResponse.body || !webhooksResponse.body.items) {
      throw new Error('Failed to fetch registered webhooks');
    }

    // Find webhook registration that matches the incoming route
    const matchingWebhook = webhooksResponse.body.items.find(webhook => {
      if (!webhook || !webhook.route) {
        console.log('Invalid webhook configuration:', webhook);
        return false;
      }

      // Get the routes for comparison and normalize them
      const incomingRoute = req.path.trim().toLowerCase();
      // Handle DynamoDB attribute type format and normalize
      const registeredRoute = (webhook.route.S || webhook.route).trim().toLowerCase();

      console.log('Comparing routes:', {
        incoming: incomingRoute,
        registered: registeredRoute,
        matches: incomingRoute === registeredRoute
      });

      // Exact match comparison after normalization
      return incomingRoute === registeredRoute;
    });

    if (!matchingWebhook) {
      console.log('No matching webhook found for route:', req.path);
      return res.status(404).json({
        error: 'No matching webhook route found',
        path: req.path
      });
    }

    console.log('Found matching webhook:', matchingWebhook);

    // Get target table name from the matched webhook
    const targetTable = matchingWebhook.tableName.S || matchingWebhook.tableName;
    if (!targetTable) {
      throw new Error('Target table name not found in webhook registration');
    }

    // Get the webhook payload
    const webhookPayload = req.body;

    // Convert all numbers to strings recursively
    const convertNumbersToStrings = (obj) => {
      if (obj === null || obj === undefined) {
        return obj;
      }

      if (typeof obj === 'number') {
        return String(obj);
      }

      if (Array.isArray(obj)) {
        return obj.map(item => convertNumbersToStrings(item));
      }

      if (typeof obj === 'object') {
        const newObj = {};
        for (const [key, value] of Object.entries(obj)) {
          newObj[key] = convertNumbersToStrings(value);
        }
        return newObj;
      }

      return obj;
    };

    // Convert all numbers in the payload to strings
    const convertedPayload = convertNumbersToStrings(webhookPayload);
    // Create item to save
    const item = {
      id: String(convertedPayload.id || convertedPayload.product_id || convertedPayload.order_id || Date.now()),
      ...convertedPayload
    };

    console.log('Saving item with converted values:', item);

    // Save to the target table
    await dynamodbHandlers.createItem({
      request: {
        params: {
          tableName: targetTable
        },
        requestBody: item
      }
    });

    console.log('Successfully saved webhook data:', {
      table: targetTable,
      itemId: item.id
    });

    // Generate a UUID for the execution log
    const execId = uuidv4();
    
    // Save webhook metadata to executions table
    const timestamp = new Date().toISOString();
    const executionLogItem = {
      'exec-id': execId,
      'child-exec-id': execId, // Same as execId for webhook executions
      data: {
        'execution-id': execId,
        'execution-type': 'webhook',
        'webhook-id': matchingWebhook.id || 'unknown',
        'webhook-route': req.path,
        'target-table': targetTable,
        'item-id': item.id,
        'timestamp': timestamp,
        'status': 'completed',
        'is-last': true,
        'total-items-processed': 1,
        'items-in-current-page': 1,
        'request-url': req.originalUrl,
        'response-status': 200,
        'pagination-type': 'none'
      }
    };

    // Save execution log
    await dynamodbHandlers.createItem({
      request: {
        params: {
          tableName: 'executions'
        },
        requestBody: executionLogItem
      }
    });

    console.log('Successfully saved webhook execution log:', {
      execId,
      webhookId: matchingWebhook.id,
      itemId: item.id
    });

    res.status(200).json({
      message: 'Webhook processed successfully',
      table: targetTable,
      itemId: item.id,
      executionId: execId
    });

  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({
      error: 'Failed to process webhook',
      details: error.message
    });
  }
}

async function listWebhookData(req, res) {
  console.log('Listing webhook data');
  try {
    const { tableName } = req.params;
    const params = {
      TableName: 'webhooks',
      FilterExpression: '#tableName = :tableName',
      ExpressionAttributeNames: {
        '#tableName': 'tableName'
      },
      ExpressionAttributeValues: {
        ':tableName': { S: tableName }
      }
    };

    const result = await dynamodbHandlers.queryItems({
      request: {
        params: {
          tableName: 'webhooks',
          query: {
            FilterExpression: '#tableName = :tableName',
            ExpressionAttributeNames: {
              '#tableName': 'tableName'
            },
            ExpressionAttributeValues: {
              ':tableName': { S: tableName }
            }
          }
        }
      }
    });
    console.log('Webhook data retrieved successfully');

    res.status(200).json({
      message: 'Webhook data retrieved successfully',
      items: result.body.Items.map(item => ({
        webhookId: item.webhookId.S,
        tableName: item.tableName.S,
        payload: JSON.parse(item.payload.S),
        timestamp: item.timestamp.S,
        status: item.status.S
      }))
    });
  } catch (error) {
    console.error('Error listing webhook data:', error);
    res.status(500).json({
      error: 'Failed to list webhook data',
      details: error.message
    });
  }
}

// Webhook routes - MOVED BEFORE CATCH-ALL ROUTE
app.post('/api/webhooks/:tableName', handleIncomingWebhook);
app.get('/api/webhooks/:tableName', listWebhookData);

// Handle AWS DynamoDB routesss
app.all('/api/dynamodb/*', async (req, res, next) => {
  // Skip if this is a documentation request
  if (req.method === 'GET' && req.path === '/api/dynamodb') {
    return next();
  }

  try {
    console.log('[DynamoDB Request]:', {
      method: req.method,
      path: req.path,
      body: req.body
    });

    // Adjust the path to remove the /api/dynamodb prefix
    const adjustedPath = req.path.replace('/api/dynamodb', '');
    
    const response = await awsApi.handleRequest(
      {
        method: req.method,
        path: adjustedPath || '/',
        body: req.body,
        query: req.query,
        headers: req.headers
      },
      req,
      res
    );

    if (!response || !response.body) {
      console.error('[DynamoDB Response] Invalid response:', response);
      return res.status(500).json({
        error: 'Invalid response from handler'
      });
    }

    console.log('[DynamoDB Response]:', {
      statusCode: response.statusCode,
      body: response.body
    });

    res.status(response.statusCode).json(response.body);
  } catch (error) {
    console.error('[DynamoDB Error]:', error);
    res.status(500).json({
      error: 'Failed to handle DynamoDB request',
      message: error.message
    });
  }
});

// Handle main API routes
app.all('/api/*', async (req, res) => {
  try {
    const response = await mainApi.handleRequest(
      {
        method: req.method,
        path: req.path.replace('/api', '') || '/',
        body: req.body,
        query: req.query,
        headers: req.headers
      },
      req,
      res
    );
    res.status(response.statusCode).json(response.body);
  } catch (error) {
    console.error('Main API request error:', error);
    res.status(500).json({ error: 'Failed to handle main API request' });
  }
});

// Add direct route for paginated execution
app.post('/execute/paginated', async (req, res) => {
  try {
    const response = await mainApi.handleRequest(
      {
        method: 'POST',
        path: '/execute/paginated',
        body: req.body,
        headers: req.headers
      },
      req,
      res
    );
    res.status(response.statusCode).json(response.body);
  } catch (error) {
    console.error('Paginated execution error:', error);
    res.status(500).json({ error: 'Failed to execute paginated request' });
  }
});

// Add direct route for execute
app.post('/execute', async (req, res) => {
  try {
    const response = await mainApi.handleRequest(
      {
        method: 'POST',
        path: '/execute',
        body: req.body,
        headers: req.headers
      },
      req,
      res
    );
    res.status(response.statusCode).json(response.body);
  } catch (error) {
    console.error('Execute request error:', error);
    res.status(500).json({ error: 'Failed to execute request' });
  }
});


app.post('/pinterest/token', async (req, res) => {
  console.log('Incoming Request Body:', req.body); // Log the incoming request body
  const { code, clientId, clientSecret, redirectUrl } = req.body;

  // Check if any of the required fields are missing
  if (!code || !clientId || !clientSecret || !redirectUrl) {
      return res.status(400).json({ error: 'Missing required fields' });
  }

  const tokenRequestBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUrl
  }).toString();

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  

  try {
      const response = await axios.post('https://api.pinterest.com/v5/oauth/token', tokenRequestBody, {
          headers: {
              'Authorization': `Basic ${auth}`,
              'Content-Type': 'application/x-www-form-urlencoded'
          }
      });
     
      res.json(response.data.access_token); // Send the response data back to the client
  
  
  } catch (error) {
      console.error('Error fetching token:', error.response ? error.response.data : error.message);
      res.status(500).json({ error: 'Failed to fetch token' });
  }
});

// Helper function to format objects for DynamoDB
function formatDynamoDBMap(obj) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      result[key] = { NULL: true };
    } else if (typeof value === 'string') {
      result[key] = { S: value };
    } else if (typeof value === 'number') {
      result[key] = { N: value.toString() };
    } else if (typeof value === 'boolean') {
      result[key] = { BOOL: value };
    } else if (Array.isArray(value)) {
      result[key] = { L: value.map(item => formatDynamoDBValue(item)) };
    } else if (typeof value === 'object') {
      result[key] = { M: formatDynamoDBMap(value) };
    }
  }
  return result;
}

function formatDynamoDBValue(value) {
  if (value === null || value === undefined) {
    return { NULL: true };
  } else if (typeof value === 'string') {
    return { S: value };
  } else if (typeof value === 'number') {
    return { N: value.toString() };
  } else if (typeof value === 'boolean') {
    return { BOOL: value };
  } else if (Array.isArray(value)) {
    return { L: value.map(item => formatDynamoDBValue(item)) };
  } else if (typeof value === 'object') {
    return { M: formatDynamoDBMap(value) };
  }
  return { NULL: true };
}

// Handle Schema API routes
app.all('/api/schema/*', async (req, res) => {
  try {
    const response = await schemaApi.handleRequest(
      {
        method: req.method,
        path: req.path.replace('/api/schema', '') || '/',
        body: req.body,
        query: req.query,
        headers: req.headers
      },
      req,
      res
    );
    res.status(response.statusCode).json(response.body);
  } catch (error) {
    console.error('[Schema API] Error:', error.message);
    res.status(500).json({
      error: 'Failed to handle schema API request',
      message: error.message
    });
  }
});

app.post('/schema/data', async (req, res) => {
  try {
    const { tableName, item } = req.body;
    if (!tableName || !item) {
      return res.status(400).json({ error: 'tableName and item are required' });
    }
    await schemaHandlers.insertSchemaData({ tableName, item });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/schema/table-meta/:metaId', async (req, res) => {
  try {
    const { metaId } = req.params;
    const result = await schemaHandlers.getSchemaTableMeta(metaId);
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/schema/table-meta/check/:metaId', async (req, res) => {
  try {
    const { metaId } = req.params;
    const result = await schemaHandlers.checkAndUpdateTableStatus(metaId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all items from a table
app.get('/schema/table/:tableName/items', async (req, res) => {
  try {
    const { tableName } = req.params;
    const items = await schemaHandlers.getTableItems(tableName);
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch table items', details: error.message });
  }
});

// Get schema for a table by tableName
app.get('/schema/table/:tableName/schema', async (req, res) => {
  try {
    const { tableName } = req.params;
    const schema = await schemaHandlers.getSchemaByTableName(tableName);
    res.json(schema);
  } catch (error) {
    res.status(404).json({ error: 'Schema not found', details: error.message });
  }
});

app.post('/schema/table-meta/check-all', async (req, res) => {
  try {
    const result = await schemaHandlers.checkAllTableStatuses();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to check all table statuses', details: error.message });
  }
});

// Load BRMH LLM SERVICE OpenAPI specification
const llmOpenapiSpec = yaml.load(fs.readFileSync(path.join(__dirname, 'swagger/brmh-llm-service.yaml'), 'utf8'));

// Serve LLM API docs
app.use('/llm-api-docs', swaggerUi.serve);
app.get('/llm-api-docs', (req, res) => {
  res.send(
    swaggerUi.generateHTML(llmOpenapiSpec, {
      customSiteTitle: "BRMH LLM SERVICE API Documentation",
      customfavIcon: "/favicon.ico",
      customCss: '.swagger-ui .topbar { display: none }',
      swaggerUrl: "/llm-api-docs/swagger.json"
    })
  );
});
app.get('/llm-api-docs/swagger.json', (req, res) => {
  res.json(llmOpenapiSpec);
});

// LLM route
app.post('/llm/generate-schema', async (req, res) => {
  const result = await llmHandlers.generateSchemaWithLLM({ request: { requestBody: req.body } }, req, res);
  res.status(result.statusCode).json(result.body);
});

// LLM routes
app.post('/llm/generate-schema/stream', async (req, res) => {
  try {
    const result = await llmHandlers.generateSchemaWithLLMStream(
      { request: { requestBody: req.body } },
      req,
      res
    );
    // Note: The handler will handle the streaming response directly
  } catch (error) {
    console.error('LLM streaming error:', error);
    res.status(500).json({ error: 'Failed to generate schema stream' });
  }
});

// Load Unified OpenAPI specification
const unifiedOpenapiSpec = yaml.load(fs.readFileSync(path.join(__dirname, 'swagger/unified-api.yaml'), 'utf8'));

// Serve Unified API docs
app.use('/unified-api-docs', swaggerUi.serve);
app.get('/unified-api-docs', (req, res) => {
  res.send(
    swaggerUi.generateHTML(unifiedOpenapiSpec, {
      customSiteTitle: "Unified API Documentation",
      customfavIcon: "/favicon.ico",
      customCss: '.swagger-ui .topbar { display: none }',
      swaggerUrl: "/unified-api-docs/swagger.json"
    })
  );
});

// Serve Unified OpenAPI specification
app.get('/unified-api-docs/swagger.json', (req, res) => {
  res.json(unifiedOpenapiSpec);
});

// Handle Unified API routes
app.all('/unified/*', async (req, res) => {
  try {
    console.log('[Unified API Request]:', {
      method: req.method,
      path: req.path,
      body: req.body
    });

    const response = await unifiedApi.handleRequest(
      {
        method: req.method,
        path: req.path.replace('/unified', '') || '/',
        body: req.body,
        query: req.query,
        headers: req.headers
      },
      req,
      res
    );

    console.log('[Unified API Response]:', {
      statusCode: response.statusCode,
      body: response.body
    });

    res.status(response.statusCode).json(response.body);
  } catch (error) {
    console.error('[Unified API] Error:', error.message);
    res.status(500).json({
      error: 'Failed to handle unified API request',
      message: error.message
    });
  }
});

app.get('/llm/templates', async (req, res) => {
  const result = await llmHandlers.listPromptTemplates();
  res.status(result.statusCode).json(result.body);
});
app.post('/llm/templates', async (req, res) => {
  const result = await llmHandlers.savePromptTemplate({ request: { requestBody: req.body } }, req, res);
  res.status(result.statusCode).json(result.body);
});
app.get('/llm/history', async (req, res) => {
  const result = await llmHandlers.listLLMHistory();
  res.status(result.statusCode).json(result.body);
});
app.post('/llm/history', async (req, res) => {
  const result = await llmHandlers.saveLLMHistory({ request: { requestBody: req.body } }, req, res);
  res.status(result.statusCode).json(result.body);
});

// Add this before the catch-all /unified/* route
app.post('/unified/schema/table/:tableName/items', async (req, res) => {
  return unifiedHandlers.createTableItem(
    { request: { params: req.params, requestBody: req.body } },
    req,
    res
  );
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Main API documentation available at http://localhost:${PORT}/api-docs`);
  console.log(`AWS DynamoDB service available at http://localhost:${PORT}/api/dynamodb`);
  console.log(`llm API documentation available at http://localhost:${PORT}/llm-api-docs`);
  console.log(`Unified API documentation available at http://localhost:${PORT}/unified-api-docs`);
});


