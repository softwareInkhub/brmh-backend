import { Anthropic } from '@anthropic-ai/sdk';
import { ChatAnthropic } from "@langchain/anthropic";
import { RunnableSequence } from "@langchain/core/runnables";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";
import yaml from 'js-yaml';
import { handlers as unifiedHandlers } from './unified-handlers.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// LangChain Claude instance
const chat = new ChatAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: "claude-3-5-sonnet-20240620"
});

// Helper function to get real namespace data
async function getRealNamespaceData(namespaceId) {
  try {
    // Get all schemas
    const schemasResult = await unifiedHandlers.listSchemas({ request: {} }, {}, {});
    const schemas = schemasResult?.body || [];
    
    // Get namespace methods
    const methodsResult = await unifiedHandlers.getNamespaceMethods({ 
      request: { params: { namespaceId } } 
    }, {}, {});
    const methods = methodsResult?.body || [];
    
    // Get namespace info
    const namespacesResult = await unifiedHandlers.getNamespaces({ request: {} }, {}, {});
    const namespaces = namespacesResult?.body || [];
    const namespaceInfo = namespaces.find(ns => ns.namespaceId === namespaceId);
    
    return {
      schemas,
      methods,
      namespaceInfo
    };
  } catch (error) {
    console.warn(`[Agent] Failed to get real namespace data:`, error.message);
    return { schemas: [], methods: [], namespaceInfo: null };
  }
}

function extractFieldsFromText(text) {
  const fieldLines = text.match(/(?:^|\n)(?:\d+\.|\-|\*)\s*([\w\s]+)(?:\((\w+)\)|: (\w+))?/g);
  if (!fieldLines || fieldLines.length < 2) return null;
  return fieldLines.map(line => line.replace(/(?:^|\n)(?:\d+\.|\-|\*)\s*/, '').trim());
}

function extractAllJSONCodeBlocks(text) {
  // Extract all code blocks (```json ... ``` or ``` ... ```)
  const regex = /```(?:json)?\s*([\s\S]+?)```/gi;
  let match;
  const blocks = [];
  while ((match = regex.exec(text)) !== null) {
    try {
      const json = JSON.parse(match[1]);
      blocks.push(json);
    } catch {
      // Ignore parse errors
    }
  }
  
  // Also try to extract JSON objects that might not be in code blocks
  const jsonObjectRegex = /\{[\s\S]*?"openapi"[\s\S]*?"paths"[\s\S]*?\}/g;
  while ((match = jsonObjectRegex.exec(text)) !== null) {
    try {
      const json = JSON.parse(match[0]);
      if (isValidOpenApiObject(json)) {
        blocks.push(json);
      }
    } catch {
      // Ignore parse errors
    }
  }
  
  return blocks;
}

function isSchemaJson(json) {
  return json && typeof json === 'object' && (json.type === 'object' || json.properties);
}

function isApiJson(json) {
  // Accepts either { endpoints: [...] } or a single endpoint object or array
  if (!json || typeof json !== 'object') return false;
  if (Array.isArray(json)) {
    // Array of endpoints
    return json.every(ep => ep.method && ep.path);
  }
  if (Array.isArray(json.endpoints)) {
    return json.endpoints.every(ep => ep.method && ep.path);
  }
  // Single endpoint object
  return json.method && json.path;
}

// --- Extract endpoints from Markdown-style lists ---
function extractApiEndpointsFromText(text) {
  // Look for patterns like:
  // 1. Create an Item\n - Method: POST\n - Endpoint: /items\n - Description: ...
  const endpointBlocks = text.split(/\n\d+\.|\n- /).filter(Boolean);
  const endpoints = [];
  for (const block of endpointBlocks) {
    // Try to extract method, path, and description
    const methodMatch = block.match(/Method:\s*(GET|POST|PUT|DELETE|PATCH)/i);
    const pathMatch = block.match(/Endpoint:\s*([^\s\n]+)/i);
    const descMatch = block.match(/Description:\s*([^\n]+)/i);
    if (methodMatch && pathMatch) {
      endpoints.push({
        method: methodMatch[1].toUpperCase(),
        path: pathMatch[1],
        description: descMatch ? descMatch[1].trim() : ''
      });
    }
  }
  return endpoints.length > 0 ? endpoints : null;
}

// --- New: Infer endpoints from high-level feature lists ---
function pluralize(noun) {
  // Naive pluralization: add 's' unless already ends with 's'
  if (!noun) return '';
  noun = noun.trim().toLowerCase();
  if (noun.endsWith('s')) return noun;
  if (noun.endsWith('y')) return noun.slice(0, -1) + 'ies';
  return noun + 's';
}

function inferApiEndpointsFromFeatures(text) {
  // Look for lines like '- Create a new user', 'Get user profile', etc.
  const lines = text.split(/\n|\r/).map(l => l.trim()).filter(l => l && (l.match(/^(Create|Get|Update|Delete)\b/i)));
  const endpoints = [];
  for (const line of lines) {
    let method = null, path = null, description = line;
    const lower = line.toLowerCase();
    // Extract verb and noun
    const match = line.match(/^(Create|Get|Update|Delete)\s+(?:a|an|the|new)?\s*([\w\-']+)/i);
    if (!match) continue;
    const verb = match[1].toLowerCase();
    let noun = match[2].toLowerCase();
    // Heuristic: pluralize for collection endpoints
    switch (verb) {
      case 'create':
        method = 'POST';
        path = '/' + pluralize(noun);
        break;
      case 'get':
        method = 'GET';
        // If line contains 'profile' or 'board' or 'pin', guess if it's a single or collection
        if (lower.includes('all') || lower.includes('list') || lower.includes('boards') || lower.includes('pins') || lower.includes('users')) {
          path = '/' + pluralize(noun);
        } else {
          path = '/' + pluralize(noun) + '/{id}';
        }
        break;
      case 'update':
        method = 'PUT';
        path = '/' + pluralize(noun) + '/{id}';
        break;
      case 'delete':
        method = 'DELETE';
        path = '/' + pluralize(noun) + '/{id}';
        break;
      default:
        continue;
    }
    endpoints.push({ method, path, description });
  }
  return endpoints.length > 0 ? endpoints : null;
}

function isLikelyApiRequest(text) {
  return /api|endpoint|route|method|get|post|put|delete|patch|resource|path|url/i.test(text);
}

function isLikelySchemaRequest(text) {
  return /schema|field|property|type|object|array/i.test(text);
}

// Tool: Markdown to JSON Schema
async function extractSchemaFromMarkdown(markdown) {
  const prompt = `Convert the following Markdown list to a JSON schema. Only output the JSON.\n\n${markdown}`;
  const outputParser = new JsonOutputParser();
  const chain = RunnableSequence.from([
    chat,
    outputParser
  ]);
  return await chain.invoke(prompt);
}

// Helper: Validate OpenAPI object
function isValidOpenApiObject(obj) {
  return obj && typeof obj === 'object' &&
    typeof obj.openapi === 'string' &&
    typeof obj.info === 'object' &&
    typeof obj.paths === 'object';
}

// Preprocess LLM output to structured endpoint list
function preprocessApiList(llmOutput) {
  const lines = llmOutput.split(/\n|\r/).map(l => l.trim()).filter(l => l);
  const structured = [];
  const methodRegex = /^(GET|POST|PUT|DELETE|PATCH)\b/i;
  for (let line of lines) {
    // If already in structured format, keep as-is
    if (methodRegex.test(line)) {
      structured.push(line);
      continue;
    }
    // Try to infer method and path
    let lower = line.toLowerCase();
    let method = null, path = null, desc = line;
    if (lower.includes('create')) {
      method = 'POST';
      path = '/resource';
    } else if (lower.includes('get') || lower.includes('list') || lower.includes('fetch')) {
      method = 'GET';
      path = lower.includes('all') || lower.includes('list') ? '/resource' : '/resource/{id}';
    } else if (lower.includes('update')) {
      method = 'PUT';
      path = '/resource/{id}';
    } else if (lower.includes('delete') || lower.includes('remove')) {
      method = 'DELETE';
      path = '/resource/{id}';
    }
    if (method && path) {
      structured.push(`${method} ${path} — ${desc}`);
    }
  }
  // If nothing could be structured, fallback to original
  return structured.length > 0 ? structured.join('\n') : llmOutput;
}

// Helper: Extract relevant sections from LLM output
function extractRelevantSections(text) {
  // Extract all code blocks (```...```)
  const codeBlocks = [];
  const codeBlockRegex = /```(?:json|yaml|yml)?\s*([\s\S]*?)```/gi;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    codeBlocks.push(match[1].trim());
  }

  // Extract Markdown lists (lines starting with - or *)
  const listLines = text.split('\n').filter(line => /^[-*]\s+/.test(line.trim()));
  const markdownList = listLines.length > 0 ? listLines.join('\n') : null;

  // Extract Markdown tables (lines with | and --- for header)
  const tableLines = text.split('\n').filter(line => /\|/.test(line));
  const markdownTable = tableLines.length > 1 ? tableLines.join('\n') : null;

  return { codeBlocks, markdownList, markdownTable };
}

function buildPartialOpenApiSpecFromEndpoints(endpoints) {
  const paths = {};
  for (const ep of endpoints) {
    const method = ep.method ? ep.method.toLowerCase() : 'get';
    const path = ep.path || '/default';
    if (!paths[path]) paths[path] = {};
    paths[path][method] = {
      summary: ep.description || `${ep.method} ${ep.path}`,
      responses: {
        "200": {
          description: "Success",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  message: { type: "string" }
                }
              }
            }
          }
        }
      }
    };
  }
  return {
    openapi: "3.0.0",
    info: { title: "Inferred API", version: "1.0.0" },
    paths
  };
}

// Tool: Markdown to OpenAPI JSON (with preprocessing, validation, retry, and YAML-to-JSON conversion)
async function extractOpenApiFromMarkdown(llmOutput) {
  console.log('DEBUG: Extracting OpenAPI from LLM output:', llmOutput);
  
  // First, try to extract any existing OpenAPI JSON from the output
  const jsonBlocks = extractAllJSONCodeBlocks(llmOutput);
  for (const block of jsonBlocks) {
    if (isValidOpenApiObject(block)) {
      console.log('DEBUG: Found valid OpenAPI spec in JSON blocks:', block);
      return block;
    }
  }
  
  // If no valid OpenAPI found in JSON blocks, try to extract from the text
  const openApiMatch = llmOutput.match(/\{[\s\S]*?"openapi"[\s\S]*?"paths"[\s\S]*?\}/);
  if (openApiMatch) {
    try {
      const parsed = JSON.parse(openApiMatch[0]);
      if (isValidOpenApiObject(parsed)) {
        console.log('DEBUG: Found valid OpenAPI spec in text match:', parsed);
        return parsed;
      }
    } catch (error) {
      console.log('DEBUG: Failed to parse OpenAPI match:', error.message);
    }
  }
  
  // If still no valid OpenAPI found, ask Claude to generate one
  console.log('DEBUG: No valid OpenAPI found, asking Claude to generate one');
  
  // Extract resource name and method from the original request
  const deleteMatch = llmOutput.match(/(?:generate|create|make|build)\s+(?:a|an|the)?\s*(delete)\s+(?:api\s+for\s+)?(\w+)/i);
  const resourceMatch = llmOutput.match(/(?:generate|create|make|build)\s+(?:a|an|the)?\s*(?:delete\s+)?(?:api\s+for\s+)?(\w+)/i) || 
                       llmOutput.match(/(\w+)/i);
  
  const resourceName = resourceMatch ? resourceMatch[1].toLowerCase() : 'resource';
  const isDeleteOnly = deleteMatch && deleteMatch[1] === 'delete';
  
  let prompt;
  
  if (isDeleteOnly) {
    prompt = `Generate a DELETE API OpenAPI 3.0 JSON specification for ${resourceName}. 

IMPORTANT: Output ONLY valid JSON, no markdown, no comments, no explanations.

The API should include ONLY:
- DELETE /${resourceName}s/{id} - Delete a ${resourceName}

Include proper parameters and error handling.

Output format:
{
  "openapi": "3.0.0",
  "info": {
    "title": "${resourceName.charAt(0).toUpperCase() + resourceName.slice(1)} Delete API",
    "version": "1.0.0"
  },
  "paths": {
    "/${resourceName}s/{id}": {
      "delete": {
        "summary": "Delete a ${resourceName}",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": { "type": "string" }
          }
        ],
        "responses": {
          "204": {
            "description": "No Content"
          },
          "404": {
            "description": "Not Found",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "error": { "type": "string" }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;
  } else {
    prompt = `Generate a complete OpenAPI 3.0 JSON specification for a ${resourceName} API. 

IMPORTANT: Output ONLY valid JSON, no markdown, no comments, no explanations.

The API should include:
- GET /${resourceName}s - List all ${resourceName}s
- GET /${resourceName}s/{id} - Get a specific ${resourceName}
- POST /${resourceName}s - Create a new ${resourceName}
- PUT /${resourceName}s/{id} - Update a ${resourceName}
- DELETE /${resourceName}s/{id} - Delete a ${resourceName}

Include proper request/response schemas, parameters, and error handling.`;
  }
  const outputParser = new JsonOutputParser();
  let result;
  let rawResult;
  try {
    rawResult = await chat.invoke(prompt);
    console.log('DEBUG: Raw result from Claude:', rawResult);
    let cleanedOutput = rawResult;
    if (rawResult && typeof rawResult === 'object' && rawResult.content) {
      cleanedOutput = rawResult.content;
    }
    cleanedOutput = (typeof cleanedOutput === 'string' ? cleanedOutput : JSON.stringify(cleanedOutput)).trim()
      .replace(/^```(?:json)?/, '')
      .replace(/```$/, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,\s*}/g, '}')
      .replace(/,\s*]/g, ']');
    try {
      result = JSON.parse(cleanedOutput);
    } catch {
      try {
        result = yaml.load(cleanedOutput);
      } catch {}
    }
    console.log('DEBUG: Cleaned and parsed result from Claude:', result);
    if (isValidOpenApiObject(result)) return result;
  } catch (err) {
    console.log('DEBUG: Claude OpenAPI conversion error (first attempt):', err);
    // fall through to retry
  }
  // Fallback prompt
  prompt = `The previous attempt failed. Please output ONLY a valid OpenAPI 3.0 JSON object for the following description. If you are unsure, make reasonable assumptions. No explanations, no markdown, no comments.\n\n${llmOutput}`;
  console.log('DEBUG: Fallback prompt sent to Claude:', prompt);
  try {
    rawResult = await chat.invoke(prompt);
    console.log('DEBUG: Raw result from Claude (fallback):', rawResult);
    let cleanedOutput = rawResult;
    if (rawResult && typeof rawResult === 'object' && rawResult.content) {
      cleanedOutput = rawResult.content;
    }
    cleanedOutput = (typeof cleanedOutput === 'string' ? cleanedOutput : JSON.stringify(cleanedOutput)).trim()
      .replace(/^```(?:json)?/, '')
      .replace(/```$/, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,\s*}/g, '}')
      .replace(/,\s*]/g, ']');
    try {
      result = JSON.parse(cleanedOutput);
    } catch {
      try {
        result = yaml.load(cleanedOutput);
      } catch {}
    }
    console.log('DEBUG: Cleaned and parsed result from Claude (fallback):', result);
    if (isValidOpenApiObject(result)) return result;
  } catch (err) {
    console.log('DEBUG: Claude OpenAPI conversion error (fallback):', err);
    // fall through
  }
  // Try to infer endpoints from LLM output and build a partial OpenAPI spec
  const inferredEndpoints = inferApiEndpointsFromFeatures(llmOutput);
  if (inferredEndpoints && inferredEndpoints.length > 0) {
    console.warn('WARNING: Claude failed, building partial OpenAPI spec from inferred endpoints:', inferredEndpoints);
    return buildPartialOpenApiSpecFromEndpoints(inferredEndpoints);
  }
  // If still not valid, return a fully functional fallback OpenAPI spec
  console.warn('WARNING: Claude failed to generate a valid OpenAPI spec and no endpoints could be inferred. Returning fallback spec. Original Claude output:', rawResult);
  return {
    openapi: "3.0.0",
    info: {
      title: "Generated API",
      version: "1.0.0"
    },
    paths: {
      "/default": {
        get: {
          summary: "Default GET endpoint",
          responses: {
            "200": {
              description: "Success",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      message: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  };
}

function detectSchemaIntent(message) {
  const schemaKeywords = [
    'schema', 'json', 'field', 'property', 'object', 'add', 'remove', 'edit', 'update', 'type', 'structure'
  ];
  const lower = message.toLowerCase();
  return schemaKeywords.some(kw => lower.includes(kw));
}

export const agentSystem = {
  async handleStreamingWithAgents(res, namespace, message, history = [], schema = null) {
    const namespaceId = typeof namespace === 'object' && namespace !== null ? namespace.id : namespace;
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    let llmBuffer = '';
    const isSchemaIntent = detectSchemaIntent(message);

    // Gather namespace context
    let namespaceContext = '';
    if (namespaceId) {
      try {
        // Get real data from the actual tables
        const { schemas: nsSchemas, methods: nsApis, namespaceInfo } = await getRealNamespaceData(namespaceId);
        // You may want to add accounts and webhooks if available
        // For now, we'll just use schemas and APIs
        namespaceContext = `Current namespace: ${namespaceInfo?.['namespace-name'] || 'Unknown'}\nNamespace ID: ${namespaceId}`;
        namespaceContext += `\nAvailable schemas: ${nsSchemas.map(s => s.schemaName).join(', ') || 'None'}`;
        namespaceContext += `\nAvailable APIs: ${nsApis.map(m => m['namespace-method-name'] || m.methodName).join(', ') || 'None'}`;
        // Add accounts and webhooks if you have them
      } catch (err) {
        namespaceContext = `Current namespace ID: ${namespaceId} (context lookup failed)`;
      }
    }

    let systemPrompt;
    if (isSchemaIntent && schema) {
      systemPrompt = `You are an expert JSON Schema editor.\n${namespaceContext}\nHere is the current schema:\n${JSON.stringify(schema, null, 2)}\n\nUser instruction: ${message}\n\nONLY output the updated JSON schema, and nothing else. Do not generate a new schema from scratch—modify the existing one.`;
    } else if (isSchemaIntent) {
      systemPrompt = `You are an expert JSON Schema generator.\n${namespaceContext}\nONLY output a valid JSON schema object, and nothing else. Do not include any explanations, comments, or conversational text. If you cannot generate a schema, output {}.`;
    } else {
      systemPrompt = `You are a helpful AI assistant for the BRMH platform.\n${namespaceContext}\nAnswer the user's questions conversationally, using the above context if relevant.`;
    }

    try {
      const messages = [
        { role: 'user', content: systemPrompt },
        ...history.slice(-10),
        { role: 'user', content: message }
      ];

      const stream = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: 4000,
        messages: messages,
        stream: true,
      });

      // Stream the response
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta') {
          const content = chunk.delta.text;
          llmBuffer += content;
          res.write(`data: ${JSON.stringify({ content, type: 'chat', route: isSchemaIntent ? 'schema' : 'chat' })}\n\n`);
        }
      }

      if (isSchemaIntent) {
        // Use LangChain's JsonOutputParser to robustly extract the first valid JSON object
        try {
          const outputParser = new JsonOutputParser();
          const parsed = await outputParser.parse(llmBuffer);
          if (parsed && (parsed.properties || parsed.type)) {
            res.write(`data: ${JSON.stringify({ actions: [{ type: 'generate_schema', status: 'complete', data: parsed }], type: 'actions', route: 'schema' })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ actions: [{ type: 'error', status: 'failed', message: 'No valid schema found in LLM output.' }], type: 'actions', route: 'schema' })}\n\n`);
          }
        } catch (err) {
          res.write(`data: ${JSON.stringify({ actions: [{ type: 'error', status: 'failed', message: 'Schema extraction error: ' + err.message }], type: 'actions', route: 'schema' })}\n\n`);
        }
      }
    } catch (error) {
      res.write(`data: ${JSON.stringify({ actions: [{ type: 'error', status: 'failed', message: error.message }], type: 'actions', route: isSchemaIntent ? 'schema' : 'chat' })}\n\n`);
    } finally {
      res.end();
    }
  }
}; 