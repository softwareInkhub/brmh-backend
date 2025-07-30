import { Anthropic } from '@anthropic-ai/sdk';
import { ChatAnthropic } from "@langchain/anthropic";
import { RunnableSequence } from "@langchain/core/runnables";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";
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
  
  // Additional check for "generate" + "schema" combinations
  const hasGenerate = lower.includes('generate');
  const hasSchema = lower.includes('schema');
  const hasCreate = lower.includes('create');
  const hasMock = lower.includes('mock');
  const hasData = lower.includes('data');
  const hasStructure = lower.includes('structure');
  
  const matchesGenerateSchema = (hasGenerate || hasCreate) && (hasSchema || hasMock || hasData || hasStructure);
  
  console.log('[Intent Detection]', {
    message: lower,
    matchesPatterns,
    matchesKeywords,
    matchesProduct,
    hasGenerate,
    hasSchema,
    hasCreate,
    hasMock,
    hasData,
    hasStructure,
    matchesGenerateSchema,
    result: matchesPatterns || matchesKeywords || matchesProduct || matchesGenerateSchema
  });
  
  return matchesPatterns || matchesKeywords || matchesProduct || matchesGenerateSchema;
}

function isSchemaEditingIntent(message) {
  const lower = message.toLowerCase();
  
  // Schema editing patterns
  const editingPatterns = [
    /edit\s+(?:the\s+)?(?:schema|json)/i,
    /modify\s+(?:the\s+)?(?:schema|json)/i,
    /update\s+(?:the\s+)?(?:schema|json)/i,
    /change\s+(?:the\s+)?(?:schema|json)/i,
    /add\s+(?:a\s+)?(?:new\s+)?(?:field|property|column)/i,
    /remove\s+(?:a\s+)?(?:field|property|column)/i,
    /delete\s+(?:a\s+)?(?:field|property|column)/i,
    /rename\s+(?:a\s+)?(?:field|property|column)/i,
    /change\s+(?:the\s+)?(?:type|datatype)/i,
    /make\s+(?:it\s+)?(?:required|optional)/i,
    /set\s+(?:the\s+)?(?:default|value)/i,
    /add\s+(?:validation|constraint)/i,
    /remove\s+(?:validation|constraint)/i
  ];
  
  // Schema editing keywords
  const editingKeywords = [
    'edit schema', 'modify schema', 'update schema', 'change schema',
    'edit json', 'modify json', 'update json', 'change json',
    'add field', 'add property', 'add column',
    'remove field', 'remove property', 'remove column',
    'delete field', 'delete property', 'delete column',
    'rename field', 'rename property', 'rename column',
    'change type', 'change datatype', 'modify type',
    'make required', 'make optional', 'set required', 'set optional',
    'set default', 'add default', 'change default',
    'add validation', 'add constraint', 'remove validation', 'remove constraint'
  ];
  
  // Check patterns
  const matchesPatterns = editingPatterns.some(pattern => pattern.test(lower));
  const matchesKeywords = editingKeywords.some(keyword => lower.includes(keyword));
  
  console.log('[Schema Editing Intent Detection]', {
    message: lower,
    matchesPatterns,
    matchesKeywords,
    result: matchesPatterns || matchesKeywords
  });
  
  return matchesPatterns || matchesKeywords;
}

function detectSchemaIntent(message) {
  const schemaKeywords = [
    'schema', 'json', 'field', 'property', 'object', 'add', 'remove', 'edit', 'update', 'type', 'structure',
    'generate', 'create', 'make', 'build', 'new', 'mock', 'data'
  ];
  const lower = message.toLowerCase();
  return schemaKeywords.some(kw => lower.includes(kw));
}

// Tool: Generate JSON Schema from user description with streaming
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
      // Use streaming for schema generation
      const stream = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: 4000,
        messages: [
          { role: 'user', content: enhancedPrompt }
        ],
        stream: true,
      });

      let schemaContent = '';
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta') {
          const content = chunk.delta.text;
          schemaContent += content;
        }
      }

      // Extract JSON from the streamed content
      const jsonMatch = schemaContent.match(/```json\s*([\s\S]*?)\s*```/i) || 
                       schemaContent.match(/```\s*([\s\S]*?)\s*```/i) ||
                       schemaContent.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        try {
          const jsonStr = jsonMatch[1] || jsonMatch[0];
          const parsed = JSON.parse(jsonStr);
          console.log('[Schema Tool] Extracted schema from streamed content:', parsed);
          return JSON.stringify(parsed);
        } catch (parseError) {
          console.log('[Schema Tool] JSON parsing failed:', parseError.message);
          throw new Error('Failed to generate valid JSON schema');
        }
      } else {
        console.log('[Schema Tool] No JSON found in streamed response');
        throw new Error('No valid JSON schema found in response');
      }
    } catch (error) {
      console.log('[Schema Tool] Streaming failed, trying fallback:', error.message);
      
      // Fallback to non-streaming approach
      try {
        const outputParser = new JsonOutputParser();
        const chain = RunnableSequence.from([chat, outputParser]);
        const schema = await chain.invoke(enhancedPrompt);
        console.log('[Schema Tool] Generated schema (fallback):', schema);
        return JSON.stringify(schema);
      } catch (fallbackError) {
        console.log('[Schema Tool] Fallback also failed:', fallbackError.message);
        throw new Error('Failed to generate valid JSON schema');
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
    const isSchemaEditing = isSchemaEditingIntent(message);
    
    // If we have a schema and the user mentions schema-related keywords, treat it as editing
    const hasSchemaKeywords = detectSchemaIntent(message);
    const shouldEditExisting = schema && (hasSchemaKeywords || isSchemaIntent);

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
    
    // Check if we're in AI Agent Workspace context (schema is provided)
    if (schema) {
      // We're working with a generated schema in the AI Agent Workspace
      // If user mentions schema-related keywords OR wants to generate, treat as editing
      if (isSchemaEditing || shouldEditExisting || isSchemaIntent) {
        // Use the dedicated schema editing flow instead of regular chat
        console.log('[LLM Agent] Schema editing intent detected for:', message);
        
        // Then edit the schema using the dedicated editing flow
        try {
          console.log('[LLM Agent] Starting schema editing for:', message);
          
          // Create streaming prompt for schema editing
          const editPrompt = `You are an expert JSON Schema editor working in the AI Agent Workspace. Edit the following JSON schema based on the user's instructions.

Current Generated Schema:
${JSON.stringify(schema, null, 2)}

Edit Instructions: ${message}

Instructions:
1. Parse the current schema and understand its structure
2. Apply the requested changes while maintaining schema validity
3. Preserve existing properties and structure unless explicitly asked to change them
4. Add proper validation rules and descriptions where appropriate
5. Ensure the edited schema is still valid JSON Schema
6. Return ONLY the edited JSON schema, no explanations or markdown formatting

Output format:
1. First, provide a brief contextual introduction (1-2 sentences) explaining what changes you're making and why
2. Then, output ONLY the edited JSON schema, no explanations or markdown formatting
3. Finally, provide a brief completion message (1-2 sentences) that summarizes the changes made`;

          // Start streaming the schema editing
          const stream = await anthropic.messages.create({
            model: 'claude-3-5-sonnet-20240620',
            max_tokens: 4000,
            messages: [
              { role: 'user', content: editPrompt }
            ],
            stream: true,
          });

          let schemaContent = '';
          let schemaJson = null;
          let completionMessage = '';
          
          // Stream the schema editing in real-time
          for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta') {
              const content = chunk.delta.text;
              schemaContent += content;
              
              // Stream the content to the frontend
              res.write(`data: ${JSON.stringify({ content, type: 'chat', route: 'schema' })}\n\n`);
              
              // Try to detect and parse JSON schema in real-time
              const jsonMatch = schemaContent.match(/```json\s*([\s\S]*?)\s*```/i) || 
                               schemaContent.match(/```\s*([\s\S]*?)\s*```/i) ||
                               schemaContent.match(/\{[\s\S]*\}/);
              
              if (jsonMatch && !schemaJson) {
                try {
                  const jsonStr = jsonMatch[1] || jsonMatch[0];
                  schemaJson = JSON.parse(jsonStr);
                  console.log('[LLM Agent] Detected valid edited schema during streaming:', schemaJson);
                } catch (e) {
                  // Continue streaming, schema not complete yet
                }
              }
              
              // Extract completion message from the end of the response
              const lines = schemaContent.split('\n');
              const lastLines = lines.slice(-3); // Check last 3 lines for completion message
              if (lastLines.some(line => line.trim().length > 0 && !line.includes('{') && !line.includes('}') && !line.includes('```'))) {
                completionMessage = lastLines.filter(line => line.trim().length > 0 && !line.includes('{') && !line.includes('}') && !line.includes('```')).join(' ').trim();
              }
            }
          }

          // After streaming is complete, validate and send the final edited schema
          if (schemaJson && (schemaJson.properties || schemaJson.type)) {
            console.log('[LLM Agent] Final edited schema:', schemaJson);
            
            // Send LLM-generated completion message if available, otherwise use generic one
            const finalMessage = completionMessage || "✅ Schema editing completed! The schema has been updated in the Schema tab.";
            res.write(`data: ${JSON.stringify({ content: finalMessage, type: 'chat', route: 'chat' })}\n\n`);
            
            // Send the final edited schema action
            const actionData = { actions: [{ type: 'edit_schema', status: 'complete', data: schemaJson }], type: 'actions', route: 'schema' };
            console.log('[Backend] Sending final edited schema action:', actionData);
            res.write(`data: ${JSON.stringify(actionData)}\n\n`);
          } else {
            console.log('[LLM Agent] No valid edited schema detected in streamed content');
            res.write(`data: ${JSON.stringify({ content: "❌ I encountered an issue while editing the schema. Please try again.", type: 'chat', route: 'chat' })}\n\n`);
            res.write(`data: ${JSON.stringify({ actions: [{ type: 'error', status: 'failed', message: 'No valid edited schema found in generated content.' }], type: 'actions', route: 'schema' })}\n\n`);
          }
          
          res.end();
          return;
        } catch (err) {
          console.log('[LLM Agent] Schema editing streaming error:', err);
          res.write(`data: ${JSON.stringify({ content: "I encountered an error while editing the schema. Please try again.", type: 'chat', route: 'chat' })}\n\n`);
          res.write(`data: ${JSON.stringify({ actions: [{ type: 'error', status: 'failed', message: 'Agent error: ' + err.message }], type: 'actions', route: 'schema' })}\n\n`);
          res.end();
          return;
        }
      } else {
        systemPrompt = `You are a helpful AI assistant working in the AI Agent Workspace. You have access to both the generated schema in this workspace AND the namespace context.

Current Generated Schema:
${JSON.stringify(schema, null, 2)}

Namespace Context:
${namespaceContext}

User message: ${message}

Instructions:
1. Answer questions about the generated schema
2. Help with schema modifications when requested
3. Provide guidance on schema usage and validation
4. Answer questions about existing namespace schemas, methods, accounts, and webhooks
5. Be conversational and helpful
6. If the user wants to edit the generated schema, guide them on how to do so
7. If the user asks about namespace data, provide information from the namespace context

Respond conversationally and helpfully, using both the generated schema and namespace context as needed.`;
      }
    } else if (isSchemaIntent && !schema) {
      // Only generate new schema if no existing schema is available
      console.log('[LLM Agent] Schema generation intent detected for:', message);
      
      // Use dedicated streaming flow for schema generation
      try {
        console.log('[LLM Agent] Starting schema generation for:', message);
        
        // Create streaming prompt for schema generation
        const generatePrompt = `You are an expert JSON Schema designer working in the AI Agent Workspace. Generate a comprehensive JSON schema based on the following requirements.

Requirements: ${message}

Namespace Context:
${namespaceContext}

Instructions:
1. Create a complete, valid JSON schema with appropriate properties
2. Include proper data types, descriptions, and validation rules
3. Add example data where appropriate
4. Make the schema production-ready and well-documented
5. Include common fields like id, name, description, created_at, updated_at where relevant
6. For product schemas, include fields like price, category, tags, images, etc.
7. For data schemas, include proper validation and constraints
8. Consider existing namespace schemas to avoid conflicts or provide complementary schemas

Output format:
1. First, provide a brief contextual introduction (1-2 sentences) explaining what type of schema you're creating and why
2. Then, output ONLY the JSON schema, no explanations or markdown formatting
3. Finally, provide a brief completion message (1-2 sentences) that summarizes what was created and any key features`;

        // Start streaming the schema generation
        const stream = await anthropic.messages.create({
          model: 'claude-3-5-sonnet-20240620',
          max_tokens: 4000,
          messages: [
            { role: 'user', content: generatePrompt }
          ],
          stream: true,
        });

        let schemaContent = '';
        let schemaJson = null;
        let introductionSent = false;
        let completionMessage = '';
        
        // Stream the schema generation in real-time
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta') {
            const content = chunk.delta.text;
            schemaContent += content;
            
            // Stream the content to the frontend
            res.write(`data: ${JSON.stringify({ content, type: 'chat', route: 'schema' })}\n\n`);
            
            // Try to detect and parse JSON schema in real-time
            const jsonMatch = schemaContent.match(/```json\s*([\s\S]*?)\s*```/i) || 
                             schemaContent.match(/```\s*([\s\S]*?)\s*```/i) ||
                             schemaContent.match(/\{[\s\S]*\}/);
            
            if (jsonMatch && !schemaJson) {
              try {
                const jsonStr = jsonMatch[1] || jsonMatch[0];
                schemaJson = JSON.parse(jsonStr);
                console.log('[LLM Agent] Detected valid schema during streaming:', schemaJson);
              } catch (e) {
                // Continue streaming, schema not complete yet
              }
            }
            
            // Extract completion message from the end of the response
            const lines = schemaContent.split('\n');
            const lastLines = lines.slice(-3); // Check last 3 lines for completion message
            if (lastLines.some(line => line.trim().length > 0 && !line.includes('{') && !line.includes('}') && !line.includes('```'))) {
              completionMessage = lastLines.filter(line => line.trim().length > 0 && !line.includes('{') && !line.includes('}') && !line.includes('```')).join(' ').trim();
            }
          }
        }

        // After streaming is complete, validate and send the final schema
        if (schemaJson && (schemaJson.properties || schemaJson.type)) {
          console.log('[LLM Agent] Final schema generated:', schemaJson);
          
          // Send LLM-generated completion message if available, otherwise use generic one
          const finalMessage = completionMessage || "✅ Schema generation completed! The schema has been created and is now available in the Schema tab.";
          res.write(`data: ${JSON.stringify({ content: finalMessage, type: 'chat', route: 'chat' })}\n\n`);
          
          // Send the final schema action
          const actionData = { actions: [{ type: 'generate_schema', status: 'complete', data: schemaJson }], type: 'actions', route: 'schema' };
          console.log('[Backend] Sending final schema action:', actionData);
          res.write(`data: ${JSON.stringify(actionData)}\n\n`);
        } else {
          console.log('[LLM Agent] No valid schema detected in streamed content');
          res.write(`data: ${JSON.stringify({ content: "❌ I encountered an issue while generating the schema. Please try again.", type: 'chat', route: 'chat' })}\n\n`);
          res.write(`data: ${JSON.stringify({ actions: [{ type: 'error', status: 'failed', message: 'No valid schema found in generated content.' }], type: 'actions', route: 'schema' })}\n\n`);
        }
        
        res.end();
        return;
      } catch (err) {
        console.log('[LLM Agent] Schema generation streaming error:', err);
        res.write(`data: ${JSON.stringify({ content: "I encountered an error while generating the schema. Please try again.", type: 'chat', route: 'chat' })}\n\n`);
        res.write(`data: ${JSON.stringify({ actions: [{ type: 'error', status: 'failed', message: 'Agent error: ' + err.message }], type: 'actions', route: 'schema' })}\n\n`);
        res.end();
        return;
      }


    } else {
      // Regular chat - use AI Agent Workspace context if schema is available
      if (schema) {
        // If user mentions schema-related keywords but we're not in explicit edit mode, guide them
        if (hasSchemaKeywords && !isSchemaEditing) {
          systemPrompt = `You are a helpful AI assistant working in the AI Agent Workspace. You have access to both the generated schema in this workspace AND the namespace context.

Current Generated Schema:
${JSON.stringify(schema, null, 2)}

Namespace Context:
${namespaceContext}

User message: ${message}

Instructions:
1. The user is asking about schema-related topics
2. Since there's already a generated schema, guide them to edit it instead of creating a new one
3. Suggest they use edit commands like "add a field", "remove a field", "modify the schema", etc.
4. Answer questions about the current generated schema
5. Answer questions about existing namespace schemas, methods, accounts, and webhooks
6. Be conversational and helpful

Respond conversationally and helpfully, guiding them to edit the existing schema rather than creating a new one.`;
        } else {
          systemPrompt = `You are a helpful AI assistant working in the AI Agent Workspace. You have access to both the generated schema in this workspace AND the namespace context.

Current Generated Schema:
${JSON.stringify(schema, null, 2)}

Namespace Context:
${namespaceContext}

User message: ${message}

Instructions:
1. Answer questions about the generated schema
2. Help with schema modifications when requested
3. Provide guidance on schema usage and validation
4. Answer questions about existing namespace schemas, methods, accounts, and webhooks
5. Be conversational and helpful
6. If the user wants to edit the generated schema, guide them on how to do so
7. If the user asks about namespace data, provide information from the namespace context

Respond conversationally and helpfully, using both the generated schema and namespace context as needed.`;
        }
      } else {
        systemPrompt = `You are a helpful AI assistant for the BRMH platform.\n${namespaceContext}\nAnswer the user's questions conversationally, using the above context if relevant.`;
      }
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

      // If a schema was detected, determine if it should be a new schema or edit existing
      if (schemaJson) {
        console.log('[Backend] Schema detected in response. Debug info:', {
          hasExistingSchema: !!schema,
          isSchemaIntent,
          hasSchemaKeywords,
          shouldEditExisting: schema && (isSchemaIntent || hasSchemaKeywords)
        });
        
        if (schema) {
          // We have an existing schema - ALWAYS edit it, never generate new
          console.log('[Backend] Sending edit_schema action for existing schema');
          res.write(`data: ${JSON.stringify({ actions: [{ type: 'edit_schema', status: 'complete', data: schemaJson }], type: 'actions', route: 'schema' })}\n\n`);
        } else {
          // No existing schema - send generate action
          console.log('[Backend] Sending generate_schema action for new schema');
          res.write(`data: ${JSON.stringify({ actions: [{ type: 'generate_schema', status: 'complete', data: schemaJson }], type: 'actions', route: 'schema' })}\n\n`);
        }
      }

      if (isSchemaIntent && !schema) {
        // Only generate new schema if no existing schema is available
        console.log('[Backend] Processing schema generation intent with no existing schema');
        try {
          const outputParser = new JsonOutputParser();
          const parsed = await outputParser.parse(llmBuffer);
          if (parsed && (parsed.properties || parsed.type)) {
            console.log('[Backend] Sending generate_schema action for new schema');
            res.write(`data: ${JSON.stringify({ actions: [{ type: 'generate_schema', status: 'complete', data: parsed }], type: 'actions', route: 'schema' })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ actions: [{ type: 'error', status: 'failed', message: 'No valid schema found in LLM output.' }], type: 'actions', route: 'schema' })}\n\n`);
          }
        } catch (err) {
          res.write(`data: ${JSON.stringify({ actions: [{ type: 'error', status: 'failed', message: 'Schema extraction error: ' + err.message }], type: 'actions', route: 'schema' })}\n\n`);
        }
      } else if (isSchemaIntent && schema) {
        // User wants to generate but schema exists - this should not happen with our logic
        console.log('[Backend] WARNING: Schema generation intent detected but schema exists - this should not happen!');
        console.log('[Backend] Forcing edit_schema action instead');
        try {
          const outputParser = new JsonOutputParser();
          const parsed = await outputParser.parse(llmBuffer);
          if (parsed && (parsed.properties || parsed.type)) {
            res.write(`data: ${JSON.stringify({ actions: [{ type: 'edit_schema', status: 'complete', data: parsed }], type: 'actions', route: 'schema' })}\n\n`);
          }
        } catch (err) {
          // Ignore errors in this fallback case
        }
      }
    } catch (error) {
      res.write(`data: ${JSON.stringify({ actions: [{ type: 'error', status: 'failed', message: error.message }], type: 'actions', route: isSchemaIntent ? 'schema' : 'chat' })}\n\n`);
    } finally {
      res.end();
    }
  }
};

// Tool: Edit existing JSON Schema with streaming
const editSchemaTool = new DynamicStructuredTool({
  name: "edit_schema",
  description: "Edit an existing JSON schema based on user instructions.",
  schema: z.object({
    currentSchema: z.string().describe("The current JSON schema to edit"),
    editInstructions: z.string().describe("Detailed instructions for editing the schema")
  }),
  func: async ({ currentSchema, editInstructions }) => {
    console.log('[Schema Edit Tool] Editing schema with instructions:', editInstructions);
    
    const enhancedPrompt = `You are an expert JSON Schema editor. Edit the following JSON schema based on the user's instructions.

Current Schema:
${currentSchema}

Edit Instructions: ${editInstructions}

Instructions:
1. Parse the current schema and understand its structure
2. Apply the requested changes while maintaining schema validity
3. Preserve existing properties and structure unless explicitly asked to change them
4. Add proper validation rules and descriptions where appropriate
5. Ensure the edited schema is still valid JSON Schema
6. Return ONLY the edited JSON schema, no explanations or markdown formatting

Output ONLY the edited JSON schema, no explanations or markdown formatting.`;

    try {
      // Use streaming for schema editing
      const stream = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: 4000,
        messages: [
          { role: 'user', content: enhancedPrompt }
        ],
        stream: true,
      });

      let schemaContent = '';
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta') {
          const content = chunk.delta.text;
          schemaContent += content;
        }
      }

      // Extract JSON from the streamed content
      const jsonMatch = schemaContent.match(/```json\s*([\s\S]*?)\s*```/i) ||
                       schemaContent.match(/```\s*([\s\S]*?)\s*```/i) ||
                       schemaContent.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        try {
          const jsonStr = jsonMatch[1] || jsonMatch[0];
          const parsed = JSON.parse(jsonStr);
          console.log('[Schema Edit Tool] Edited schema:', parsed);
          return JSON.stringify(parsed);
        } catch (parseError) {
          console.log('[Schema Edit Tool] JSON parsing failed:', parseError.message);
          throw new Error('Failed to generate valid edited JSON schema');
        }
      } else {
        console.log('[Schema Edit Tool] No JSON found in streamed response');
        throw new Error('No valid edited JSON schema found in response');
      }
    } catch (error) {
      console.log('[Schema Edit Tool] Streaming failed, trying fallback:', error.message);

      // Fallback to non-streaming approach
      try {
        const outputParser = new JsonOutputParser();
        const chain = RunnableSequence.from([chat, outputParser]);
        const schema = await chain.invoke(enhancedPrompt);
        console.log('[Schema Edit Tool] Edited schema (fallback):', schema);
        return JSON.stringify(schema);
      } catch (fallbackError) {
        console.log('[Schema Edit Tool] Fallback also failed:', fallbackError.message);
        throw new Error('Failed to generate valid edited JSON schema');
      }
    }
  }
}); 