//index file by Sapto
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

import { handlers as unifiedHandlers } from './lib/unified-handlers.js';
import { DynamoDBClient, DescribeTableCommand, CreateTableCommand } from '@aws-sdk/client-dynamodb';
import pkg from '@aws-sdk/lib-dynamodb';
const { DynamoDBDocumentClient } = pkg;

import { aiAgentHandler, aiAgentStreamHandler } from './lib/ai-agent-handlers.js';
import { agentSystem, handleLambdaCodegen } from './lib/llm-agent-system.js';
import { lambdaDeploymentManager } from './lib/lambda-deployment.js';
import { 
  cacheTableHandler, 
  getCachedDataHandler, 
  getPaginatedCacheKeysHandler,
  clearCacheHandler, 
  getCacheStatsHandler, 
  cacheHealthHandler,
  testCacheConnection
} from './utils/cache.js';

import { updateCacheFromLambdaHandler } from './utils/cache.js';

import {
  indexTableHandler,
  searchIndexHandler,
  listIndicesHandler,
  deleteIndicesHandler,
  searchHealthHandler,
  updateIndexingFromLambdaHandler
} from './utils/search-indexing.js';

import * as crud from './utils/crud.js';
import { execute } from './utils/execute.js';

// Load environment variables
dotenv.config();
console.log("AWS_ACCESS_KEY_ID", process.env.AWS_ACCESS_KEY_ID);
console.log("AWS_SECRET_ACCESS_KEY", process.env.AWS_SECRET_ACCESS_KEY);
console.log("AWS_REGION", process.env.AWS_REGION);



// Initialize DynamoDB client
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

// Log AWS configuration status
console.log('AWS Configuration Check:', {
  hasAccessKeyId: !!process.env.AWS_ACCESS_KEY_ID ? 'Yes' : 'No',
  hasSecretKey: !!process.env.AWS_SECRET_ACCESS_KEY ? 'Yes' : 'No',
  hasRegion: !!process.env.AWS_REGION ? 'Yes' : 'No',
  nodeEnv: process.env.NODE_ENV
});

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.text({ limit: '50mb' })); // Add support for text/plain
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


// Define unifiedApiHandlers FIRST
const unifiedApiHandlers = {
    // Namespace Operations
    getNamespaces: unifiedHandlers.getNamespaces,
    createNamespace: unifiedHandlers.createNamespace,
    updateNamespace: unifiedHandlers.updateNamespace,
    deleteNamespace: unifiedHandlers.deleteNamespace,
  getNamespaceById: unifiedHandlers.getNamespaceById,

  // Schema Operations
  listSchemas: unifiedHandlers.listSchemas,
  listSchemasByNamespace: unifiedHandlers.listSchemasByNamespace,
  getSchemas: unifiedHandlers.listSchemas, // Alias for listSchemas
  createSchema: unifiedHandlers.createSchema,
  updateSchema: unifiedHandlers.updateSchema,
  deleteSchema: unifiedHandlers.deleteSchema,
  getSchemaById: unifiedHandlers.getSchemaById,
  saveSchema: unifiedHandlers.saveSchema,
  // Register the createSchemasTable handler
  createSchemasTable: unifiedHandlers.createSchemasTable,

    // Namespace Method Operations
    getNamespaceMethods: unifiedHandlers.getNamespaceMethods,
    createNamespaceMethod: unifiedHandlers.createNamespaceMethod,
    updateNamespaceMethod: unifiedHandlers.updateNamespaceMethod,
    deleteNamespaceMethod: unifiedHandlers.deleteNamespaceMethod,
    getNamespaceMethodById: unifiedHandlers.getNamespaceMethodById,
  createTableItem: unifiedHandlers.createTableItem,

    // Namespace Account Operations
    getNamespaceAccounts: unifiedHandlers.getNamespaceAccounts,
    getNamespaceAccountById: unifiedHandlers.getNamespaceAccountById,
    createNamespaceAccount: unifiedHandlers.createNamespaceAccount,
    updateNamespaceAccount: unifiedHandlers.updateNamespaceAccount,
    deleteNamespaceAccount: unifiedHandlers.deleteNamespaceAccount,
  // Execute Namespace Request
  executeNamespaceRequest: unifiedHandlers.executeNamespaceRequest,
  executeNamespacePaginatedRequest: unifiedHandlers.executeNamespacePaginatedRequest,


  // Webhook Operations
  createWebhook: unifiedHandlers.createWebhook,
  getWebhookById: unifiedHandlers.getWebhookById,
  updateWebhook: unifiedHandlers.updateWebhook,
  deleteWebhook: unifiedHandlers.deleteWebhook,
  listWebhooks: unifiedHandlers.listWebhooks,
  getWebhooksByTableName: unifiedHandlers.getWebhooksByTableName,
  getWebhooksByNamespace: unifiedHandlers.getWebhooksByNamespace,
  getWebhooksByMethod: unifiedHandlers.getWebhooksByMethod,
  getActiveWebhooks: unifiedHandlers.getActiveWebhooks,

 
}; 

// THEN initialize OpenAPIBackend
const unifiedApi = new OpenAPIBackend({
  definition: path.join(__dirname, 'swagger/unified-api.yaml'),
  handlers: unifiedApiHandlers,
});

// Define AI Agent API Handlers
const aiAgentApiHandlers = {
  aiAgent: aiAgentHandler,
  aiAgentStream: aiAgentStreamHandler,
  // Add more as needed
};

// Initialize AI Agent OpenAPI backend
const aiAgentApi = new OpenAPIBackend({
  definition: path.join(__dirname, 'swagger/ai-agent-api.yaml'),
  handlers: aiAgentApiHandlers,
});

// Initialize all APIs
Promise.all([
  awsApi.init(),
  unifiedApi.init(),
  aiAgentApi.init()
]).catch(error => {
  console.error('Error initializing OpenAPI backends:', error);
});

// --- Lambda Deployment API Routes ---
app.post('/lambda/deploy', async (req, res) => {
  try {
    const { functionName, code, runtime = 'nodejs18.x', handler = 'index.handler', memorySize = 128, timeout = 30, dependencies = {} } = req.body;
    
    if (!functionName || !code) {
      return res.status(400).json({ error: 'functionName and code are required' });
    }

    console.log(`[Lambda Deployment] Deploying function: ${functionName}`);
    console.log(`[Lambda Deployment] Request body:`, { functionName, runtime, handler, memorySize, timeout, dependencies });
    
    // Set timeout for the entire deployment process (10 minutes)
    const deploymentPromise = lambdaDeploymentManager.deployLambdaFunction(
      functionName, 
      code, 
      runtime, 
      handler, 
      memorySize, 
      timeout,
      dependencies
    );
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Deployment timed out after 10 minutes')), 10 * 60 * 1000);
    });
    
    const result = await Promise.race([deploymentPromise, timeoutPromise]);

    console.log(`[Lambda Deployment] Real deployment result:`, result);
    res.json(result);
  } catch (error) {
    console.error('[Lambda Deployment] Error:', error);
    res.status(500).json({ 
      error: 'Failed to deploy Lambda function', 
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/lambda/invoke', async (req, res) => {
  try {
    console.log(`[Lambda Invoke] Raw request body:`, req.body);
    const { functionName, payload = {} } = req.body;
    
    if (!functionName) {
      return res.status(400).json({ error: 'functionName is required' });
    }

    console.log(`[Lambda Invoke] Invoking function: ${functionName}`);
    console.log(`[Lambda Invoke] Payload:`, payload);
    
    // Invoke real AWS Lambda function
    const result = await lambdaDeploymentManager.invokeLambdaFunction(functionName, payload);
    console.log(`[Lambda Invoke] Real invoke result:`, result);
    res.json(result);
  } catch (error) {
    console.error('[Lambda Invoke] Error:', error);
    console.error('[Lambda Invoke] Error details:', {
      name: error.name,
      message: error.message,
      code: error.$metadata?.httpStatusCode,
      requestId: error.$metadata?.requestId
    });
    res.status(500).json({ 
      error: 'Failed to invoke Lambda function', 
      details: error.message,
      errorCode: error.name,
      requestId: error.$metadata?.requestId
    });
  }
});

app.post('/lambda/cleanup', async (req, res) => {
  try {
    const { functionName } = req.body;
    
    if (!functionName) {
      return res.status(400).json({ error: 'functionName is required' });
    }

    console.log(`[Lambda Deployment] Cleaning up temp files for: ${functionName}`);
    
    await lambdaDeploymentManager.cleanupTempFiles(functionName);
    res.json({ success: true, message: 'Temp files cleaned up successfully' });
  } catch (error) {
    console.error('[Lambda Deployment] Error:', error);
    res.status(500).json({ 
      error: 'Failed to cleanup temp files', 
      details: error.message 
    });
  }
});

// Serve Swagger UI for all APIs
const awsOpenapiSpec = yaml.load(fs.readFileSync(path.join(__dirname, 'swagger/aws-dynamodb.yaml'), 'utf8'));
const mainOpenapiSpec = yaml.load(fs.readFileSync(path.join(__dirname, 'swagger/unified-api.yaml'), 'utf8'));




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

// Serve AI Agent API docs
const aiAgentOpenapiSpec = yaml.load(fs.readFileSync(path.join(__dirname, 'swagger/ai-agent-api.yaml'), 'utf8'));
app.use('/ai-agent-docs', swaggerUi.serve);
app.get('/ai-agent-docs', (req, res) => {
  res.send(
    swaggerUi.generateHTML(aiAgentOpenapiSpec, {
      customSiteTitle: "AI Agent API Documentation",
      customfavIcon: "/favicon.ico",
      customCss: '.swagger-ui .topbar { display: none }',
      swaggerUrl: "/ai-agent-docs/swagger.json"
    })
  );
});

// Serve Unified API docs
app.use('/unified-api-docs', swaggerUi.serve);
app.get('/unified-api-docs', (req, res) => {
  res.send(
    swaggerUi.generateHTML(mainOpenapiSpec, {
      customSiteTitle: "Unified API Documentation",
      customfavIcon: "/favicon.ico",
      customCss: '.swagger-ui .topbar { display: none }',
      swaggerUrl: "/unified-api-docs/swagger.json"
    })
  );
});

// Serve Unified API specification
app.get('/unified-api-docs/swagger.json', (req, res) => {
  res.json(mainOpenapiSpec);
});

// Route AI Agent endpoints
app.post('/ai-agent', (req, res) => aiAgentHandler({ request: { requestBody: req.body } }, req, res));

// AI Agent streaming endpoint for chat and schema editing
app.post('/ai-agent/stream', async (req, res) => {
  const { message, namespace, history, schema } = req.body;
  try {
    await agentSystem.handleStreamingWithAgents(res, namespace, message, history, schema);
  } catch (error) {
    console.error('AI Agent streaming error:', error);
    res.status(500).json({ error: 'Failed to handle AI Agent streaming request' });
  }
});

// AI Agent Lambda codegen endpoint
app.post('/ai-agent/lambda-codegen', async (req, res) => {
  const { message, namespace, selectedSchema, functionName, runtime, handler, memory, timeout, environment } = req.body;
  console.log('[AI Agent] Lambda codegen request:', { message, selectedSchema, functionName, runtime, handler, memory, timeout, environment });

  try {
    // Use the dedicated lambda codegen handler with streaming
    await handleLambdaCodegen({
      message,
      selectedSchema,
      functionName,
      runtime,
      handler,
      memory,
      timeout,
      environment,
      res // Pass the response object for streaming
    });

  } catch (error) {
    console.error('[AI Agent] Lambda codegen error:', error);
    res.write(`data: ${JSON.stringify({ error: 'Failed to generate Lambda code', details: error.message })}\n\n`);
    res.end();
  }
});

// AI Agent Workspace State endpoints
app.post('/ai-agent/get-workspace-state', async (req, res) => {
  try {
    const { sessionId, namespaceId } = req.body;
    if (!sessionId || !namespaceId) {
      return res.status(400).json({ error: 'Missing sessionId or namespaceId' });
    }
    
    // For now, return a default workspace state
    // In a real implementation, you would load this from a database or cache
    const workspaceState = {
      files: [],
      schemas: [],
      apis: [],
      projectType: 'nodejs',
      lastGenerated: null
    };
    
    res.json({ success: true, workspaceState });
  } catch (error) {
    console.error('Error getting workspace state:', error);
    res.status(500).json({ error: 'Failed to get workspace state' });
  }
});

app.post('/ai-agent/save-workspace-state', async (req, res) => {
  try {
    const { sessionId, namespaceId, workspaceState } = req.body;
    if (!sessionId || !namespaceId || !workspaceState) {
      return res.status(400).json({ error: 'Missing sessionId, namespaceId, or workspaceState' });
    }
    
    // For now, just acknowledge the save
    // In a real implementation, you would save this to a database or cache
    console.log('Saving workspace state:', { sessionId, namespaceId, workspaceState });
    
    res.json({ success: true, message: 'Workspace state saved' });
  } catch (error) {
    console.error('Error saving workspace state:', error);
    res.status(500).json({ error: 'Failed to save workspace state' });
  }
});

// AI Agent Chat History endpoints
app.post('/ai-agent/chat-history', async (req, res) => {
  try {
    const { sessionId, userId, limit = 50 } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId' });
    }
    
    // For now, return empty history
    // In a real implementation, you would load this from a database
    res.json({ success: true, history: [] });
  } catch (error) {
    console.error('Error getting chat history:', error);
    res.status(500).json({ error: 'Failed to get chat history' });
  }
});

app.post('/ai-agent/clear-history', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId' });
    }
    
    // For now, just acknowledge the clear
    // In a real implementation, you would clear this from a database
    console.log('Clearing chat history for session:', sessionId);
    
    res.json({ success: true, message: 'Chat history cleared' });
  } catch (error) {
    console.error('Error clearing chat history:', error);
    res.status(500).json({ error: 'Failed to clear chat history' });
  }
});

// Code Generation endpoints
app.get('/code-generation/files/:namespaceId', async (req, res) => {
  try {
    const { namespaceId } = req.params;
    
    // For now, return empty file list
    // In a real implementation, you would load this from a database or file system
    res.json({ success: true, files: [] });
  } catch (error) {
    console.error('Error getting files:', error);
    res.status(500).json({ error: 'Failed to get files' });
  }
});

app.get('/code-generation/files/:namespaceId/*', async (req, res) => {
  try {
    const { namespaceId } = req.params;
    const filePath = req.params[0];
    
    // For now, return empty content
    // In a real implementation, you would load this from a file system
    res.json({ success: true, content: '' });
  } catch (error) {
    console.error('Error getting file content:', error);
    res.status(500).json({ error: 'Failed to get file content' });
  }
});

app.post('/code-generation/generate-backend', async (req, res) => {
  try {
    const { schemas, apis, projectType } = req.body;
    
    // For now, return a placeholder response
    // In a real implementation, you would generate backend code
    res.json({ 
      success: true, 
      message: 'Backend code generation not yet implemented',
      files: []
    });
  } catch (error) {
    console.error('Error generating backend code:', error);
    res.status(500).json({ error: 'Failed to generate backend code' });
  }
});

// Save to namespace endpoints
app.post('/save-api-to-namespace', async (req, res) => {
  try {
    const { namespaceId, apiData } = req.body;
    
    // For now, just acknowledge the save
    // In a real implementation, you would save this to a database
    console.log('Saving API to namespace:', { namespaceId, apiData });
    
    res.json({ success: true, message: 'API saved to namespace' });
  } catch (error) {
    console.error('Error saving API to namespace:', error);
    res.status(500).json({ error: 'Failed to save API to namespace' });
  }
});

// Endpoint to add a schemaId to a namespace's schemaIds array
debugger;
app.post('/unified/namespace/:namespaceId/add-schema', async (req, res) => {
  try {
    const { namespaceId } = req.params;
    const { schemaId } = req.body;
    if (!namespaceId || !schemaId) {
      return res.status(400).json({ success: false, error: 'Missing namespaceId or schemaId' });
    }
    const result = await unifiedHandlers.updateNamespace(namespaceId, { schemaId });
    return res.json({ success: true, updatedNamespace: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint to save a schema to a namespace
app.post('/save-schema-to-namespace', async (req, res) => {
  try {
    console.log('Received /save-schema-to-namespace:', req.body);
    const { namespaceId, schemaName, schemaType, schema, isArray, originalType, url } = req.body;
    if (!namespaceId || !schemaName || !schemaType || !schema) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    // Use the unifiedHandlers.saveSchema handler
    const result = await unifiedHandlers.saveSchema({ request: { requestBody: { namespaceId, schemaName, schemaType, schema, isArray, originalType, url } } }, req, res);
    console.log('Result from saveSchema:', result);
    if (result.statusCode === 200) {
      return res.json({ success: true, schemaId: result.body.schemaId });
    } else {
      return res.status(result.statusCode).json({ success: false, error: result.body.error });
    }
  } catch (error) {
    console.error('Error in /save-schema-to-namespace:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- API Testing Endpoint: Test OpenAPI endpoint and stream result to frontend console ---
app.post('/api/test-openapi-endpoint', async (req, res) => {
  try {
    const { openapiJson, path: testPath, method, body, headers, query } = req.body;
    if (!openapiJson || !testPath || !method) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Validate request against OpenAPI spec
    const tempApi = new OpenAPIBackend({ definition: openapiJson, quick: true });
    await tempApi.init();
    const validation = tempApi.validateRequest({
      method: method.toLowerCase(),
      path: testPath,
      body,
      query,
      headers
    });
    if (!validation.valid) {
      return res.status(400).json({ error: 'Request does not match OpenAPI spec', details: validation.errors });
    }

    // Make the real HTTP request (assume baseUrl is in servers[0].url)
    const baseUrl = openapiJson.servers && openapiJson.servers[0] && openapiJson.servers[0].url ? openapiJson.servers[0].url : '';
    if (!baseUrl) {
      return res.status(400).json({ error: 'No baseUrl found in OpenAPI spec' });
    }
    const url = baseUrl.replace(/\/$/, '') + testPath;

    // Stream response
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    try {
      const response = await axios({
        method: method.toLowerCase(),
        url,
        headers,
        params: query,
        data: body,
        validateStatus: () => true // Don't throw on any status
      });
      res.write(JSON.stringify({ status: response.status, statusText: response.statusText, headers: response.headers, body: response.data }) + '\n');
    } catch (err) {
      res.write(JSON.stringify({ error: err.message }) + '\n');
    }
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/cache/table', cacheTableHandler);
app.get('/cache/data', getCachedDataHandler);
app.get('/cache/keys', getPaginatedCacheKeysHandler);
app.get('/cache/clear', clearCacheHandler);
app.get('/cache/stats', getCacheStatsHandler);
app.get('/cache/health', cacheHealthHandler);
app.get('/cache/test', testCacheConnection);

// Cache update from Lambda function
app.post('/cache-data', updateCacheFromLambdaHandler);

// Test endpoint to simulate Lambda cache update
app.post('/cache/test-update', async (req, res) => {
  try {
    const { type, newItem, oldItem, tableName } = req.body;
    
    console.log('Testing cache update with:', { type, tableName, newItem, oldItem });
    
    // Create a test request that mimics what Lambda would send
    const testReq = {
      body: {
        type: type || 'INSERT',
        newItem: newItem || { id: 'test-id', data: 'test-data' },
        oldItem: oldItem,
        tableName: tableName || 'brmh-cache'
      }
    };
    
    await updateCacheFromLambdaHandler(testReq, res);
  } catch (error) {
    console.error('Test cache update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Search Indexing API Routes ---
app.post('/search/index', indexTableHandler);
app.post('/search/query', searchIndexHandler);
app.post('/search/indices', listIndicesHandler);
app.post('/search/delete', deleteIndicesHandler);
app.post('/search/update', updateIndexingFromLambdaHandler);
app.get('/search/health', searchHealthHandler);

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ message: 'Server is working!' });
});



// Streaming Lambda deployment endpoint
app.post('/lambda/deploy-stream', async (req, res) => {
  try {
    const { functionName, code, runtime = 'nodejs18.x', handler = 'index.handler', memorySize = 128, timeout = 30 } = req.body;
    
    if (!functionName || !code) {
      return res.status(400).json({ error: 'functionName and code are required' });
    }

    console.log(`[Lambda Deployment] Starting streaming deployment for: ${functionName}`);
    
    // Set up streaming response
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send initial status
    res.write(`data: ${JSON.stringify({ type: 'status', message: 'Starting Lambda deployment...', functionName })}\n\n`);
    
    try {
      // Real deployment steps
      res.write(`data: ${JSON.stringify({ type: 'progress', message: 'Creating deployment package...', step: 1, totalSteps: 7, functionName })}\n\n`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      res.write(`data: ${JSON.stringify({ type: 'progress', message: 'Installing dependencies...', step: 2, totalSteps: 7, functionName })}\n\n`);
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      res.write(`data: ${JSON.stringify({ type: 'progress', message: 'Creating deployment ZIP file...', step: 3, totalSteps: 7, functionName })}\n\n`);
      await new Promise(resolve => setTimeout(resolve, 800));
      
      res.write(`data: ${JSON.stringify({ type: 'progress', message: 'Checking if function exists...', step: 4, totalSteps: 7, functionName })}\n\n`);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      res.write(`data: ${JSON.stringify({ type: 'progress', message: 'Creating/updating Lambda function...', step: 5, totalSteps: 7, functionName })}\n\n`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      res.write(`data: ${JSON.stringify({ type: 'progress', message: 'Configuring function settings...', step: 6, totalSteps: 7, functionName })}\n\n`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Perform actual deployment
      const result = await lambdaDeploymentManager.deployLambdaFunction(
        functionName, 
        code, 
        runtime, 
        handler, 
        memorySize, 
        timeout
      );
      
      res.write(`data: ${JSON.stringify({ type: 'progress', message: 'Deployment completed successfully!', step: 7, totalSteps: 7, functionName })}\n\n`);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Send final result
      res.write(`data: ${JSON.stringify({ type: 'result', data: result, functionName })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();

      console.log(`[Lambda Deployment] Streaming deployment completed for: ${functionName}`);
    } catch (deploymentError) {
      console.error('[Lambda Deployment] Deployment error:', deploymentError);
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Deployment failed: ' + deploymentError.message, functionName })}\n\n`);
      res.end();
    }
  } catch (error) {
    console.error('[Lambda Deployment] Streaming error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Deployment failed: ' + error.message })}\n\n`);
    res.end();
  }
});

/**
 * Generic CRUD endpoint for DynamoDB tables
 * Usage:
 *   - GET    /api/crud?tableName=...&partitionKey=...&sortKey=... (single item or paginated)
 *   - POST   /api/crud?tableName=...   (body: { item: ... })
 *   - PUT    /api/crud?tableName=...   (body: { key: ..., updates: ... })
 *   - DELETE /api/crud?tableName=...   (body: { partitionKey: ..., sortKey: ... })
 */
app.all('/crud', async (req, res) => {
  try {
    const event = {
      httpMethod: req.method,
      requestContext: req.requestContext || {},
      queryStringParameters: req.query,
      body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    };
    const result = await crud.handler(event);
    res.status(result.statusCode || 200);
    // If result.body is a string, parse if possible
    let body = result.body;
    try {
      body = JSON.parse(result.body);
    } catch {}
    res.json(body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Execute endpoint - handles both single and paginated requests
app.post('/execute', async (req, res) => {
  try {
    console.log('[Execute] Request received:', {
      executeType: req.body.executeType,
      url: req.body.url,
      method: req.body.method
    });

    const event = {
      body: req.body
    };

    const result = await execute(event);
    
    // Parse the result body if it's a string
    let responseBody = result.body;
    try {
      responseBody = JSON.parse(result.body);
    } catch {}

    res.status(result.statusCode || 200).json(responseBody);
  } catch (error) {
    console.error('[Execute] Error:', error);
    res.status(500).json({ 
      error: 'Failed to execute request', 
      details: error.message 
    });
  }
});

// Handle DynamoDB API routes
app.all('/dynamodb/*', async (req, res) => {
  try {
    const response = await awsApi.handleRequest(
      {
        method: req.method,
        path: req.path.replace('/dynamodb', '') || '/',
        body: req.body,
        query: req.query,
        headers: req.headers
      },
      req,
      res
    );

    // Check if response is null (streaming response handled by handler)
    if (response === null) {
      return; // Response already handled by the handler
    }

    res.status(response.statusCode).json(response.body);
  } catch (error) {
    console.error('[DynamoDB API] Error:', error.message);
    res.status(500).json({
      error: 'Failed to handle DynamoDB API request',
      message: error.message
    });
  }
});

// Handle Unified API routes
app.all('/unified/*', async (req, res) => {
  try {
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

    // Check if response is null (streaming response handled by handler)
    if (response === null) {
      return; // Response already handled by the handler
    }

    res.status(response.statusCode).json(response.body);
  } catch (error) {
    console.error('[Unified API] Error:', error.message);
    res.status(500).json({
      error: 'Failed to handle unified API request',
      message: error.message
    });
  }
});

//cache-data getting from lambda to update the cache
app.post("/cache/update", async (req, res) => {
  try {
    const { type, newItem, oldItem } = req.body;

    console.log("Received from Lambda:");
    console.log("Event Type:", type);
    console.log("New Item:", newItem);
    console.log("Old Item:", oldItem);

    // Extract table name from the item
    let tableName = null;
    
    // Try to get table name from the item structure
    if (newItem && newItem.tableName) {
      tableName = newItem.tableName;
    } else if (oldItem && oldItem.tableName) {
      tableName = oldItem.tableName;
    } else {
      // If no tableName in item, try to extract from DynamoDB structure
      // Look for common table name patterns in the item
      const item = newItem || oldItem;
      if (item) {
        // Check if item has a tableName field in DynamoDB format
        if (item.tableName && item.tableName.S) {
          tableName = item.tableName.S;
        } else if (item.tableName && typeof item.tableName === 'string') {
          tableName = item.tableName;
        } else {
          // Try to infer table name from the item structure or context
          // For now, we'll use a default or extract from the request context
          tableName = 'brmh-cache'; // Default fallback
        }
      }
    }

    if (!tableName) {
      console.error("Could not determine table name from item");
      return res.status(400).json({ error: "Could not determine table name from item" });
    }

    console.log(`Processing cache update for table: ${tableName}`);

    // Use the existing cache update handler
    await updateCacheFromLambdaHandler(req, res);

    // Also trigger indexing update if table name is not the indexing table itself
    if (tableName !== 'brmh-indexing') {
      try {
        console.log(`🔄 Triggering indexing update for table: ${tableName}`);
        
        // Call the indexing update handler asynchronously
        const indexingUpdateReq = {
          body: {
            type,
            newItem,
            oldItem,
            tableName
          }
        };
        
        // Don't wait for the indexing update to complete
        updateIndexingFromLambdaHandler(indexingUpdateReq, {
          status: (code) => ({ code }),
          json: (data) => console.log('Indexing update response:', data)
        }).catch(error => {
          console.error(`❌ Indexing update failed for table ${tableName}:`, error);
        });
        
      } catch (indexingError) {
        console.error(`❌ Error triggering indexing update for table ${tableName}:`, indexingError);
        // Don't fail the cache update if indexing fails
      }
    }

  } catch (error) {
    console.error("Error in cache update endpoint:", error);
    res.status(500).json({ error: error.message });
  }
});

//indexing-data getting from lambda to update the indexing
app.post("/indexing/update", async (req, res) => {
  try {
    const { type, newItem, oldItem, tableName } = req.body;

    console.log("Received indexing update from Lambda:");
    console.log("Event Type:", type);
    console.log("Table Name:", tableName);
    console.log("New Item:", newItem);
    console.log("Old Item:", oldItem);

    if (!type || !tableName) {
      console.error("Missing required parameters for indexing update");
      return res.status(400).json({ 
        error: "Missing required parameters", 
        message: "type and tableName are required" 
      });
    }

    // Call the indexing update handler
    await updateIndexingFromLambdaHandler(req, res);

  } catch (error) {
    console.error("Error in indexing update endpoint:", error);
    res.status(500).json({ error: error.message });
  }
});



const PORT = process.env.PORT || 5001;


app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Main API documentation available at http://localhost:${PORT}/api-docs`);
  console.log(`AWS DynamoDB service available at http://localhost:${PORT}/api/dynamodb`);
  console.log(`llm API documentation available at http://localhost:${PORT}/llm-api-docs`);
  console.log(`Unified API documentation available at http://localhost:${PORT}/unified-api-docs`);
  console.log(`AI Agent API documentation available at http://localhost:${PORT}/ai-agent-docs`);
});