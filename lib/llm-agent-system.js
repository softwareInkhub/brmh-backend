import { Anthropic } from '@anthropic-ai/sdk';
import { ChatAnthropic } from "@langchain/anthropic";
import { RunnableSequence } from "@langchain/core/runnables";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";
import yaml from 'js-yaml';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// LangChain Claude instance
const chat = new ChatAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: "claude-3-5-sonnet-20240620"
});

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
  // Send the raw LLM output directly to Claude with a strict OpenAPI prompt
  console.log('DEBUG: Sending raw LLM output to Claude:', llmOutput);
  let prompt = `IMPORTANT: DO NOT wrap your output in Markdown code blocks (no triple backticks), DO NOT add comments, and DO NOT include any explanations. Only output valid, directly usable JSON.\n\nYou are a backend developer. Generate a complete OpenAPI 3.0 JSON specification (not a stub, not Markdown).\nThe spec must be directly usable in Swagger UI or Redoc.\nOnly return valid JSON. Use \"string\" for unknown types.\n\nGenerate the OpenAPI spec based on this user request: \"${llmOutput}\"\n\nThe JSON must include:\n- \"openapi\" field\n- \"info\" block (with \"title\" and \"version\")\n- \"paths\" with appropriate HTTP methods (GET, POST, etc.)\n- \"responses\" with JSON schemas for each endpoint\n- A minimal but valid \"components\" section if needed\n\nExample format:\n{\n  \"openapi\": \"3.0.0\",\n  \"info\": {\n    \"title\": \"Sample API\",\n    \"version\": \"1.0.0\"\n  },\n  \"paths\": {\n    \"/example\": {\n      \"get\": {\n        \"summary\": \"Get example\",\n        \"responses\": {\n          \"200\": {\n            \"description\": \"Success\",\n            \"content\": {\n              \"application/json\": {\n                \"schema\": {\n                  \"type\": \"object\",\n                  \"properties\": {\n                    \"id\": { \"type\": \"string\" }\n                  }\n                }\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n}`;
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

export const agentSystem = {
  async handleStreamingWithAgents(res, namespace, message, history = []) {
    const namespaceId = typeof namespace === 'object' && namespace !== null ? namespace.id : namespace;
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    let llmBuffer = '';
    let sentAction = false; // Only send one action (schema or API)
    let schemaData = null;
    let apiData = null;
    // --- Step 1: Detect intent from user prompt ---
    const intent = isLikelyApiRequest(message)
      ? 'api'
      : (isLikelySchemaRequest && isLikelySchemaRequest(message))
        ? 'schema'
        : 'chat';
    try {
      const systemPrompt = `You are an AI assistant. Respond conversationally, but if the user requests a schema or API, describe the fields/endpoints in a clear list or output a JSON schema or API in a code block.`;
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

      // --- Step 2: Buffer LLM output ---
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta') {
          const content = chunk.delta.text;
          llmBuffer += content;
          res.write(`data: ${JSON.stringify({ content, type: 'chat' })}\n\n`);
        }
      }

      // --- Step 3: Analyze LLM output and take action based on intent ---
      if (!sentAction) {
        let firstAction = null;
        if (intent === 'api') {
          try {
            const openapi = await extractOpenApiFromMarkdown(llmBuffer);
            firstAction = { type: 'generate_api', data: openapi };
            apiData = openapi;
          } catch (err) {
            console.error('OpenAPI extraction error:', err);
            res.write(`data: ${JSON.stringify({ actions: [{ type: 'generate_api', status: 'error', error: err.message }], type: 'actions' })}\n\n`);
          }
        } else if (intent === 'schema') {
          try {
            const schema = await extractSchemaFromMarkdown(llmBuffer);
            firstAction = { type: 'generate_schema', data: schema };
            schemaData = schema;
          } catch (err) {
            console.error('Schema extraction error:', err);
            res.write(`data: ${JSON.stringify({ actions: [{ type: 'generate_schema', status: 'error', error: err.message }], type: 'actions' })}\n\n`);
          }
        }
        if (firstAction) {
          sentAction = true;
          res.write(`data: ${JSON.stringify({ actions: [{ type: firstAction.type, status: 'complete', data: firstAction.data }], type: 'actions' })}\n\n`);
          console.log('DEBUG: Emitting action:', firstAction);
        }
      }
    } catch (error) {
      console.error('Agent system streaming error:', error);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    } finally {
      res.end();
    }
  }
}; 