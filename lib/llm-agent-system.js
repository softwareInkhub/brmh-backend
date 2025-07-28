import { Anthropic } from '@anthropic-ai/sdk';
import { ChatAnthropic } from "@langchain/anthropic";
import { RunnableSequence } from "@langchain/core/runnables";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";
import yaml from 'js-yaml';
import { handlers as unifiedHandlers } from './unified-handlers.js';
import { docClient } from './dynamodb-client.js';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamicStructuredTool } from "@langchain/core/tools";
import { initializeAgentExecutorWithOptions } from "langchain/agents";

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
    // Get all schemas for the namespace
    const schemasResult = await docClient.send(new ScanCommand({
      TableName: 'brmh-schemas',
      FilterExpression: 'namespaceId = :nsid',
      ExpressionAttributeValues: { ':nsid': namespaceId }
    }));
    const schemas = schemasResult.Items || [];

    // Get namespace methods for the namespace
    const methodsResult = await docClient.send(new ScanCommand({
      TableName: 'brmh-namespace-methods',
      FilterExpression: '#data.#nsid = :namespaceId',
      ExpressionAttributeNames: { '#data': 'data', '#nsid': 'namespace-id' },
      ExpressionAttributeValues: { ':namespaceId': namespaceId }
    }));
    const methods = (methodsResult.Items || []).map(item => item.data);

    // Get namespace info directly by id
    let namespaceInfo = null;
    try {
      const nsResult = await docClient.send(new GetCommand({
        TableName: 'brmh-namespace',
        Key: { id: namespaceId }
      }));
      namespaceInfo = nsResult.Item ? nsResult.Item.data : null;
      console.log('Direct GetCommand namespaceInfo:', namespaceInfo);
      // Fallback: scan all items and match on data['namespace-id'] if direct get fails
      if (!namespaceInfo) {
        const scanResult = await docClient.send(new ScanCommand({ TableName: 'brmh-namespace' }));
        const allNamespaces = (scanResult.Items || []).map(item => item.data);
        namespaceInfo = allNamespaces.find(ns => ns['namespace-id'] === namespaceId);
        console.log('Fallback scan namespaceInfo:', namespaceInfo);
      }
    } catch (e) { namespaceInfo = null; }

    // Build the main namespace context immediately after fetching namespaceInfo
    let namespaceContext = namespaceInfo
      ? `Current namespace: ${namespaceInfo['namespace-name'] || 'Unknown'}\nNamespace ID: ${namespaceInfo['namespace-id'] || namespaceId}`
      : `Current namespace: Unknown\nNamespace ID: ${namespaceId} (context lookup failed)`;

    // Get webhooks for the namespace (if table exists)
    let webhooks = [];
    try {
      const webhooksResult = await docClient.send(new ScanCommand({
        TableName: 'brmh-webhooks',
        FilterExpression: 'namespaceId = :nsid',
        ExpressionAttributeValues: { ':nsid': namespaceId }
      }));
      webhooks = webhooksResult.Items || [];
    } catch (e) { /* Table may not exist, ignore */ }

    // Get accounts for the namespace (if table exists)
    let accounts = [];
    try {
      const accountsResult = await docClient.send(new ScanCommand({
        TableName: 'brmh-namespace-accounts',
        FilterExpression: 'namespace-id = :nsid',
        ExpressionAttributeValues: { ':nsid': namespaceId }
      }));
      accounts = accountsResult.Items || [];
    } catch (e) { /* Table may not exist, ignore */ }

    // Append details to the context
    namespaceContext += `\nAvailable schemas: ${schemas.map(s => s.schemaName).join(', ') || 'None'}`;
    namespaceContext += `\nAvailable APIs: ${methods.map(m => m['namespace-method-name'] || m.methodName).join(', ') || 'None'}`;
    namespaceContext += `\nAvailable webhooks: ${webhooks.map(w => w.webhookName || w.name).join(', ') || 'None'}`;
    namespaceContext += `\nAvailable accounts: ${accounts.map(a => a.accountName || a.name).join(', ') || 'None'}`;
    namespaceContext += `\n\n---\nSchemas detail:\n${JSON.stringify(schemas, null, 2)}`;
    namespaceContext += `\n\n---\nMethods detail:\n${JSON.stringify(methods, null, 2)}`;
    namespaceContext += `\n\n---\nWebhooks detail:\n${JSON.stringify(webhooks, null, 2)}`;
    namespaceContext += `\n\n---\nAccounts detail:\n${JSON.stringify(accounts, null, 2)}`;

    return {
      schemas,
      methods,
      namespaceInfo,
      webhooks,
      accounts
    };
  } catch (error) {
    console.warn(`[Agent] Failed to get real namespace data:`, error.message);
    return { schemas: [], methods: [], namespaceInfo: null, webhooks: [], accounts: [] };
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

// More robust intent detection for schema generation
function isExplicitSchemaGenerationIntent(message) {
  const lower = message.toLowerCase();
  
  // Enhanced detection patterns
  const generationPatterns = [
    /generate\s+(?:a\s+)?(?:new\s+)?(?:json\s+)?schema/i,
    /create\s+(?:a\s+)?(?:new\s+)?(?:json\s+)?schema/i,
    /make\s+(?:a\s+)?(?:new\s+)?(?:json\s+)?schema/i,
    /build\s+(?:a\s+)?(?:new\s+)?(?:json\s+)?schema/i,
    /generate\s+(?:a\s+)?(?:new\s+)?(?:jeans|pant|product|item|data)\s+(?:schema|structure)/i,
    /create\s+(?:a\s+)?(?:new\s+)?(?:jeans|pant|product|item|data)\s+(?:schema|structure)/i,
    /generate\s+(?:a\s+)?(?:new\s+)?(?:mock\s+)?data/i,
    /create\s+(?:a\s+)?(?:new\s+)?(?:mock\s+)?data/i,
    /generate\s+(?:a\s+)?(?:new\s+)?(?:json\s+)?structure/i,
    /create\s+(?:a\s+)?(?:new\s+)?(?:json\s+)?structure/i
  ];
  
  // Check for explicit generation keywords
  const generationKeywords = [
    'generate a schema', 'create a schema', 'generate schema', 'create schema',
    'generate new schema', 'create new schema', 'generate json schema', 'create json schema',
    'generate a new schema', 'create a new schema', 'generate a new json schema', 'create a new json schema',
    'generate mock data', 'create mock data', 'generate data', 'create data',
    'generate structure', 'create structure', 'generate json structure', 'create json structure'
  ];
  
  // Check for product-specific generation
  const productGeneration = [
    /generate\s+(?:a\s+)?(?:new\s+)?(?:jeans|pant|product|item)\s+(?:schema|structure)/i,
    /create\s+(?:a\s+)?(?:new\s+)?(?:jeans|pant|product|item)\s+(?:schema|structure)/i
  ];
  
  // Check patterns
  const matchesPatterns = generationPatterns.some(pattern => pattern.test(lower));
  const matchesKeywords = generationKeywords.some(keyword => lower.includes(keyword));
  const matchesProduct = productGeneration.some(pattern => pattern.test(lower));
  
  console.log('[Intent Detection]', {
    message: lower,
    matchesPatterns,
    matchesKeywords,
    matchesProduct,
    result: matchesPatterns || matchesKeywords || matchesProduct
  });
  
  return matchesPatterns || matchesKeywords || matchesProduct;
}

function detectSchemaIntent(message) {
  const schemaKeywords = [
    'schema', 'json', 'field', 'property', 'object', 'add', 'remove', 'edit', 'update', 'type', 'structure',
    'generate', 'create', 'make', 'build', 'new', 'mock', 'data'
  ];
  const lower = message.toLowerCase();
  return schemaKeywords.some(kw => lower.includes(kw));
}

// Tool: Generate JSON Schema from user description
const generateSchemaTool = new DynamicStructuredTool({
  name: "generate_schema",
  description: "Generate a JSON schema from a user description or requirements.",
  schema: z.object({
    description: z.string().describe("A detailed description of the schema to generate")
  }),
  func: async ({ description }) => {
    console.log('[Schema Tool] Generating schema for:', description);
    
    const enhancedPrompt = `You are an expert JSON Schema designer. Generate a comprehensive JSON schema based on the following requirements.

Requirements: ${description}

Instructions:
1. Create a complete, valid JSON schema with appropriate properties
2. Include proper data types, descriptions, and validation rules
3. Add example data where appropriate
4. Make the schema production-ready and well-documented
5. Include common fields like id, name, description, created_at, updated_at where relevant
6. For product schemas, include fields like price, category, tags, images, etc.
7. For data schemas, include proper validation and constraints

Output ONLY the JSON schema, no explanations or markdown formatting.`;

    try {
      // First try with JsonOutputParser
      const outputParser = new JsonOutputParser();
      const chain = RunnableSequence.from([chat, outputParser]);
      const schema = await chain.invoke(enhancedPrompt);
      console.log('[Schema Tool] Generated schema:', schema);
      return JSON.stringify(schema);
    } catch (error) {
      console.log('[Schema Tool] JsonOutputParser failed, trying string output:', error.message);
      
      // Fallback to string output and extract JSON
      const response = await chat.invoke(enhancedPrompt);
      let content = response.content || '';
      
      // Extract JSON from code blocks
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/i) || 
                       content.match(/```\s*([\s\S]*?)\s*```/i) ||
                       content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        try {
          const jsonStr = jsonMatch[1] || jsonMatch[0];
          const parsed = JSON.parse(jsonStr);
          console.log('[Schema Tool] Extracted schema from code block:', parsed);
          return JSON.stringify(parsed);
        } catch (parseError) {
          console.log('[Schema Tool] JSON parsing failed:', parseError.message);
          throw new Error('Failed to generate valid JSON schema');
        }
      } else {
        console.log('[Schema Tool] No JSON found in response');
        throw new Error('No valid JSON schema found in response');
      }
    }
  }
});

let agentExecutorPromise = null;
async function getAgentExecutor() {
  if (!agentExecutorPromise) {
    agentExecutorPromise = initializeAgentExecutorWithOptions([generateSchemaTool], chat, {
      agentType: "openai-functions", // works for function-calling agents
      verbose: true,
    });
  }
  return agentExecutorPromise;
}

// Lambda codegen handler for LLM-powered Lambda generation
export async function handleLambdaCodegen({ message, selectedSchema, functionName, runtime, handler, memory, timeout, environment }) {
  console.log('[LLM Agent] Lambda codegen request:', { message, selectedSchema, functionName, runtime, handler, memory, timeout, environment });

  // Optimized prompt: instruct LLM to ONLY output code, no explanation
  let prompt = `You are an expert AWS Lambda developer.\n`;
  prompt += `Generate a complete AWS Lambda handler for the following request.\n`;
  prompt += `Request: ${message}\n`;
  if (selectedSchema) {
    prompt += `Schema (as JSON):\n${JSON.stringify(selectedSchema, null, 2)}\n`;
  }
  prompt += `Lambda specs:\n- Function Name: ${functionName}\n- Runtime: ${runtime}\n- Handler: ${handler}\n- Memory: ${memory}\n- Timeout: ${timeout}\n- Environment: ${environment || 'none'}\n`;
  prompt += `\nOutput ONLY the complete Lambda handler code as a single code block. Do NOT include any explanation, comments, or extra text.\n`;

  try {
    // Use LangChain's output parser to extract code only
    const outputParser = new StringOutputParser();
    const response = await chat.invoke([
      { role: "user", content: prompt }
    ]);
    console.log('[LLM Agent] Claude response:', response);

    let code = response.content || '';
    // Extract code block using regex (robust)
    const match = code.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
    if (match) {
      code = match[1].trim();
    } else {
      // Fallback: try to extract any code-like content
      const altMatch = code.match(/([\s\S]+)/);
      if (altMatch) {
        code = altMatch[1].trim();
      }
    }
    return { generatedCode: code };
  } catch (err) {
    console.error('[LLM Agent] Claude error:', err);
    return { generatedCode: '', error: err.message || String(err) };
  }
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
    const isSchemaIntent = isExplicitSchemaGenerationIntent(message);

    // Gather namespace context (use your previous logic here)
    let namespaceContext = '';
    let nsWebhooks = [];
    let nsAccounts = [];
    if (namespaceId) {
      try {
        const { schemas: nsSchemas, methods: nsApis, namespaceInfo, webhooks, accounts } = await getRealNamespaceData(namespaceId);
        nsWebhooks = webhooks || [];
        nsAccounts = accounts || [];
        namespaceContext = namespaceInfo
          ? `Current namespace: ${namespaceInfo['namespace-name'] || 'Unknown'}\nNamespace ID: ${namespaceInfo['namespace-id'] || namespaceId}`
          : `Current namespace: Unknown\nNamespace ID: ${namespaceId}`;
        namespaceContext += `\nAvailable schemas: ${nsSchemas.map(s => s.schemaName).join(', ') || 'None'}`;
        namespaceContext += `\nAvailable APIs: ${nsApis.map(m => m['namespace-method-name'] || m.methodName).join(', ') || 'None'}`;
        namespaceContext += `\nAvailable webhooks: ${nsWebhooks.map(w => w.webhookName || w.name).join(', ') || 'None'}`;
        namespaceContext += `\nAvailable accounts: ${nsAccounts.map(a => a.accountName || a.name).join(', ') || 'None'}`;
        namespaceContext += `\n\n---\nSchemas detail:\n${JSON.stringify(nsSchemas, null, 2)}`;
        namespaceContext += `\n\n---\nMethods detail:\n${JSON.stringify(nsApis, null, 2)}`;
        namespaceContext += `\n\n---\nWebhooks detail:\n${JSON.stringify(nsWebhooks, null, 2)}`;
        namespaceContext += `\n\n---\nAccounts detail:\n${JSON.stringify(nsAccounts, null, 2)}`;
      } catch (err) {
        namespaceContext = `Current namespace ID: ${namespaceId} (context lookup failed)`;
      }
    }

    let systemPrompt;
    const clarificationInstruction = "If the user's intent about schema generation is unclear, ask them to clarify if they want to generate a new schema or just ask about an existing one. Only proceed with schema generation if the user confirms.";
    if (isSchemaIntent && schema) {
      systemPrompt = `You are an expert JSON Schema editor.\n${namespaceContext}\n${clarificationInstruction}\nHere is the current schema:\n${JSON.stringify(schema, null, 2)}\n\nUser instruction: ${message}\n\nONLY output the updated JSON schema, and nothing else. Do not generate a new schema from scratch—modify the existing one.`;
    } else if (isSchemaIntent) {
      // Directly call the schema generation tool
      try {
        console.log('[LLM Agent] Directly invoking generateSchemaTool for:', message);
        
        // First, send a confirmation message to the user
        res.write(`data: ${JSON.stringify({ content: "I'll generate a schema for you based on your requirements. Let me create that now...", type: 'chat', route: 'schema' })}\n\n`);
        
        const schemaResult = await generateSchemaTool.func({ description: message });
        let schemaJson = null;
        try {
          schemaJson = JSON.parse(schemaResult);
          console.log('[LLM Agent] Successfully parsed schema:', schemaJson);
        } catch (e) {
          console.log('[LLM Agent] Failed to parse schema result:', e.message);
          console.log('[LLM Agent] Raw schema result:', schemaResult);
        }
        
        if (schemaJson && (schemaJson.properties || schemaJson.type)) {
          console.log('[LLM Agent] Streaming schema action:', schemaJson);
          
          // Send the schema as a chat message first
          res.write(`data: ${JSON.stringify({ content: "Here's the generated schema:", type: 'chat', route: 'schema' })}\n\n`);
          res.write(`data: ${JSON.stringify({ content: "```json\n" + JSON.stringify(schemaJson, null, 2) + "\n```", type: 'chat', route: 'schema' })}\n\n`);
          
          // Then send the action to trigger frontend schema handling
          const actionData = { actions: [{ type: 'generate_schema', status: 'complete', data: schemaJson }], type: 'actions', route: 'schema' };
          console.log('[Backend] Sending schema action:', actionData);
          res.write(`data: ${JSON.stringify(actionData)}\n\n`);
        } else {
          console.log('[LLM Agent] Invalid schema generated:', schemaJson);
          res.write(`data: ${JSON.stringify({ content: "I'm sorry, I couldn't generate a valid schema. Please try again with more specific requirements.", type: 'chat', route: 'schema' })}\n\n`);
          res.write(`data: ${JSON.stringify({ actions: [{ type: 'error', status: 'failed', message: 'No valid schema found.' }], type: 'actions', route: 'schema' })}\n\n`);
        }
        res.end();
        return;
      } catch (err) {
        console.log('[LLM Agent] Schema generation error:', err);
        res.write(`data: ${JSON.stringify({ content: "I encountered an error while generating the schema. Please try again.", type: 'chat', route: 'schema' })}\n\n`);
        res.write(`data: ${JSON.stringify({ actions: [{ type: 'error', status: 'failed', message: 'Agent error: ' + err.message }], type: 'actions', route: 'schema' })}\n\n`);
        res.end();
        return;
      }
    } else {
      systemPrompt = `You are a helpful AI assistant for the BRMH platform.\n${namespaceContext}\n${clarificationInstruction}\nAnswer the user's questions conversationally, using the above context if relevant.`;
    }
    console.log('System prompt for LLM:', systemPrompt);

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

      // Stream the response and detect schema code blocks
      let schemaJson = null;
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta') {
          const content = chunk.delta.text;
          llmBuffer += content;
          res.write(`data: ${JSON.stringify({ content, type: 'chat', route: isSchemaIntent ? 'schema' : 'chat' })}\n\n`);

          // Try to detect and parse a JSON schema code block
          const codeBlockMatch = content.match(/```json([\s\S]*?)```/i) || content.match(/```([\s\S]*?)```/i);
          if (codeBlockMatch) {
            try {
              const possibleJson = codeBlockMatch[1].trim();
              schemaJson = JSON.parse(possibleJson);
            } catch (e) { /* not valid JSON, ignore */ }
          }
        }
      }

      // If a schema was detected, stream a generate_schema action to the frontend
      if (schemaJson) {
        res.write(`data: ${JSON.stringify({ actions: [{ type: 'generate_schema', status: 'complete', data: schemaJson }], type: 'actions', route: 'schema' })}\n\n`);
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