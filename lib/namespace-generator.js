import { Anthropic } from '@anthropic-ai/sdk';
import { docClient } from './dynamodb-client.js';
import { PutCommand, ScanCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

// Initialize Anthropic client lazily
let anthropic = null;

function getAnthropicClient() {
  if (!anthropic) {
    console.log('[Namespace Generator] Checking API key:', process.env.ANTHROPIC_API_KEY ? 'SET' : 'NOT SET');
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }
    console.log('[Namespace Generator] Initializing Anthropic client with API key');
    anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropic;
}

/**
 * Intelligent Namespace Generator
 * Creates complete namespaces from user prompts with AI-generated schemas, accounts, webhooks, and lambda fields
 */

// Enhanced prompt for namespace generation
const NAMESPACE_GENERATION_PROMPT = `You are an expert system architect and developer. Your task is to analyze a user's prompt and generate a complete namespace structure for a web application or service.

Based on the user's description, you need to create:

1. **Namespace Information**: Name, description, tags, and metadata
2. **Schemas**: Valid JSON schemas for data models (users, products, orders, etc.) - MUST include $schema, proper type definitions, and additionalProperties: false
3. **API Methods**: REST endpoints and operations
4. **Account Types**: Authentication and service accounts needed
5. **Webhook Endpoints**: Event-driven integrations
6. **Lambda Functions**: Serverless functions for business logic

User Prompt: {USER_PROMPT}

IMPORTANT SCHEMA REQUIREMENTS:
- All schemas MUST include "$schema": "https://json-schema.org/draft/2020-12/schema"
- All schemas MUST include "additionalProperties": false
- Use proper JSON Schema types: string, number, integer, boolean, array, object
- For date/time fields, use "format": "date-time"
- For email fields, use "format": "email"
- For enums, use "enum": ["value1", "value2"]
- Always include "required" array with required field names
- Use descriptive "description" fields for all properties

JSON SYNTAX REQUIREMENTS:
- Use double quotes for all strings
- Ensure all commas are properly placed
- Close all brackets and braces
- No trailing commas
- Escape special characters in strings
- Keep the JSON structure simple and clean

Please generate a comprehensive namespace structure. Return ONLY a valid JSON object with this exact structure:

{
  "namespace": {
    "namespace-name": "string",
    "namespace-description": "string", 
    "namespace-url": "string",
    "tags": ["string"],
    "created-at": "ISO_DATE_STRING"
  },
  "schemas": [
    {
      "schemaName": "string",
      "schemaType": "object",
      "description": "string",
      "schema": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "field1": {"type": "string", "description": "string"},
          "field2": {"type": "number", "description": "string"}
        },
        "required": ["field1"],
        "additionalProperties": false
      }
    }
  ],
  "methods": [
    {
      "namespace-method-name": "string",
      "namespace-method-type": "GET|POST|PUT|DELETE",
      "namespace-method-url-override": "string",
      "description": "string",
      "requestBody": {
        "type": "object",
        "properties": {},
        "required": []
      },
      "response": {
        "type": "object",
        "properties": {},
        "required": []
      }
    }
  ],
  "accounts": [
    {
      "accountName": "string",
      "accountType": "string",
      "description": "string",
      "config": {}
    }
  ],
  "webhooks": [
    {
      "webhookName": "string",
      "webhookUrl": "string",
      "description": "string",
      "events": ["string"]
    }
  ],
  "lambdaFunctions": [
    {
      "functionName": "string",
      "description": "string",
      "runtime": "nodejs18.x",
      "handler": "index.handler",
      "memory": 256,
      "timeout": 30,
      "environment": {},
      "code": "// Lambda function code here"
    }
  ]
}

Make sure to:
- Create realistic and useful schemas based on the user's needs
- Include common CRUD operations for each schema
- Add appropriate authentication accounts
- Include relevant webhooks for real-time features
- Generate practical Lambda functions for business logic
- Use proper JSON schema validation
- Make field names descriptive and consistent
- Include proper error handling in Lambda functions

CRITICAL JSON FORMATTING REQUIREMENTS:
- Return ONLY valid JSON, no explanations, no markdown, no code blocks
- Ensure all strings are properly quoted with double quotes
- Ensure all commas are in the correct positions
- Ensure all brackets and braces are properly closed
- Do not include any text before or after the JSON
- Validate that the JSON is syntactically correct

Return ONLY the JSON object, no explanations or markdown formatting.`;

/**
 * Generate a complete namespace from user prompt
 */
export async function generateNamespaceFromPrompt(userPrompt) {
  console.log('[Namespace Generator] Starting namespace generation for prompt:', userPrompt);
  
  try {
    // Call Anthropic to generate the namespace structure
    const anthropicClient = getAnthropicClient();
    
    console.log('[Namespace Generator] Calling Anthropic API...');
    console.log('[Namespace Generator] Model: claude-3-5-sonnet-20240620');
    console.log('[Namespace Generator] Max tokens: 4000');
    
    const stream = await anthropicClient.messages.create({
      model: 'claude-3-5-sonnet-20240620',
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: NAMESPACE_GENERATION_PROMPT.replace('{USER_PROMPT}', userPrompt)
        }
      ],
      stream: true
    }).catch(apiError => {
      console.error('[Namespace Generator] Anthropic API Error:', apiError);
      throw apiError;
    });
    
    console.log('[Namespace Generator] API call successful');

    // Collect the streaming response
    let content = '';
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
        content += chunk.delta.text;
      }
    }
    console.log('[Namespace Generator] Raw LLM response:', content);

    // Extract JSON from the response
    let namespaceData;
    try {
      // Try to parse the entire response as JSON
      namespaceData = JSON.parse(content);
    } catch (parseError) {
      console.error('[Namespace Generator] JSON Parse Error:', parseError.message);
      console.error('[Namespace Generator] Content around error position:', content.substring(Math.max(0, parseError.message.match(/position (\d+)/)?.[1] - 100 || 0), (parseError.message.match(/position (\d+)/)?.[1] || 0) + 100));
      
      // If that fails, try to extract JSON from code blocks
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/i) || 
                       content.match(/```\s*([\s\S]*?)\s*```/i) ||
                       content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        try {
          namespaceData = JSON.parse(jsonStr);
        } catch (secondParseError) {
          console.error('[Namespace Generator] Second JSON Parse Error:', secondParseError.message);
          throw new Error(`Invalid JSON generated by AI: ${secondParseError.message}. Please try again with a more specific description.`);
        }
      } else {
        throw new Error('No valid JSON found in LLM response. Please try again with a more specific description.');
      }
    }

    console.log('[Namespace Generator] Parsed namespace data:', namespaceData);

    // Validate the JSON structure
    if (!namespaceData || typeof namespaceData !== 'object') {
      throw new Error('Generated data is not a valid object');
    }

    // Validate the structure
    if (!namespaceData.namespace || !namespaceData.schemas) {
      throw new Error('Invalid namespace structure generated');
    }

    // Generate unique namespace ID
    const namespaceId = uuidv4();
    
    // Add timestamps and IDs
    const now = new Date().toISOString();
    namespaceData.namespace['namespace-id'] = namespaceId;
    namespaceData.namespace['created-at'] = now;
    
    // Add IDs to all components
    namespaceData.schemas = namespaceData.schemas.map(schema => ({
      ...schema,
      id: uuidv4(),
      namespaceId: namespaceId,
      createdAt: now,
      updatedAt: now
    }));

    namespaceData.methods = namespaceData.methods.map(method => ({
      ...method,
      id: uuidv4(),
      'namespace-id': namespaceId,
      createdAt: now
    }));

    namespaceData.accounts = namespaceData.accounts.map(account => ({
      ...account,
      id: uuidv4(),
      'namespace-id': namespaceId,
      createdAt: now
    }));

    namespaceData.webhooks = namespaceData.webhooks.map(webhook => ({
      ...webhook,
      id: uuidv4(),
      namespaceId: namespaceId,
      createdAt: now
    }));

    namespaceData.lambdaFunctions = namespaceData.lambdaFunctions.map(lambda => ({
      ...lambda,
      id: uuidv4(),
      namespaceId: namespaceId,
      createdAt: now
    }));

    return {
      success: true,
      namespaceId: namespaceId,
      data: namespaceData
    };

  } catch (error) {
    console.error('[Namespace Generator] Error generating namespace:', error);
    console.error('[Namespace Generator] Error details:', {
      message: error.message,
      code: error.code,
      status: error.status,
      stack: error.stack
    });
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Save the generated namespace to DynamoDB
 */
export async function saveGeneratedNamespace(namespaceData) {
  console.log('[Namespace Generator] Saving namespace to database...');
  
  try {
    const { namespace, schemas, methods, accounts, webhooks, lambdaFunctions, stepFunctions } = namespaceData;
    
    // Save namespace
    await docClient.send(new PutCommand({
      TableName: 'brmh-namespace',
      Item: {
        id: namespace['namespace-id'],
        data: namespace
      }
    }));

    // Save schemas
    for (const schema of schemas) {
      await docClient.send(new PutCommand({
        TableName: 'brmh-schemas',
        Item: schema
      }));
    }

    // Save methods
    for (const method of methods) {
      await docClient.send(new PutCommand({
        TableName: 'brmh-namespace-methods',
        Item: {
          id: method.id,
          data: method
        }
      }));
    }

    // Save accounts
    for (const account of accounts) {
      await docClient.send(new PutCommand({
        TableName: 'brmh-namespace-accounts',
        Item: account
      }));
    }

    // Save webhooks
    for (const webhook of webhooks) {
      await docClient.send(new PutCommand({
        TableName: 'brmh-webhooks',
        Item: webhook
      }));
    }

    // Save lambda functions (as schemas for now, can be extended later)
    for (const lambda of lambdaFunctions) {
      await docClient.send(new PutCommand({
        TableName: 'brmh-lambda-functions',
        Item: lambda
      }));
    }

    // Save Step Functions definitions if provided
    if (Array.isArray(stepFunctions)) {
      for (const sfn of stepFunctions) {
        await docClient.send(new PutCommand({
          TableName: 'brmh-step-functions',
          Item: sfn
        }));
      }
    }

    console.log('[Namespace Generator] Successfully saved namespace to database');
    return { success: true };

  } catch (error) {
    console.error('[Namespace Generator] Error saving namespace:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Generate a namespace using richer artifacts (BRD/HLD/LLD and attachments)
 */
export async function generateNamespaceFromArtifacts({ prompt = '', brd = '', hld = '', lld = '', attachments = [] }) {
  const attachmentSummaries = (attachments || []).map((f, i) => `Attachment ${i + 1}: name=${f.name || 'file'}, type=${f.type || 'unknown'}, size=${f.size || 0}`).join('\n');

  // Extract text content from supported files
  async function extractText(attachment) {
    try {
      const { type, buffer } = attachment || {};
      if (!buffer || !type) return '';

      // Plain text or markdown
      if (type.includes('text/plain') || type.includes('text/markdown')) {
        return buffer.toString('utf8');
      }

      // JSON
      if (type.includes('application/json')) {
        return buffer.toString('utf8');
      }

      // PDF (optional dependency pdf-parse)
      if (type.includes('application/pdf')) {
        try {
          const pdfParse = (await import('pdf-parse')).default || (await import('pdf-parse'));
          const data = await pdfParse(buffer);
          return data.text || '';
        } catch (_) {
          return '';
        }
      }

      // DOCX (optional dependency mammoth)
      if (type.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) {
        try {
          const mammoth = await import('mammoth');
          const result = await mammoth.extractRawText({ buffer });
          return result.value || '';
        } catch (_) {
          return '';
        }
      }

      return '';
    } catch (_) {
      return '';
    }
  }

  const extracted = [];
  for (const att of attachments || []) {
    const text = await extractText(att);
    if (text) {
      const safe = text.length > 20000 ? text.slice(0, 20000) : text;
      extracted.push({ name: att.name || 'file', type: att.type || 'unknown', text: safe });
    }
  }

  const extractedSection = extracted.length
    ? ('\n\nExtracted Contents (truncated):\n' + extracted.map((e, i) => `---\n[${i + 1}] ${e.name} (${e.type})\n${e.text}`).join('\n'))
    : '';

  const mergedPrompt = `Project Description:\n${prompt}\n\nBusiness Requirements (BRD):\n${brd}\n\nHigh Level Design (HLD):\n${hld}\n\nLow Level Design (LLD):\n${lld}\n\nAttachments Summary:\n${attachmentSummaries}${extractedSection}`.trim();

  return await generateNamespaceFromPrompt(mergedPrompt);
}

/**
 * Check if user is in general AI Assistant context (no specific namespace)
 */
export function isGeneralAIContext(namespace, uploadedSchemas, droppedSchemas) {
  // Check if no specific namespace is open
  // namespace can be null, undefined, or a string (namespace ID)
  const hasNoNamespace = !namespace || namespace === null || namespace === undefined;
  
  // Check if no schemas are loaded
  const hasNoSchemas = (!uploadedSchemas || uploadedSchemas.length === 0) && 
                      (!droppedSchemas || droppedSchemas.length === 0);
  
  return hasNoNamespace && hasNoSchemas;
}

/**
 * Detect if user prompt is requesting namespace generation
 */
export function detectNamespaceGenerationIntent(message) {
  const lower = message.toLowerCase();
  
  // Action words that indicate creation/generation
  const actionWords = ['create', 'generate', 'build', 'make', 'new'];
  
  // Target words that indicate what to create
  const targetWords = ['namespace', 'project', 'system', 'app', 'application'];
  
  // Check for direct keyword matches
  const namespaceKeywords = [
    'create namespace', 'generate namespace', 'build namespace', 'make namespace',
    'new namespace', 'namespace for', 'namespace with', 'complete namespace',
    'full namespace', 'entire namespace', 'whole namespace'
  ];
  
  const projectKeywords = [
    'create project', 'generate project', 'build project', 'make project',
    'new project', 'project for', 'project with', 'complete project',
    'full project', 'entire project', 'whole project'
  ];
  
  const systemKeywords = [
    'create system', 'generate system', 'build system', 'make system',
    'new system', 'system for', 'system with', 'complete system',
    'full system', 'entire system', 'whole system'
  ];
  
  const appKeywords = [
    'create app', 'generate app', 'build app', 'make app',
    'new app', 'app for', 'app with', 'complete app',
    'full app', 'entire app', 'whole app'
  ];
  
  const allKeywords = [...namespaceKeywords, ...projectKeywords, ...systemKeywords, ...appKeywords];
  
  // Check for direct keyword matches first
  if (allKeywords.some(keyword => lower.includes(keyword))) {
    return true;
  }
  
  // Check for action + target word combinations (more flexible matching)
  const hasActionWord = actionWords.some(action => lower.includes(action));
  const hasTargetWord = targetWords.some(target => lower.includes(target));
  
  // If message contains both an action word and a target word, it's likely a generation request
  if (hasActionWord && hasTargetWord) {
    return true;
  }
  
  return false;
}

/**
 * Generate BRD/HLD/LLD documents from namespace context
 */
export async function generateDocumentsFromNamespace({ namespaceId, documentTypes = ['brd', 'hld', 'lld'], format = 'json' }) {
  try {
    console.log(`[Document Generator] Generating documents for namespace: ${namespaceId}`);
    
    // Get namespace data
    console.log(`[Document Generator] Looking up namespace: ${namespaceId}`);
    const namespaceResult = await docClient.send(new GetCommand({
      TableName: 'brmh-namespace',
      Key: { id: namespaceId }
    }));
    
    console.log(`[Document Generator] Namespace lookup result:`, namespaceResult);
    
    if (!namespaceResult.Item) {
      console.log(`[Document Generator] Namespace not found in database`);
      return { success: false, error: 'Namespace not found' };
    }
    
    const namespace = namespaceResult.Item;
    
    // Get related schemas
    const schemasResult = await docClient.send(new ScanCommand({
      TableName: 'brmh-schemas',
      FilterExpression: 'namespaceId = :namespaceId',
      ExpressionAttributeValues: { ':namespaceId': namespaceId }
    }));
    
    const schemas = schemasResult.Items || [];
    
    // Get related methods
    const methodsResult = await docClient.send(new ScanCommand({
      TableName: 'brmh-namespace-methods',
      FilterExpression: 'namespaceId = :namespaceId',
      ExpressionAttributeValues: { ':namespaceId': namespaceId }
    }));
    
    const methods = methodsResult.Items || [];
    
    // Get related lambda functions
    const lambdaResult = await docClient.send(new ScanCommand({
      TableName: 'brmh-lambda-functions',
      FilterExpression: 'namespaceId = :namespaceId',
      ExpressionAttributeValues: { ':namespaceId': namespaceId }
    }));
    
    const lambdaFunctions = lambdaResult.Items || [];
    
    const anthropic = getAnthropicClient();
    const documents = {};
    
    // Generate each requested document type
    for (const docType of documentTypes) {
      let prompt = '';
      let systemPrompt = '';
      
      switch (docType.toLowerCase()) {
        case 'brd':
          systemPrompt = `You are a business analyst creating a Business Requirements Document (BRD). Generate a comprehensive BRD based on the provided namespace information.`;
          prompt = `Create a Business Requirements Document (BRD) for the following system:

NAMESPACE INFORMATION:
- Name: ${namespace['namespace-name'] || 'N/A'}
- Description: ${namespace['namespace-description'] || 'N/A'}
- Tags: ${namespace.tags ? namespace.tags.join(', ') : 'N/A'}

SCHEMAS (${schemas.length} found):
${schemas.map(s => `- ${s.schemaName}: ${s.description || 'No description'}`).join('\n')}

API METHODS (${methods.length} found):
${methods.map(m => `- ${m.methodName}: ${m.description || 'No description'} (${m.httpMethod} ${m.endpoint})`).join('\n')}

LAMBDA FUNCTIONS (${lambdaFunctions.length} found):
${lambdaFunctions.map(l => `- ${l.functionName}: ${l.description || 'No description'}`).join('\n')}

Please generate a comprehensive BRD that includes:
1. Executive Summary
2. Business Objectives
3. Functional Requirements
4. Non-Functional Requirements
5. User Stories
6. Acceptance Criteria
7. Assumptions and Constraints
8. Success Metrics

Format the output as structured JSON with clear sections and detailed requirements.`;
          break;
          
        case 'hld':
          systemPrompt = `You are a solution architect creating a High-Level Design (HLD) document. Generate a comprehensive HLD based on the provided namespace information.`;
          prompt = `Create a High-Level Design (HLD) document for the following system:

NAMESPACE INFORMATION:
- Name: ${namespace['namespace-name'] || 'N/A'}
- Description: ${namespace['namespace-description'] || 'N/A'}
- Tags: ${namespace.tags ? namespace.tags.join(', ') : 'N/A'}

SCHEMAS (${schemas.length} found):
${schemas.map(s => `- ${s.schemaName}: ${JSON.stringify(s.schema, null, 2)}`).join('\n\n')}

API METHODS (${methods.length} found):
${methods.map(m => `- ${m.methodName}: ${m.httpMethod} ${m.endpoint}\n  Description: ${m.description || 'No description'}\n  Parameters: ${JSON.stringify(m.parameters || {}, null, 2)}`).join('\n\n')}

LAMBDA FUNCTIONS (${lambdaFunctions.length} found):
${lambdaFunctions.map(l => `- ${l.functionName}: ${l.description || 'No description'}\n  Runtime: ${l.runtime}\n  Handler: ${l.handler}`).join('\n\n')}

Please generate a comprehensive HLD that includes:
1. System Overview
2. Architecture Diagram (describe in text)
3. Component Design
4. Data Flow
5. API Design
6. Database Design
7. Security Design
8. Integration Points
9. Scalability Considerations
10. Technology Stack

Format the output as structured JSON with clear sections and technical details.`;
          break;
          
        case 'lld':
          systemPrompt = `You are a technical lead creating a Low-Level Design (LLD) document. Generate a comprehensive LLD based on the provided namespace information.`;
          prompt = `Create a Low-Level Design (LLD) document for the following system:

NAMESPACE INFORMATION:
- Name: ${namespace['namespace-name'] || 'N/A'}
- Description: ${namespace['namespace-description'] || 'N/A'}
- Tags: ${namespace.tags ? namespace.tags.join(', ') : 'N/A'}

SCHEMAS (${schemas.length} found):
${schemas.map(s => `- ${s.schemaName}: ${JSON.stringify(s.schema, null, 2)}`).join('\n\n')}

API METHODS (${methods.length} found):
${methods.map(m => `- ${m.methodName}: ${m.httpMethod} ${m.endpoint}\n  Description: ${m.description || 'No description'}\n  Parameters: ${JSON.stringify(m.parameters || {}, null, 2)}\n  Response: ${JSON.stringify(m.response || {}, null, 2)}`).join('\n\n')}

LAMBDA FUNCTIONS (${lambdaFunctions.length} found):
${lambdaFunctions.map(l => `- ${l.functionName}: ${l.description || 'No description'}\n  Runtime: ${l.runtime}\n  Handler: ${l.handler}\n  Code: ${l.code ? l.code.substring(0, 500) + '...' : 'No code available'}`).join('\n\n')}

Please generate a comprehensive LLD that includes:
1. Detailed Component Specifications
2. Database Schema Design
3. API Endpoint Specifications
4. Function/Method Implementations
5. Error Handling
6. Logging and Monitoring
7. Configuration Management
8. Testing Strategy
9. Deployment Procedures
10. Performance Optimization

Format the output as structured JSON with clear sections and implementation details.`;
          break;
          
        default:
          continue;
      }
      
      try {
        const response = await anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 4000,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        });
        
        const content = response.content[0].text;
        
        // Parse JSON response or create structured object
        try {
          documents[docType] = JSON.parse(content);
        } catch (parseError) {
          // If not valid JSON, wrap in structured format
          documents[docType] = {
            type: docType.toUpperCase(),
            namespaceId: namespaceId,
            generatedAt: new Date().toISOString(),
            content: content,
            format: 'text'
          };
        }
        
        console.log(`[Document Generator] Generated ${docType.toUpperCase()} document`);
      } catch (error) {
        console.error(`[Document Generator] Error generating ${docType}:`, error);
        documents[docType] = {
          type: docType.toUpperCase(),
          namespaceId: namespaceId,
          error: error.message,
          generatedAt: new Date().toISOString()
        };
      }
    }
    
    console.log(`[Document Generator] Successfully generated ${Object.keys(documents).length} documents`);
    return { success: true, documents };
    
  } catch (error) {
    console.error('[Document Generator] Error:', error);
    return { success: false, error: error.message };
  }
}
