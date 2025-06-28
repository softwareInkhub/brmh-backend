import axios from 'axios';
import { createNamespace, createNamespaceMethod } from './unified-handlers.js';
import { jsonrepair } from 'jsonrepair';

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY 

let templates = [];
let history = [];

export const handlers = {
  generateSchemaWithLLM: async (c, req, res) => {
    try {
      const { prompt } = c.request.requestBody;
      if (!prompt) {
        return { statusCode: 400, body: { error: 'Prompt is required' } };
      }

      // Detect if the prompt is for code or schema/config
      const isCodePrompt = /lambda function|handler|code/i.test(prompt);
      let context;
      if (isCodePrompt) {
        context = "Only output the code. Do not include any explanations, markdown, or extra text. Your response must be valid JavaScript or TypeScript code.";
      } else {
        context = "Only output the JSON or YAML. Do not include any explanations, markdown, or extra text. Your response must be a valid JSON or YAML object.";
      }
      const inputPrompt = `${context}\n\n${prompt}`;

      // Call Claude API (Anthropic)
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-3-5-sonnet-20240620',
          max_tokens: 2048,
          messages: [{ role: 'user', content: inputPrompt }]
        },
        {
          headers: {
            'x-api-key': CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          }
        }
      );

      // Try to extract code or JSON/YAML from the LLM output
      let llm_output = response.data.content[0].text;
      let extracted = llm_output;
      // Try to extract code block
      const codeMatch = llm_output.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
      if (codeMatch) {
        extracted = codeMatch[1];
      }
      // Try to extract JSON block if not code
      if (!codeMatch) {
        const jsonMatch = llm_output.match(/({[\s\S]*})/);
        if (jsonMatch) {
          extracted = jsonMatch[1];
        }
      }

      return {
        statusCode: 200,
        body: {
          llm_output: extracted
        }
      };
    } catch (error) {
      return {
        statusCode: 500,
        body: { error: error.message }
      };
    }
  },

  // New handler for automated schema creation from user prompt
  generateSchemaFromPrompt: async (c, req, res) => {
    try {
      const { userPrompt, namespaceName, methodName } = c.request.requestBody;
      if (!userPrompt) {
        return { statusCode: 400, body: { error: 'User prompt is required' } };
      }

      const systemPrompt = `You are an expert API schema generator. Based on the user's description, generate a comprehensive JSON schema that includes:

1. Request schema (if applicable)
2. Response schema
3. Method configuration (HTTP method, path, description)
4. Lambda handler code (if needed)

Return ONLY a valid JSON object with this structure:
{
  "requestSchema": { /* JSON schema for request body */ },
  "responseSchema": { /* JSON schema for response body */ },
  "methodConfig": {
    "method": "GET|POST|PUT|DELETE",
    "path": "/api/endpoint",
    "description": "Description of what this endpoint does"
  },
  "lambdaHandler": "/* JavaScript code for Lambda handler */",
  "schemaName": "Descriptive name for the schema"
}

Do not include any explanations, markdown, or code fences - just the JSON object.`;

      const fullPrompt = `${systemPrompt}\n\nUser Request: ${userPrompt}\nNamespace: ${namespaceName || 'Default'}\nMethod: ${methodName || 'Auto-generated'}`;

      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-3-5-sonnet-20240620',
          max_tokens: 4096,
          messages: [{ role: 'user', content: fullPrompt }]
        },
        {
          headers: {
            'x-api-key': CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          }
        }
      );

      let llm_output = response.data.content[0].text;
      
      // Extract JSON from the response
      const jsonMatch = llm_output.match(/({[\s\S]*})/);
      if (jsonMatch) {
        llm_output = jsonMatch[1];
      }

      try {
        const parsed = JSON.parse(llm_output);
        return {
          statusCode: 200,
          body: {
            success: true,
            data: parsed,
            raw_output: llm_output
          }
        };
      } catch (parseError) {
        return {
          statusCode: 200,
          body: {
            success: false,
            error: 'Failed to parse LLM response as JSON',
            raw_output: llm_output
          }
        };
      }
    } catch (error) {
      return {
        statusCode: 500,
        body: { error: error.message }
      };
    }
  },

  // New handler for generating Lambda function with URL
  generateLambdaWithURL: async (c, req, res) => {
    try {
      const { schemaData, namespaceName, methodName } = c.request.requestBody;
      if (!schemaData || !namespaceName || !methodName) {
        return { statusCode: 400, body: { error: 'Schema data, namespace name, and method name are required' } };
      }

      // Generate Lambda function name
      const functionName = `${namespaceName}-${methodName}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      
      // Create Lambda function
      const lambdaCode = schemaData.lambdaHandler || `exports.handler = async (event) => {
  try {
    const response = {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        message: 'Hello from ${functionName}',
        timestamp: new Date().toISOString(),
        event: event
      })
    };
    return response;
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: error.message
      })
    };
  }
};`;

      // Here you would integrate with your AWS Lambda creation API
      // For now, we'll return the configuration
      const lambdaConfig = {
        functionName,
        code: lambdaCode,
        runtime: 'nodejs18.x',
        handler: 'index.handler',
        description: `Auto-generated Lambda for ${namespaceName}/${methodName}`,
        environment: {
          Variables: {
            NAMESPACE: namespaceName,
            METHOD: methodName
          }
        }
      };

      return {
        statusCode: 200,
        body: {
          success: true,
          lambdaConfig,
          message: 'Lambda function configuration generated successfully'
        }
      };
    } catch (error) {
      return {
        statusCode: 500,
        body: { error: error.message }
      };
    }
  },

  // New handler for fetching methods from external API documentation
  fetchMethodsFromExternalAPI: async (c, req, res) => {
    try {
      const { url, targetNamespaceName } = c.request.requestBody;
      if (!url) {
        return { statusCode: 400, body: { error: 'URL is required' } };
      }

      const result = await importMethodsFromExternalAPI(url, targetNamespaceName || 'Imported API');
      
      return {
        statusCode: result.success ? 200 : 400,
        body: result
      };
    } catch (error) {
      return {
        statusCode: 500,
        body: { error: error.message }
      };
    }
  },

  // New handler for creating methods with AI assistance
  createMethodWithAI: async (c, req, res) => {
    try {
      const { methodDescription, namespaceName, methodName } = c.request.requestBody;
      if (!methodDescription) {
        return { statusCode: 400, body: { error: 'Method description is required' } };
      }

      const systemPrompt = `You are an expert API method generator. Based on the user's description, generate a complete API method configuration that includes:

1. HTTP method (GET, POST, PUT, DELETE, etc.)
2. Endpoint path
3. Request parameters (query params, headers, body schema)
4. Response schema
5. Description and documentation
6. Sample request and response

Return ONLY a valid JSON object with this structure:
{
  "method": "GET|POST|PUT|DELETE",
  "endpoint": "/api/endpoint",
  "description": "Description of what this endpoint does",
  "queryParams": [
    { "name": "param1", "type": "string", "required": true, "description": "Parameter description" }
  ],
  "headers": [
    { "name": "Authorization", "type": "string", "required": true, "description": "Bearer token" }
  ],
  "requestSchema": { /* JSON schema for request body */ },
  "responseSchema": { /* JSON schema for response body */ },
  "sampleRequest": { /* sample request object */ },
  "sampleResponse": { /* sample response object */ },
  "tags": ["tag1", "tag2"]
}

Do not include any explanations, markdown, or code fences - just the JSON object.`;

      const fullPrompt = `${systemPrompt}\n\nMethod Description: ${methodDescription}\nNamespace: ${namespaceName || 'Default'}\nMethod Name: ${methodName || 'Auto-generated'}`;

      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-3-5-sonnet-20240620',
          max_tokens: 4096,
          messages: [{ role: 'user', content: fullPrompt }]
        },
        {
          headers: {
            'x-api-key': CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          }
        }
      );

      let llm_output = response.data.content[0].text;
      
      // Extract JSON from the response
      const jsonMatch = llm_output.match(/({[\s\S]*})/);
      if (jsonMatch) {
        llm_output = jsonMatch[1];
      }

      try {
        const parsed = JSON.parse(llm_output);
        return {
          statusCode: 200,
          body: {
            success: true,
            methodConfig: parsed,
            raw_output: llm_output
          }
        };
      } catch (parseError) {
        return {
          statusCode: 200,
          body: {
            success: false,
            error: 'Failed to parse LLM response as JSON',
            raw_output: llm_output
          }
        };
      }
    } catch (error) {
      return {
        statusCode: 500,
        body: { error: error.message }
      };
    }
  },

  // Save a new prompt template
  savePromptTemplate: async (c, req, res) => {
    const { name, context, message } = c.request.requestBody;
    const id = Date.now().toString();
    templates.push({ id, name, context, message });
    return { statusCode: 201, body: { id, name, context, message } };
  },

  // List all prompt templates
  listPromptTemplates: async () => ({
    statusCode: 200,
    body: templates
  }),

  // Save LLM output history
  saveLLMHistory: async (c, req, res) => {
    const { prompt, output } = c.request.requestBody;
    const id = Date.now().toString();
    history.push({ id, prompt, output, timestamp: new Date().toISOString() });
    return { statusCode: 201, body: { id } };
  },

  // List LLM output history
  listLLMHistory: async () => ({
    statusCode: 200,
    body: history
  }),

  countTokens: async (c, req, res) => {
    try {
      const { text } = c.request.requestBody;
      if (!text) {
        return { statusCode: 400, body: { error: 'Text is required' } };
      }
      // Simple token count: split by whitespace
      const tokenCount = text.trim().split(/\s+/).length;
      return { statusCode: 200, body: { tokenCount } };
    } catch (error) {
      return { statusCode: 500, body: { error: error.message } };
    }
  },

  // New handler for method creation automation
  generateMethod: async (c, req, res) => {
    try {
      const { userPrompt, methodName, namespaceName } = c.request.requestBody;
      if (!userPrompt || !methodName) {
        return { statusCode: 400, body: { error: 'User prompt and method name are required' } };
      }

      const systemPrompt = `You are an expert API method generator. Based on the user's description, generate a comprehensive method configuration that includes:

1. Request schema (if applicable)
2. Response schema
3. Method configuration (HTTP method, path, description)
4. Lambda handler code
5. Parameter validation

Return ONLY a valid JSON object with this structure:
{
  "methodConfig": {
    "method": "GET|POST|PUT|DELETE",
    "path": "/api/endpoint",
    "description": "Description of what this method does",
    "parameters": [
      {
        "name": "paramName",
        "type": "string|number|boolean|object",
        "required": true,
        "description": "Parameter description"
      }
    ]
  },
  "requestSchema": { /* JSON schema for request body */ },
  "responseSchema": { /* JSON schema for response body */ },
  "lambdaHandler": "/* JavaScript code for Lambda handler */",
  "methodName": "The method name"
}

Do not include any explanations, markdown, or code fences - just the JSON object.`;

      const fullPrompt = `${systemPrompt}\n\nUser Request: ${userPrompt}\nMethod Name: ${methodName}\nNamespace: ${namespaceName || 'Default'}`;

      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-3-5-sonnet-20240620',
          max_tokens: 4096,
          messages: [{ role: 'user', content: fullPrompt }]
        },
        {
          headers: {
            'x-api-key': CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          }
        }
      );

      let llm_output = response.data.content[0].text;
      
      // Extract JSON from the response
      const jsonMatch = llm_output.match(/({[\s\S]*})/);
      if (jsonMatch) {
        llm_output = jsonMatch[1];
      }

      try {
        const parsed = JSON.parse(llm_output);
        return {
          statusCode: 200,
          body: {
            success: true,
            data: parsed,
            raw_output: llm_output
          }
        };
      } catch (parseError) {
        return {
          statusCode: 200,
          body: {
            success: false,
            error: 'Failed to parse LLM response as JSON',
            raw_output: llm_output
          }
        };
      }
    } catch (error) {
      return {
        statusCode: 500,
        body: { error: error.message }
      };
    }
  },

  // New handler for fetching methods from external namespaces using AI agents
  fetchExternalNamespaceMethods: async (c, req, res) => {
    try {
      const { namespaceUrl, namespaceName, userPrompt } = c.request.requestBody;
      if (!namespaceUrl || !namespaceName) {
        return { statusCode: 400, body: { error: 'Namespace URL and name are required' } };
      }

      // Step 1: Actually fetch the API documentation content
      let apiContent = '';
      let contentType = 'unknown';
      
      try {
        // Try to fetch the URL content
        const response = await axios.get(namespaceUrl, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; API-Analyzer/1.0)'
          }
        });
        
        const content = response.data;
        const contentType = response.headers['content-type'] || '';
        
        // Determine content type and extract accordingly
        if (contentType.includes('application/json') || namespaceUrl.includes('.json')) {
          // It's a JSON API spec
          apiContent = JSON.stringify(content, null, 2);
          contentType = 'json';
        } else if (contentType.includes('text/yaml') || contentType.includes('application/x-yaml') || namespaceUrl.includes('.yaml') || namespaceUrl.includes('.yml')) {
          // It's a YAML API spec
          apiContent = content;
          contentType = 'yaml';
        } else if (contentType.includes('text/html')) {
          // It's HTML documentation - extract API content
          apiContent = await handlers.extractAPIFromHTML(content, namespaceUrl);
          contentType = 'html';
        } else {
          // Try to parse as text
          apiContent = content;
          contentType = 'text';
        }
        
      } catch (fetchError) {
        console.error('Error fetching URL:', fetchError.message);
        // Fallback: ask LLM to analyze based on URL and common knowledge
        apiContent = `Unable to fetch content from ${namespaceUrl}. Please analyze this API based on common knowledge and typical REST API patterns.`;
        contentType = 'fallback';
      }

      // Step 2: Send the actual content to LLM for analysis
      const systemPrompt = `You are an expert API analyzer. Analyze the provided API documentation and extract all available methods.

Instructions:
1. Parse the API documentation content provided
2. Extract all HTTP endpoints/methods with their details
3. Generate schemas for request/response bodies where possible
4. Provide comprehensive documentation for each method
5. Focus on REST API endpoints and their functionality

Content Type: ${contentType}
Original URL: ${namespaceUrl}

Return ONLY a valid JSON object with this structure:
{
  "namespace": {
    "name": "namespace name",
    "url": "original URL",
    "description": "description of the API"
  },
  "methods": [
    {
      "method": "GET|POST|PUT|DELETE",
      "path": "/api/endpoint",
      "description": "Method description",
      "parameters": [
        {
          "name": "paramName",
          "type": "string|number|boolean|object",
          "required": true,
          "description": "Parameter description"
        }
      ],
      "requestSchema": { /* JSON schema if available */ },
      "responseSchema": { /* JSON schema if available */ }
    }
  ],
  "schemas": [
    {
      "name": "schema name",
      "schema": { /* JSON schema */ }
    }
  ],
  "summary": "Brief summary of the API capabilities"
}

Do not include any explanations, markdown, or code fences - just the JSON object.`;

      const fullPrompt = `${systemPrompt}\n\nAPI Documentation Content:\n${apiContent.substring(0, 8000)}\n\nAnalysis Instructions: ${userPrompt || 'Analyze and extract all available methods'}`;

      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-3-5-sonnet-20240620',
          max_tokens: 4096,
          messages: [{ role: 'user', content: fullPrompt }]
        },
        {
          headers: {
            'x-api-key': CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          }
        }
      );

      let llm_output = response.data.content[0].text;
      
      // Extract JSON from the response
      const jsonMatch = llm_output.match(/({[\s\S]*})/);
      if (jsonMatch) {
        llm_output = jsonMatch[1];
      }

      try {
        const parsed = JSON.parse(llm_output);
        return {
          statusCode: 200,
          body: {
            success: true,
            data: parsed,
            raw_output: llm_output,
            content_type: contentType,
            original_url: namespaceUrl,
            content_preview: apiContent.substring(0, 500) + '...'
          }
        };
      } catch (parseError) {
        return {
          statusCode: 200,
          body: {
            success: false,
            error: 'Failed to parse LLM response as JSON',
            raw_output: llm_output
          }
        };
      }
    } catch (error) {
      return {
        statusCode: 500,
        body: { error: error.message }
      };
    }
  },

  // Helper function to extract API content from HTML
  extractAPIFromHTML: async (htmlContent, url) => {
    try {
      // Simple HTML parsing to extract API-related content
      const apiPatterns = [
        /GET\s+([^\s]+)/gi,
        /POST\s+([^\s]+)/gi,
        /PUT\s+([^\s]+)/gi,
        /DELETE\s+([^\s]+)/gi,
        /\/api\/[^\s"']+/gi,
        /\/v\d+\/[^\s"']+/gi
      ];
      
      let extractedContent = '';
      
      // Extract text content (remove HTML tags)
      const textContent = htmlContent.replace(/<[^>]*>/g, ' ');
      
      // Find API endpoints
      apiPatterns.forEach(pattern => {
        const matches = textContent.match(pattern);
        if (matches) {
          extractedContent += matches.join('\n') + '\n';
        }
      });
      
      // Extract code blocks that might contain API examples
      const codeBlockPattern = /```[\s\S]*?```/g;
      const codeBlocks = htmlContent.match(codeBlockPattern);
      if (codeBlocks) {
        extractedContent += '\nCode Examples:\n' + codeBlocks.join('\n');
      }
      
      return extractedContent || 'No API content found in HTML. Please analyze based on URL patterns.';
    } catch (error) {
      return 'Error extracting API content from HTML.';
    }
  },

  // New handler for adding selected methods to a namespace
  addMethodsToNamespace: async (c, req, res) => {
    try {
      const { namespaceName, methods, sourceNamespace } = c.request.requestBody;
      if (!namespaceName || !methods || !Array.isArray(methods)) {
        return { statusCode: 400, body: { error: 'Namespace name and methods array are required' } };
      }

      const results = [];
      const errors = [];

      // Import unified handlers to save methods
      const { handlers: unifiedHandlers } = await import('./unified-handlers.js');

      // First, check if namespace exists, if not create it
      let namespaceExists = false;
      try {
        const namespaces = await unifiedHandlers.getNamespaces();
        namespaceExists = namespaces.body.some(ns => ns['namespace-name'] === namespaceName);
      } catch (error) {
        console.log('Error checking namespace existence:', error.message);
      }

      // Create namespace if it doesn't exist
      if (!namespaceExists) {
        try {
          await unifiedHandlers.createNamespace({
            request: {
              requestBody: {
                'namespace-name': namespaceName,
                'namespace-description': `Namespace created from external API: ${sourceNamespace}`,
                'namespace-base-url': '',
                'namespace-version': '1.0.0'
              }
            }
          }, {}, {});
          console.log(`Created new namespace: ${namespaceName}`);
        } catch (createError) {
          console.error('Error creating namespace:', createError.message);
          errors.push({
            type: 'namespace_creation',
            error: createError.message
          });
        }
      }

      // Process each selected method
      for (const method of methods) {
        try {
          // Generate a unique method ID
          const methodId = `${namespaceName}-${method.method.toLowerCase()}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          
          // Prepare method data for the unified API
          const methodData = {
            'namespace-method-id': methodId,
            'namespace-method-name': method.path.split('/').pop() || method.method.toLowerCase(),
            'namespace-method-type': method.method,
            'namespace-method-path': method.path,
            'namespace-method-description': method.description || `Method from ${sourceNamespace}`,
            'namespace-method-parameters': method.parameters || [],
            'namespace-method-request-schema': method.requestSchema || {},
            'namespace-method-response-schema': method.responseSchema || {},
            'namespace-method-source': sourceNamespace,
            'namespace-method-imported-at': new Date().toISOString(),
            'namespace-id': namespaceName // This will be used to link to the namespace
          };

          // Save the method using unified handlers
          const saveResult = await unifiedHandlers.createNamespaceMethod({
            request: {
              requestBody: methodData
            }
          }, {}, {});

          if (saveResult.statusCode === 200 || saveResult.statusCode === 201) {
            results.push({
              methodId,
              methodName: methodData['namespace-method-name'],
              methodType: methodData['namespace-method-type'],
              path: methodData['namespace-method-path'],
              status: 'saved',
              namespaceId: namespaceName
            });
          } else {
            errors.push({
              method: method.path,
              error: saveResult.body?.error || 'Failed to save method'
            });
          }

        } catch (methodError) {
          console.error('Error saving method:', methodError.message);
          errors.push({
            method: method.path,
            error: methodError.message
          });
        }
      }

      // Update namespace with imported methods count
      try {
        const currentMethods = await unifiedHandlers.getNamespaceMethods({
          request: {
            requestBody: { namespaceId: namespaceName }
          }
        }, {}, {});

        const totalMethods = currentMethods.body?.length || 0;
        
        // Update namespace metadata
        await unifiedHandlers.updateNamespace({
          request: {
            requestBody: {
              'namespace-id': namespaceName,
              'namespace-name': namespaceName,
              'namespace-description': `Namespace with ${totalMethods} methods (${results.length} imported from ${sourceNamespace})`,
              'namespace-imported-methods': results.length,
              'namespace-last-updated': new Date().toISOString()
            }
          }
        }, {}, {});

      } catch (updateError) {
        console.error('Error updating namespace:', updateError.message);
      }

      return {
        statusCode: 200,
        body: {
          success: true,
          data: {
            namespaceName,
            addedMethods: results,
            errors,
            totalMethods: methods.length,
            successfulAdds: results.length,
            failedAdds: errors.length,
            namespaceCreated: !namespaceExists
          }
        }
      };
    } catch (error) {
      console.error('Error in addMethodsToNamespace:', error.message);
      return {
        statusCode: 500,
        body: { error: error.message }
      };
    }
  },

  // New handler for importing methods from external API
  importMethodsFromExternalAPI: async (c, req, res) => {
    try {
      const { url, targetNamespaceName } = c.request.requestBody;
      if (!url) {
        return { statusCode: 400, body: { error: 'URL is required' } };
      }

      const result = await importMethodsFromExternalAPI(url, targetNamespaceName || 'Imported API');
      
      if (result.success) {
        return {
          statusCode: 200,
          body: result
        };
      } else {
        return {
          statusCode: 400,
          body: result
        };
      }
    } catch (error) {
      return {
        statusCode: 500,
        body: { error: error.message }
      };
    }
  },
};

// Helper function to fetch and analyze API content
const fetchAndAnalyzeAPIContent = async (url) => {
  try {
    console.log(`Fetching content from: ${url}`);
    
    // Normalize URL for common API documentation sites
    let normalizedUrl = url;
    if (url.includes('shopify.com') && !url.includes('shopify.dev')) {
      normalizedUrl = url.replace('shopify.com', 'shopify.dev/api');
    }
    
    const response = await axios.get(normalizedUrl, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    const contentType = response.headers['content-type'] || '';
    const contentLength = response.data ? response.data.length : 0;
    
    console.log(`Content fetched: ${contentLength} bytes, type: ${contentType}`);

    // Extract content based on type
    let extractedContent = '';
    
    if (contentType.includes('application/json')) {
      // JSON API spec
      extractedContent = JSON.stringify(response.data, null, 2);
    } else if (contentType.includes('application/yaml') || contentType.includes('text/yaml')) {
      // YAML API spec
      extractedContent = response.data;
    } else if (contentType.includes('text/html')) {
      // HTML documentation - extract text content
      const htmlContent = response.data;
      
      // Simple HTML to text extraction (you might want to use a proper HTML parser)
      extractedContent = htmlContent
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    } else {
      // Plain text or other formats
      extractedContent = response.data;
    }

    return {
      success: true,
      content: extractedContent,
      contentType,
      contentLength,
      url: normalizedUrl
    };

  } catch (error) {
    console.error('Error fetching API content:', error);
    return {
      success: false,
      error: `Failed to fetch content: ${error.message}`,
      url
    };
  }
};

// Helper function to extract methods from content using LLM
const extractMethodsFromContent = async (content, sourceUrl) => {
  try {
    console.log('Extracting methods from content using LLM...');
    
    const systemPrompt = `You are an expert API analyzer. Extract all API methods/endpoints from the provided API documentation or specification.

Return ONLY a valid JSON array of method objects with this structure:
[
  {
    "name": "Method name (e.g., Get User, Create Order)",
    "httpMethod": "GET|POST|PUT|DELETE|PATCH",
    "endpoint": "/api/endpoint/path",
    "description": "Description of what this endpoint does",
    "queryParams": [
      { "name": "param1", "type": "string", "required": true, "description": "Parameter description" }
    ],
    "headers": [
      { "name": "Authorization", "type": "string", "required": true, "description": "Bearer token" }
    ],
    "requestSchema": { /* JSON schema for request body if applicable */ },
    "responseSchema": { /* JSON schema for response body */ },
    "sampleRequest": { /* sample request object if applicable */ },
    "sampleResponse": { /* sample response object */ },
    "tags": ["tag1", "tag2"]
  }
]

Focus on extracting:
1. All HTTP endpoints with their methods
2. Request/response schemas where available
3. Query parameters and headers
4. Sample data where provided
5. Proper descriptions and tags

Do not include any explanations, markdown, or code fences - just the JSON array.`;

    const fullPrompt = `${systemPrompt}\n\nSource URL: ${sourceUrl}\n\nAPI Content:\n${content.substring(0, 15000)}`; // Limit content length

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: 4096,
        messages: [{ role: 'user', content: fullPrompt }]
      },
      {
        headers: {
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      }
    );

    let llm_output = response.data.content[0].text;
    // Remove code fences if present
    llm_output = llm_output.replace(/```[a-zA-Z]*\n([\s\S]*?)```/g, '$1');
    // Try to extract JSON array from the response
    let jsonMatch = llm_output.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      // Try to extract JSON object if array not found
      jsonMatch = llm_output.match(/({[\s\S]*})/);
    }
    if (jsonMatch) {
      llm_output = jsonMatch[0];
    }
    
    console.log('Raw LLM output length:', llm_output.length);
    console.log('Raw LLM output preview:', llm_output.substring(0, 200) + '...');
    
    // Try to fix common JSON issues
    let fixed = llm_output
      .replace(/,\s*([}\]])/g, '$1') // Remove trailing commas
      .replace(/\n/g, ' ') // Remove newlines
      .replace(/\r/g, '') // Remove carriage returns
      .replace(/\t/g, ' ') // Replace tabs with spaces
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .trim();
    
    // Use jsonrepair to fix malformed JSON
    try {
      console.log('Attempting jsonrepair...');
      fixed = jsonrepair(fixed);
      console.log('jsonrepair successful, length:', fixed.length);
    } catch (repairError) {
      console.error('jsonrepair failed:', repairError.message);
      console.log('Attempting manual JSON repair...');
      
      // Manual repair attempts
      try {
        // Try to find the largest valid JSON structure
        const jsonStart = fixed.indexOf('[');
        const jsonEnd = fixed.lastIndexOf(']');
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          fixed = fixed.substring(jsonStart, jsonEnd + 1);
        }
        
        // Try to fix common issues
        fixed = fixed
          .replace(/,\s*([}\]])/g, '$1') // Remove trailing commas
          .replace(/,\s*,/g, ',') // Remove double commas
          .replace(/,\s*}/g, '}') // Remove trailing commas before closing braces
          .replace(/,\s*]/g, ']'); // Remove trailing commas before closing brackets
          
        console.log('Manual repair completed');
      } catch (manualError) {
        console.error('Manual repair failed:', manualError.message);
      }
    }
    
    try {
      const parsed = JSON.parse(fixed);
      console.log('JSON parsing successful, found', Array.isArray(parsed) ? parsed.length : 1, 'methods');
      return {
        success: true,
        methods: Array.isArray(parsed) ? parsed : [parsed]
      };
    } catch (parseError) {
      console.error('Failed to parse LLM response:', parseError.message);
      console.error('Parse error at position:', parseError.message.match(/position (\d+)/)?.[1] || 'unknown');
      // Log the raw output for debugging
      console.error('Raw LLM output:', llm_output);
      console.error('Fixed output:', fixed);
      return {
        success: false,
        error: 'Failed to parse LLM response as JSON',
        raw_output: llm_output
      };
    }
  } catch (error) {
    console.error('Error extracting methods:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Helper function to import methods from external API
const importMethodsFromExternalAPI = async (url, targetNamespaceName) => {
  try {
    console.log(`Starting import from: ${url}`);
    
    // Step 1: Fetch and analyze API documentation
    const contentAnalysis = await fetchAndAnalyzeAPIContent(url);
    
    if (!contentAnalysis.success) {
      return {
        success: false,
        error: contentAnalysis.error
      };
    }

    // Step 2: Extract methods using LLM
    const extractedMethods = await extractMethodsFromContent(contentAnalysis.content, url);
    
    if (!extractedMethods.success) {
      return {
        success: false,
        error: extractedMethods.error
      };
    }

    // Step 3: Create namespace if it doesn't exist
    let namespaceId;
    try {
      const namespaceData = {
        'namespace-name': targetNamespaceName,
        'namespace-url': url,
        'tags': ['imported', 'external-api']
      };
      
      const createdNamespace = await createNamespace(namespaceData);
      namespaceId = createdNamespace['namespace-id'];
      console.log(`Created namespace: ${namespaceId}`);
    } catch (error) {
      console.error('Error creating namespace:', error);
      return {
        success: false,
        error: `Failed to create namespace: ${error.message}`
      };
    }

    // Step 4: Save methods to the namespace
    const savedMethods = [];
    const failedMethods = [];

    for (const method of extractedMethods.methods) {
      try {
        const methodData = {
          'namespace-method-name': method.name,
          'namespace-method-type': method.httpMethod,
          'namespace-method-url-override': method.endpoint,
          'namespace-method-queryParams': method.queryParams || [],
          'namespace-method-header': method.headers || [],
          'save-data': false,
          'isInitialized': false,
          'tags': method.tags || [],
          'sample-request': method.sampleRequest || null,
          'sample-response': method.sampleResponse || null,
          'request-schema': method.requestSchema || null,
          'response-schema': method.responseSchema || null
        };

        const savedMethod = await createNamespaceMethod(namespaceId, methodData);
        savedMethods.push(savedMethod);
        console.log(`Saved method: ${method.name}`);
      } catch (error) {
        console.error(`Failed to save method ${method.name}:`, error);
        failedMethods.push({
          method: method.name,
          error: error.message
        });
      }
    }

    return {
      success: true,
      namespaceId,
      namespaceName: targetNamespaceName,
      totalMethods: extractedMethods.methods.length,
      savedMethods: savedMethods.length,
      failedMethods: failedMethods.length,
      failedMethodDetails: failedMethods,
      contentAnalysis: {
        contentType: contentAnalysis.contentType,
        contentLength: contentAnalysis.contentLength,
        url: contentAnalysis.url
      },
      extractedMethods: extractedMethods.methods
    };

  } catch (error) {
    console.error('Import error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}; 