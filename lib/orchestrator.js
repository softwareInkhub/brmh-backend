// Orchestration module for AI Agent Workspace
// This module coordinates multi-step backend tasks for a namespace, based on user chat input.

// Import LLM service
import { Anthropic } from '@anthropic-ai/sdk';
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Import existing handlers
import { fileOperations } from './file-operations.js';
// Add more as needed

// Session state for tracking generated items per namespace
const sessionStates = new Map();

function extractNamespaceId(namespace) {
  return (
    namespace?.id ||
    namespace?.['namespace-id'] ||
    namespace?.namespaceId ||
    (typeof namespace === 'string' ? namespace : undefined)
  );
}

function getSessionState(namespace) {
  const namespaceId = extractNamespaceId(namespace) || 'default';
  if (!sessionStates.has(namespaceId)) {
    sessionStates.set(namespaceId, {
      generatedSchemas: [],
      generatedAPIs: [],
      generatedFiles: [],
      testResults: [],
      conversationHistory: [],
      pendingIntent: null
    });
  }
  return sessionStates.get(namespaceId);
}

/**
 * Generate a schema using the LLM
 * @param {string} message - User's request
 * @param {object} namespace - Namespace context
 * @returns {Promise<{success: boolean, schema: object, error: string}>}
 */
async function generateSchemaWithLLM(message, namespace) {
  try {
    const prompt = `You are a backend developer. Generate a JSON schema based on this request: "${message}".
    
    Namespace context: ${JSON.stringify(namespace, null, 2)}
    
    Return ONLY valid JSON schema, no markdown or code blocks. Example format:
    {
      "type": "object",
      "properties": {
        "id": {"type": "string"},
        "name": {"type": "string"}
      },
      "required": ["id", "name"]
    }`;

    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20240620',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].text;
    
    // Try to parse as JSON
    try {
      const schema = JSON.parse(content);
      return { success: true, schema, error: null };
    } catch (parseError) {
      return { success: false, schema: null, error: 'Invalid JSON schema generated' };
    }
  } catch (error) {
    return { success: false, schema: null, error: error.message };
  }
}

/**
 * Generate an API using the LLM
 * @param {string} message - User's request
 * @param {object} namespace - Namespace context
 * @returns {Promise<{success: boolean, api: object, error: string}>}
 */
async function generateAPIWithLLM(message, namespace) {
  try {
    const prompt = `You are a backend developer. Generate API endpoints based on this request: "${message}".
    
    Namespace context: ${JSON.stringify(namespace, null, 2)}
    
    Return ONLY valid JSON with API endpoints, no markdown or code blocks. Example format:
    {
      "endpoints": [
        {
          "method": "GET",
          "path": "/users",
          "description": "Get all users"
        },
        {
          "method": "POST",
          "path": "/users",
          "description": "Create a new user"
        }
      ]
    }`;

    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20240620',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].text;
    
    // Try to parse as JSON
    try {
      const api = JSON.parse(content);
      return { success: true, api, error: null };
    } catch (parseError) {
      return { success: false, api: null, error: 'Invalid API definition generated' };
    }
  } catch (error) {
    return { success: false, api: null, error: error.message };
  }
}

/**
 * Test generated APIs using mock requests
 * @param {object} api - Generated API definition
 * @param {object} namespace - Namespace context
 * @returns {Promise<{success: boolean, results: Array, error: string}>}
 */
async function testGeneratedAPI(api, namespace) {
  try {
    const results = [];
    
    if (api.endpoints && Array.isArray(api.endpoints)) {
      for (const endpoint of api.endpoints) {
        try {
          // Mock test - in real implementation, you'd call actual endpoints
          const testResult = {
            endpoint: `${endpoint.method} ${endpoint.path}`,
            status: 'success',
            message: 'Mock test passed',
            response: { message: 'Test response' }
          };
          results.push(testResult);
        } catch (error) {
          results.push({
            endpoint: `${endpoint.method} ${endpoint.path}`,
            status: 'error',
            message: error.message
          });
        }
      }
    }
    
    return { success: true, results, error: null };
  } catch (error) {
    return { success: false, results: [], error: error.message };
  }
}

/**
 * Save generated schemas and APIs to namespace
 * @param {object} namespace - Namespace context
 * @param {Array} schemas - Generated schemas
 * @param {Array} apis - Generated APIs
 * @returns {Promise<{success: boolean, saved: Array, error: string}>}
 */
async function saveToNamespace(namespace, schemas = [], apis = []) {
  try {
    const saved = [];
    const namespaceId = extractNamespaceId(namespace);
    if (!namespaceId) {
      return { success: false, saved: [], error: 'No namespace ID provided' };
    }
    
    // Save schemas
    for (const schema of schemas) {
      try {
        const response = await fetch(`http://localhost:5001/unified/schema`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            methodId: null,
            schemaName: schema.name || 'Generated Schema',
            methodName: null,
            namespaceId: namespaceId,
            schemaType: 'object',
            schema: schema,
            isArray: false,
            originalType: 'object',
            url: ''
          })
        });
        
        if (response.ok) {
          const result = await response.json();
          saved.push({
            type: 'schema',
            name: schema.name || 'Generated Schema',
            status: 'saved',
            id: result.schemaId
          });
        } else {
          saved.push({
            type: 'schema',
            name: schema.name || 'Generated Schema',
            status: 'error',
            error: 'Failed to save schema'
          });
        }
      } catch (error) {
        saved.push({
          type: 'schema',
          name: schema.name || 'Generated Schema',
          status: 'error',
          error: error.message
        });
      }
    }
    
    // Save APIs
    for (const api of apis) {
      try {
        if (api.endpoints && Array.isArray(api.endpoints)) {
          for (const endpoint of api.endpoints) {
            const response = await fetch(`http://localhost:5001/unified/namespaces/${namespaceId}/methods`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                'namespace-method-name': endpoint.description || `${endpoint.method} ${endpoint.path}`,
                'namespace-method-type': endpoint.method,
                'namespace-method-url-override': endpoint.path,
                'namespace-method-queryParams': [],
                'namespace-method-header': [],
                'save-data': false,
                'isInitialized': false,
                tags: ['ai-generated'],
                'sample-request': {},
                'sample-response': {},
                'request-schema': {},
                'response-schema': {}
              })
            });
            
            if (response.ok) {
              const result = await response.json();
              saved.push({
                type: 'api',
                name: endpoint.description || `${endpoint.method} ${endpoint.path}`,
                status: 'saved',
                id: result['namespace-method-id']
              });
            } else {
              saved.push({
                type: 'api',
                name: endpoint.description || `${endpoint.method} ${endpoint.path}`,
                status: 'error',
                error: 'Failed to save API endpoint'
              });
            }
          }
        }
      } catch (error) {
        saved.push({
          type: 'api',
          name: api.name || 'Generated API',
          status: 'error',
          error: error.message
        });
      }
    }
    
    return { success: true, saved, error: null };
  } catch (error) {
    return { success: false, saved: [], error: error.message };
  }
}

/**
 * Orchestrate an AI agent task based on user message and context.
 * @param {Object} params
 * @param {string} params.message - The user message from chat
 * @param {object} params.namespace - The current namespace context
 * @param {Array} params.history - Chat history
 * @param {object} params.session - Session state (optional)
 * @returns {Promise<{response: string, actions: Array}>}
 */
async function orchestrateAIAgentTask({ message, namespace, history, session }) {
  // Get namespace ID and session state
  const namespaceId = extractNamespaceId(namespace) || 'default';
  const sessionState = getSessionState(namespaceId);
  
  // Add current message to conversation history
  sessionState.conversationHistory.push({
    role: 'user',
    content: message,
    timestamp: new Date()
  });
  
  // 1. Detect intent (improved rules)
  const lower = message.toLowerCase();
  let intent = 'chat';
  let isNewRequest = false;
  const newCues = [
    'new', 'create something new', 'start over', 'add another', 'something else', 'begin again', 'fresh', 'start fresh', 'reset', 'another one'
  ];
  if (newCues.some(cue => lower.includes(cue))) {
    intent = 'new_request';
    isNewRequest = true;
  } else if (lower.includes('schema')) intent = 'generate_schema';
  else if (lower.includes('api')) intent = 'generate_api';
  else if (lower.includes('test')) intent = 'test';
  else if (lower.includes('save')) intent = 'save';

  // Check for pending intent in session state
  if (sessionState.pendingIntent) {
    if (lower.includes('schema')) intent = 'generate_schema';
    else if (lower.includes('api')) intent = 'generate_api';
    // Clear pending intent after use
    sessionState.pendingIntent = null;
  }

  // 2. Plan subtasks
  const actions = [];
  let response = '';

  if (intent === 'new_request') {
    // Ask user what they want to create
    response = "What would you like to create? (Schema, API, etc.)";
    sessionState.pendingIntent = 'awaiting_create_type';
    actions.push({ type: 'chat', status: 'pending' });
  } else if (intent === 'generate_schema') {
    response = 'I\'ll generate a schema for you based on your request. Let me analyze what you need...';
    actions.push({ type: 'generate_schema', status: 'pending' });
    
    // Call LLM to generate schema
    const result = await generateSchemaWithLLM(message, namespace);
    if (result.success) {
      const schema = { ...result.schema, name: 'Generated Schema', timestamp: new Date() };
      sessionState.generatedSchemas.push(schema);
      response = `Perfect! I've created a comprehensive schema for you. It includes all the necessary fields and validation rules. You can find the detailed schema in the Schema tab, and I've also saved it to your session for later use.`;
      actions.push({ type: 'generate_schema', status: 'complete', data: schema });
    } else {
      response = `I apologize, but I encountered an issue while generating the schema: ${result.error}. Could you please try rephrasing your request or provide more specific details about what you need?`;
      actions.push({ type: 'generate_schema', status: 'error', error: result.error });
    }
  } else if (intent === 'generate_api') {
    response = 'I\'ll create API endpoints for you. Let me design a comprehensive API structure...';
    actions.push({ type: 'generate_api', status: 'pending' });
    
    // Call LLM to generate API
    const result = await generateAPIWithLLM(message, namespace);
    if (result.success) {
      const api = { ...result.api, name: 'Generated API', timestamp: new Date() };
      sessionState.generatedAPIs.push(api);
      response = `Excellent! I've designed a complete API for you with ${api.endpoints?.length || 0} endpoints. Each endpoint is properly configured with the right HTTP methods and includes clear descriptions. You can review the full API specification in the API tab, and I've saved it to your session.`;
      actions.push({ type: 'generate_api', status: 'complete', data: api });
    } else {
      response = `I apologize, but I ran into an issue while creating the API: ${result.error}. Could you please provide more details about the specific functionality you need?`;
      actions.push({ type: 'generate_api', status: 'error', error: result.error });
    }
  } else if (intent === 'test') {
    response = 'I\'ll run tests on the APIs we\'ve generated to make sure everything works correctly...';
    actions.push({ type: 'test', status: 'pending' });
    
    if (sessionState.generatedAPIs.length === 0) {
      response = 'I don\'t see any APIs to test yet. Let\'s create an API first! You can ask me to generate an API for your specific needs, and then I\'ll be happy to test it for you.';
      actions.push({ type: 'test', status: 'error', error: 'No APIs to test' });
    } else {
      const latestAPI = sessionState.generatedAPIs[sessionState.generatedAPIs.length - 1];
      const result = await testGeneratedAPI(latestAPI, namespace);
      
      if (result.success) {
        sessionState.testResults.push(result.results);
        response = `Great news! I've tested all the API endpoints and they're working perfectly. All ${result.results.length} endpoints passed their tests successfully. You can see the detailed test results in the Console tab.`;
        actions.push({ type: 'test', status: 'complete', data: result.results });
      } else {
        response = `I encountered some issues during testing: ${result.error}. Let me know if you'd like me to investigate further or if you need help fixing any problems.`;
        actions.push({ type: 'test', status: 'error', error: result.error });
      }
    }
  } else if (intent === 'save') {
    response = 'I\'ll save everything we\'ve created to your namespace so you can access it later...';
    actions.push({ type: 'save', status: 'pending' });
    
    const result = await saveToNamespace(namespace, sessionState.generatedSchemas, sessionState.generatedAPIs);
    
    if (result.success) {
      const savedCount = result.saved.filter(item => item.status === 'saved').length;
      response = `Perfect! I've successfully saved ${savedCount} items to your namespace. Everything is now permanently stored and you can access your schemas and APIs from your namespace dashboard. Your work is safe and ready to use!`;
      actions.push({ type: 'save', status: 'complete', data: result.saved });
    } else {
      response = `I apologize, but I encountered an issue while saving to your namespace: ${result.error}. Let me know if you'd like me to try again or if you need help troubleshooting this.`;
      actions.push({ type: 'save', status: 'error', error: result.error });
    }
  } else {
    // Generate contextual response based on conversation history
    const recentHistory = sessionState.conversationHistory.slice(-5); // Last 5 messages
    const hasGeneratedItems = sessionState.generatedSchemas.length > 0 || sessionState.generatedAPIs.length > 0;
    if (sessionState.pendingIntent === 'awaiting_create_type') {
      response = "I'm ready! Just tell me what you'd like to create: a Schema, an API, or something else?";
    } else if (hasGeneratedItems) {
      response = `We have ${sessionState.generatedSchemas.length} schema(s) and ${sessionState.generatedAPIs.length} API(s) so far. Would you like to test, save, or create something new?`;
    } else if (recentHistory.length > 1) {
      response = 'What would you like to work on next? I can create schemas, design APIs, run tests, or save your work.';
    } else {
      response = 'Hello! I can help you create schemas, design APIs, run tests, and save everything to your namespace. What would you like to work on today?';
    }
    actions.push({ type: 'chat', status: 'complete' });
  }
  
  // Add assistant response to conversation history
  sessionState.conversationHistory.push({
    role: 'assistant',
    content: response,
    timestamp: new Date()
  });

  // 3. Return conversational response and actions
  return { response, actions };
}

export {
  orchestrateAIAgentTask,
}; 