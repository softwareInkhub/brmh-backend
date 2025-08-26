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



// Robust intent detection that matches frontend logic
function detectIntent(message) {
  const lower = message.toLowerCase();
  
  // Explicit action keywords that indicate user wants to generate/create something
  const explicitActionKeywords = [
    'generate', 'create', 'build', 'write', 'make', 'develop', 'code', 'program',
    'implement', 'set up', 'configure', 'deploy', 'launch', 'start'
  ];
  
  // Lambda-related keywords
  const lambdaKeywords = [
    'lambda', 'function', 'handler', 'aws lambda', 'serverless', 
    'lambda function', 'aws function', 'serverless function'
  ];
  
  // Schema-related keywords
  const schemaKeywords = [
    'schema', 'json schema', 'data model', 'structure', 'format', 'validation',
    'type definition', 'interface', 'model'
  ];
  
  // Check for explicit Lambda generation intent
  const hasExplicitAction = explicitActionKeywords.some(action => lower.includes(action));
  const hasLambdaKeyword = lambdaKeywords.some(keyword => lower.includes(keyword));
  const hasSchemaKeyword = schemaKeywords.some(keyword => lower.includes(keyword));
  
  // More sophisticated intent detection
  // Prioritize lambda requests over schema requests when both keywords are present
  // Also detect lambda generation requests that mention schema context
  const isLambdaRequest = hasExplicitAction && hasLambdaKeyword;
  
  // Check for lambda generation requests that mention schema (common pattern)
  const hasLambdaContext = hasLambdaKeyword || (hasExplicitAction && (lower.includes('handler') || lower.includes('function')));
  const mentionsSchemaContext = lower.includes('from this schema') || lower.includes('using this schema') || lower.includes('with this schema') || lower.includes('based on this schema');
  const isLambdaWithSchemaContext = hasLambdaContext && mentionsSchemaContext;
  
  // Schema requests should not include lambda generation patterns
  const isSchemaRequest = hasExplicitAction && hasSchemaKeyword && !hasLambdaKeyword && !isLambdaWithSchemaContext;
  
  // Additional context checks to avoid false positives
  const isQuestion = lower.includes('?') || lower.includes('what') || lower.includes('how') || lower.includes('why');
  const isCasualMention = lower.includes('about') || lower.includes('regarding') || lower.includes('concerning');
  const isExplanatory = lower.includes('explain') || lower.includes('describe') || lower.includes('tell me');
  
  // Final intent determination
  const shouldGenerateLambda = (isLambdaRequest || isLambdaWithSchemaContext) && !isQuestion && !isCasualMention && !isExplanatory;
  const shouldGenerateSchema = isSchemaRequest && !isQuestion && !isCasualMention && !isExplanatory;
  
  console.log('[Backend Intent Detection]', {
    message: lower,
    hasExplicitAction,
    hasLambdaKeyword,
    hasSchemaKeyword,
    isQuestion,
    isCasualMention,
    isExplanatory,
    shouldGenerateLambda,
    shouldGenerateSchema,
    intent: shouldGenerateLambda ? 'lambda_generation' : shouldGenerateSchema ? 'schema_generation' : 'regular_chat'
  });
  
  return {
    shouldGenerateLambda,
    shouldGenerateSchema,
    isQuestion,
    isCasualMention,
    isExplanatory,
    intent: shouldGenerateLambda ? 'lambda_generation' : shouldGenerateSchema ? 'schema_generation' : 'regular_chat'
  };
}

// Legacy function for backward compatibility
function isExplicitSchemaGenerationIntent(message) {
  const intent = detectIntent(message);
  return intent.shouldGenerateSchema;
}

// Export the robust intent detection function
export { detectIntent };

function isSchemaEditingIntent(message) {
  const intent = detectIntent(message);
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
  
  // Only consider it schema editing if it's not a question, casual mention, or explanatory
  const isSchemaEditing = (matchesPatterns || matchesKeywords) && !intent.isQuestion && !intent.isCasualMention && !intent.isExplanatory;
  
  console.log('[Schema Editing Intent Detection]', {
    message: lower,
    matchesPatterns,
    matchesKeywords,
    isQuestion: intent.isQuestion,
    isCasualMention: intent.isCasualMention,
    isExplanatory: intent.isExplanatory,
    result: isSchemaEditing
  });
  
  return isSchemaEditing;
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

// Enhanced schema selection function that intelligently picks relevant schemas
async function selectRelevantSchemas(message, namespaceId, availableSchemas = []) {
  if (!namespaceId || availableSchemas.length === 0) {
    return [];
  }

  // If no schemas available, try to fetch them
  if (availableSchemas.length === 0) {
    try {
      const { schemas } = await getRealNamespaceData(namespaceId);
      availableSchemas = schemas;
    } catch (error) {
      console.warn('[LLM Agent] Failed to fetch schemas for intelligent selection:', error.message);
      return [];
    }
  }

  const lowerMessage = message.toLowerCase();
  const relevantSchemas = [];

  // Simple keyword-based matching for now
  // This could be enhanced with more sophisticated NLP later
  for (const schema of availableSchemas) {
    const schemaName = (schema.schemaName || schema.name || '').toLowerCase();
    const schemaDescription = (schema.description || '').toLowerCase();
    const schemaType = (schema.schemaType || '').toLowerCase();
    
    // Check if message contains keywords related to this schema
    const schemaText = `${schemaName} ${schemaDescription} ${schemaType}`;
    
    // Extract key terms from schema name and description
    const schemaTerms = schemaText.split(/\s+/).filter(term => term.length > 2);
    
    // Check if any schema terms appear in the message
    const hasMatchingTerms = schemaTerms.some(term => 
      lowerMessage.includes(term) && term.length > 3
    );
    
    // Also check for common patterns
    const commonPatterns = [
      'user', 'product', 'order', 'payment', 'auth', 'data', 'item', 'record',
      'customer', 'account', 'profile', 'settings', 'config', 'log', 'event'
    ];
    
    const hasCommonPattern = commonPatterns.some(pattern => 
      lowerMessage.includes(pattern) && schemaText.includes(pattern)
    );
    
    if (hasMatchingTerms || hasCommonPattern) {
      relevantSchemas.push(schema);
    }
  }

  // If no specific matches found, return all schemas if there are few
  if (relevantSchemas.length === 0 && availableSchemas.length <= 3) {
    return availableSchemas;
  }

  return relevantSchemas;
}

// Enhanced Lambda codegen handler that can automatically use workspace schemas
export async function handleLambdaCodegen({ message, selectedSchema, functionName, runtime, handler, memory, timeout, environment, namespace, res = null }) {
  console.log('[LLM Agent] Enhanced Lambda codegen request:', { message, selectedSchema, functionName, runtime, handler, memory, timeout, environment, namespace });

  // Extract namespace ID
  const namespaceId = typeof namespace === 'object' && namespace !== null ? namespace.id : namespace;
  
  // If no explicit schema is selected, try to find relevant schemas from workspace
  let schemasToUse = [];
  let namespaceContext = '';
  
  if (!selectedSchema && namespaceId) {
    try {
      console.log('[LLM Agent] No explicit schema selected, searching for relevant schemas in workspace...');
      
      // Get all available schemas for the namespace
      const { schemas: availableSchemas, methods: availableMethods, namespaceInfo } = await getRealNamespaceData(namespaceId);
      
      // Intelligently select relevant schemas based on the message
      const relevantSchemas = await selectRelevantSchemas(message, namespaceId, availableSchemas);
      
      if (relevantSchemas.length > 0) {
        schemasToUse = relevantSchemas;
        console.log('[LLM Agent] Found relevant schemas:', relevantSchemas.map(s => s.schemaName || s.name));
        
        // Build namespace context for the prompt
        namespaceContext = namespaceInfo
          ? `Current namespace: ${namespaceInfo['namespace-name'] || 'Unknown'}\nNamespace ID: ${namespaceInfo['namespace-id'] || namespaceId}`
          : `Current namespace: Unknown\nNamespace ID: ${namespaceId}`;
        namespaceContext += `\nAvailable APIs: ${availableMethods.map(m => m['namespace-method-name'] || m.methodName).join(', ') || 'None'}`;
      } else {
        console.log('[LLM Agent] No relevant schemas found, will generate without schema context');
      }
    } catch (error) {
      console.warn('[LLM Agent] Failed to get workspace schemas:', error.message);
    }
  } else if (selectedSchema) {
    // Use the explicitly selected schema
    schemasToUse = [selectedSchema];
  }

  // Build the enhanced prompt
  let prompt = `You are an expert AWS Lambda developer. Generate ONLY the Lambda handler code - no explanations, comments, or markdown.

Requirements:
- Function purpose: ${message}
- Function name: ${functionName}
- Runtime: ${runtime}
- Handler: ${handler}
- Memory: ${memory} MB
- Timeout: ${timeout} seconds
- Environment variables: ${environment || 'none'}

${namespaceContext ? `Workspace Context:\n${namespaceContext}\n` : ''}

${schemasToUse.length > 0 ? `Available Schemas (automatically selected based on your request):\n${schemasToUse.map((schema, index) => `Schema ${index + 1}: ${schema.schemaName || schema.name}\n${JSON.stringify(schema, null, 2)}`).join('\n\n')}\n` : ''}

Generate a complete, production-ready Lambda handler that:
1. Handles the specified requirements
2. Includes proper error handling
3. Returns appropriate HTTP responses
4. Uses the provided schemas if applicable (you can use multiple schemas if they make sense for the function)
5. Follows AWS Lambda best practices
6. Can use any necessary npm packages (AWS SDK, axios, lodash, etc.) as needed
7. Uses standard JavaScript/Node.js syntax
8. If multiple schemas are provided, intelligently combine them based on the function purpose

IMPORTANT: 
- Output ONLY the JavaScript/Node.js code
- Do NOT include any explanations, comments, markdown formatting, or natural language text
- Start directly with the code
- Include any necessary require() or import statements for the functionality you need
- If schemas are provided, use them appropriately in your function logic`;

  try {
    if (res) {
      // Streaming mode
      console.log('[LLM Agent] Starting streaming Lambda generation with enhanced context...');
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // Use streaming chat
      const stream = await chat.stream([
        { role: "user", content: prompt }
      ]);

      let fullCode = '';
      let chunkCount = 0;
      console.log('[LLM Agent] LLM stream started, streaming chunks...');
      
      for await (const chunk of stream) {
        const content = chunk.content || '';
        if (content) {
          fullCode += content;
          chunkCount++;
          // Send the chunk to the client
          const data = JSON.stringify({ content });
          res.write(`data: ${data}\n\n`);
          
          // Log progress every 10 chunks
          if (chunkCount % 10 === 0) {
            console.log(`[LLM Agent] Sent ${chunkCount} chunks, code length: ${fullCode.length} chars`);
          }
        }
      }

      // Clean up any remaining markdown or explanations
      fullCode = fullCode.replace(/^```.*$/gm, '').replace(/```$/gm, '').trim();
      
      console.log(`[LLM Agent] Streaming completed. Total chunks: ${chunkCount}, Final code length: ${fullCode.length} chars`);
      
      // Send completion signal
      res.write('data: [DONE]\n\n');
      res.end();
      
      return { generatedCode: fullCode, usedSchemas: schemasToUse };
    } else {
      // Non-streaming mode (for backward compatibility)
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
      
      // Clean up any remaining markdown or explanations
      code = code.replace(/^```.*$/gm, '').replace(/```$/gm, '').trim();
      
      return { generatedCode: code, usedSchemas: schemasToUse };
    }
  } catch (err) {
    console.error('[LLM Agent] Claude error:', err);
    if (res) {
      res.write(`data: ${JSON.stringify({ error: err.message || String(err) })}\n\n`);
      res.end();
    }
    return { generatedCode: '', error: err.message || String(err), usedSchemas: schemasToUse };
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
    
    // Use robust intent detection that matches frontend logic
    const intent = detectIntent(message);
    const isSchemaIntent = intent.shouldGenerateSchema;
    const isSchemaEditing = isSchemaEditingIntent(message);
    
    // If we have a schema and the user mentions schema-related keywords, treat it as editing
    // But prioritize lambda requests over schema editing
    const hasSchemaKeywords = detectSchemaIntent(message);
    const shouldEditExisting = schema && (hasSchemaKeywords || isSchemaIntent) && !intent.shouldGenerateLambda;
    
    console.log('[Backend Agent System] Intent analysis:', {
      message,
      intent: intent.intent,
      shouldGenerateLambda: intent.shouldGenerateLambda,
      shouldGenerateSchema: intent.shouldGenerateSchema,
      isSchemaEditing,
      shouldEditExisting,
      hasSchemaKeywords
    });

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
          let chunkCount = 0;
          
          console.log('[LLM Agent] Starting schema editing streaming...');
          
          // Stream the schema editing in real-time
          for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta') {
              const content = chunk.delta.text;
              schemaContent += content;
              chunkCount++;
              
              // Stream the content to the frontend
              res.write(`data: ${JSON.stringify({ content, type: 'chat', route: 'schema' })}\n\n`);
              
              // Log progress every 10 chunks
              if (chunkCount % 10 === 0) {
                console.log(`[LLM Agent] Schema editing: sent ${chunkCount} chunks, content length: ${schemaContent.length} chars`);
              }
              
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

          console.log(`[LLM Agent] Schema editing streaming completed. Total chunks: ${chunkCount}, content length: ${schemaContent.length} chars`);
          
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
      // More robust lambda detection - check for lambda context even when schema keywords are present
      const lowerMessage = message.toLowerCase();
      const lambdaKeywords = ['lambda', 'function', 'handler', 'aws lambda', 'serverless'];
      const lambdaActionKeywords = ['generate', 'create', 'build', 'write', 'make', 'develop', 'code', 'program', 'implement'];
      
      // Check for lambda keywords
      const hasLambdaKeywords = lambdaKeywords.some(keyword => lowerMessage.includes(keyword));
      
      // Check for lambda action keywords combined with lambda context
      const hasLambdaAction = lambdaActionKeywords.some(action => lowerMessage.includes(action));
      const hasLambdaContext = hasLambdaKeywords || (hasLambdaAction && (lowerMessage.includes('handler') || lowerMessage.includes('function')));
      
      // Check if this is a lambda generation request (even if it mentions schema)
      const isLambdaGenerationRequest = hasLambdaContext && (
        hasLambdaKeywords || 
        (hasLambdaAction && lowerMessage.includes('handler')) ||
        (hasLambdaAction && lowerMessage.includes('function')) ||
        lowerMessage.includes('from this schema') || // Common pattern: "generate lambda from this schema"
        lowerMessage.includes('using this schema') || // Common pattern: "create lambda using this schema"
        lowerMessage.includes('with this schema') ||  // Common pattern: "build lambda with this schema"
        lowerMessage.includes('based on this schema') // Common pattern: "generate lambda based on this schema"
      );
      
      if (isLambdaGenerationRequest) {
        console.log('[LLM Agent] Lambda generation request detected (even with schema keywords), skipping schema generation');
        // Send a message to guide the user to use lambda generation
        res.write(`data: ${JSON.stringify({ content: "I detected that you want to generate a Lambda function! Since you have a schema dropped as context, I'll help you create a Lambda handler that uses that schema. Please use the Lambda tab or ask me to 'generate a lambda handler' to create Lambda functions. I'll help you with that!", type: 'chat', route: 'chat' })}\n\n`);
        res.end();
        return;
      }
      
      // Only generate new schema if no existing schema is available AND no lambda keywords detected
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
        let chunkCount = 0;
        
        console.log('[LLM Agent] Starting schema generation streaming...');
        
        // Stream the schema generation in real-time
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta') {
            const content = chunk.delta.text;
            schemaContent += content;
            chunkCount++;
            
            // Stream the content to the frontend
            res.write(`data: ${JSON.stringify({ content, type: 'chat', route: 'schema' })}\n\n`);
            
            // Log progress every 10 chunks
            if (chunkCount % 10 === 0) {
              console.log(`[LLM Agent] Schema generation: sent ${chunkCount} chunks, content length: ${schemaContent.length} chars`);
            }
            
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

        console.log(`[LLM Agent] Schema generation streaming completed. Total chunks: ${chunkCount}, content length: ${schemaContent.length} chars`);
        
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
      res.write(`data: ${JSON.stringify({ actions: [{ type: 'error', status: 'failed', message: error.message }], type: isSchemaIntent ? 'schema' : 'chat' })}\n\n`);
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