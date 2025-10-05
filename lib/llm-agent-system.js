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
import { generateNamespaceFromPrompt, saveGeneratedNamespace, isGeneralAIContext, detectNamespaceGenerationIntent } from './namespace-generator.js';

// Validate API key configuration
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[LLM Agent] ANTHROPIC_API_KEY environment variable is not set!');
  throw new Error('ANTHROPIC_API_KEY environment variable is required');
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// LangChain Claude instance
const chat = new ChatAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: "claude-3-5-sonnet-20240620"
});

// Enhanced workspace context and guidance system
const WORKSPACE_FEATURES = {
  webScraping: {
    name: "Web Scraping",
    description: "Automatically scrape APIs, schemas, and documentation from websites",
    endpoints: [
      "/web-scraping/scrape-auto-namespace",
      "/web-scraping/scrape-and-save", 
      "/web-scraping/scrape-preview",
      "/web-scraping/migrate-existing-namespaces"
    ],
    capabilities: [
      "Scrape known services (GitHub, Stripe, Shopify, etc.)",
      "Scrape custom URLs",
      "Automatic namespace management",
      "Create namespace methods from scraped APIs",
      "Migrate existing namespaces"
    ],
    uiLocation: "Web Scraping tab in the main interface"
  },
  lambdaFunctions: {
    name: "AWS Lambda Functions",
    description: "Generate, deploy, and manage serverless functions",
    endpoints: [
      "/lambda/generate",
      "/lambda/deploy",
      "/lambda/list",
      "/lambda/update"
    ],
    capabilities: [
      "Generate Lambda functions from schemas",
      "Auto-deploy to AWS",
      "Function management and updates",
      "Schema-based code generation"
    ],
    uiLocation: "Lambda tab in the main interface"
  },
  schemas: {
    name: "Data Schemas",
    description: "Create and manage JSON schemas for data validation",
    endpoints: [
      "/schemas/create",
      "/schemas/list",
      "/schemas/update",
      "/save-schema-to-namespace"
    ],
    capabilities: [
      "Create JSON schemas",
      "Schema validation",
      "Namespace organization",
      "Schema-based code generation"
    ],
    uiLocation: "Schemas tab in the main interface"
  },
  namespaces: {
    name: "Namespace Management",
    description: "Organize and manage your APIs, schemas, and resources",
    endpoints: [
      "/namespaces/list",
      "/namespaces/create",
      "/namespaces/methods",
      "/namespaces/accounts"
    ],
    capabilities: [
      "Create and manage namespaces",
      "Organize APIs and schemas",
      "Namespace methods management",
      "Account management"
    ],
    uiLocation: "Namespace Library tab in the main interface"
  },
  awsServices: {
    name: "AWS Services Management",
    description: "Manage AWS resources directly from the workspace",
    endpoints: [
      "/aws/lambda",
      "/aws/dynamodb", 
      "/aws/s3",
      "/aws/iam",
      "/aws/apigateway"
    ],
    capabilities: [
      "Lambda function management",
      "DynamoDB table operations",
      "S3 bucket management",
      "IAM user and role management",
      "API Gateway configuration"
    ],
    uiLocation: "AWS Services tab in the main interface"
  }
};

// Helper function to get real namespace data with enhanced context
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

// Enhanced intent detection with workspace guidance
function detectIntentWithGuidance(message) {
  const lower = message.toLowerCase();
  
  // Workspace navigation and guidance intents
  const guidancePatterns = {
    help: /help|guide|how to|what can|show me|explain|tutorial|getting started/i,
    webScraping: /scrape|web scraping|api scraping|documentation scraping|github|stripe|shopify/i,
    lambda: /lambda|function|serverless|aws lambda|deploy/i, // Removed 'generate function' to avoid conflicts
    schemas: /schema|json schema|data model|structure|validation|show schemas|list schemas|available schemas/i,
    namespaces: /namespace|organize|library|manage|about namespace|namespace info|what is namespace|tell me about namespace|show namespace|list namespace/i,
    methods: /methods|api methods|show methods|list methods|available methods|endpoints|apis/i,
    awsServices: /aws|amazon|dynamodb|s3|iam|api gateway|cloud/i,
    openTab: /open|go to|navigate to|switch to|show tab/i
  };

  // Check for guidance requests - but prioritize explicit generation intents
  const hasExplicitGeneration = /generate|create|build|make|develop|write|code|program|implement/i.test(lower);
  
  // Only treat as guidance if it's not an explicit generation request
  if (!hasExplicitGeneration) {
    for (const [feature, pattern] of Object.entries(guidancePatterns)) {
      if (pattern.test(message)) {
        return {
          intent: 'guidance',
          feature: feature,
          message: message,
          shouldProvideGuidance: true
        };
      }
    }
  }

  // Original intent detection logic
  const originalIntent = detectIntent(message);
  
  return {
    ...originalIntent,
    shouldProvideGuidance: false,
    feature: null
  };
}

// Generate workspace guidance and navigation suggestions
function generateWorkspaceGuidance(intent, feature, namespaceData = null) {
  const guidance = {
    suggestions: [],
    nextSteps: [],
    uiActions: []
  };

  if (intent === 'guidance') {
    switch (feature) {
      case 'help':
        guidance.suggestions = [
          "I can help you with web scraping, Lambda functions, schemas, and AWS services!",
          "Try asking me to 'scrape GitHub APIs' or 'generate a Lambda function'",
          "I can guide you to different tabs and features in the workspace"
        ];
        guidance.nextSteps = [
          "What would you like to work on? I can help with:",
          "• Web scraping APIs and documentation",
          "• Generating AWS Lambda functions", 
          "• Creating and managing schemas",
          "• Organizing your work in namespaces",
          "• Managing AWS services"
        ];
        break;

      case 'webScraping':
        guidance.suggestions = [
          "Web scraping can automatically extract APIs, schemas, and documentation from websites",
          "I can scrape known services like GitHub, Stripe, Shopify, or any custom URL"
        ];
        guidance.nextSteps = [
          "To get started with web scraping:",
          "1. Go to the Web Scraping tab",
          "2. Enter a service name (like 'github') or URL",
          "3. I'll automatically create a namespace and extract the APIs"
        ];
        guidance.uiActions = [
          { action: 'openTab', tab: 'webScraping', description: 'Open Web Scraping tab' }
        ];
        break;

      case 'lambda':
        // Build information about available resources for Lambda generation
        let lambdaInfo = '';
        if (namespaceData) {
          const availableSchemas = namespaceData.schemas?.length || 0;
          const availableMethods = namespaceData.methods?.length || 0;
          
          lambdaInfo = `\n\n**🚀 Lambda Generation Resources:**\n`;
          lambdaInfo += `• **Available Schemas:** ${availableSchemas} (can be used as input/output types)\n`;
          lambdaInfo += `• **Available API Methods:** ${availableMethods} (can be integrated with Lambda functions)\n`;
          
          if (availableSchemas > 0) {
            lambdaInfo += `\n**📋 Schemas you can use:**\n`;
            namespaceData.schemas.slice(0, 5).forEach((schema, index) => {
              const schemaName = schema.schemaName || schema.name || 'Unnamed Schema';
              lambdaInfo += `${index + 1}. ${schemaName}\n`;
            });
            if (availableSchemas > 5) {
              lambdaInfo += `   ... and ${availableSchemas - 5} more schemas\n`;
            }
          }
          
          if (availableMethods > 0) {
            lambdaInfo += `\n**🔗 API Methods you can integrate:**\n`;
            namespaceData.methods.slice(0, 5).forEach((method, index) => {
              const methodName = method['namespace-method-name'] || method.methodName || 'Unnamed Method';
              const methodType = method['namespace-method-type'] || method.methodType || 'GET';
              lambdaInfo += `${index + 1}. ${methodName} (${methodType})\n`;
            });
            if (availableMethods > 5) {
              lambdaInfo += `   ... and ${availableMethods - 5} more methods\n`;
            }
          }
        }
        
        guidance.suggestions = [
          "I can generate AWS Lambda functions from your schemas or requirements",
          "Functions are automatically deployed to your AWS account",
          lambdaInfo
        ];
        guidance.nextSteps = [
          "**Available Actions:**",
          "• Type the name of a schema to generate a Lambda function (e.g., 'UserSchema')",
          "• Ask me to 'generate Lambda for [schema name]'",
          "• Ask me to 'create a Lambda that uses [schema name]'",
          "• Ask me to 'build a Lambda that calls [API method]'",
          "• Go to the Lambda tab to see the generated code",
          "• Go to the Schemas tab to create schemas first"
        ];
        guidance.uiActions = [
          { action: 'openTab', tab: 'lambda', description: 'Open Lambda tab' }
        ];
        break;

      case 'schemas':
        // Build detailed schema information if available
        let schemaInfo = '';
        if (namespaceData && namespaceData.schemas && namespaceData.schemas.length > 0) {
          schemaInfo = `\n\n**📋 Available Schemas in Current Namespace (${namespaceData.schemas.length}):**\n`;
          namespaceData.schemas.forEach((schema, index) => {
            const schemaName = schema.schemaName || schema.name || 'Unnamed Schema';
            const schemaType = schema.schemaType || schema.type || 'JSON';
            const description = schema.description || schema.schemaDescription || '';
            const createdAt = schema.createdAt || schema['created-at'] || '';
            
            schemaInfo += `${index + 1}. **${schemaName}** (${schemaType})\n`;
            if (description) {
              schemaInfo += `   Description: ${description.substring(0, 150)}${description.length > 150 ? '...' : ''}\n`;
            }
            if (createdAt) {
              schemaInfo += `   Created: ${createdAt}\n`;
            }
            schemaInfo += `\n`;
          });
        } else {
          schemaInfo = "\n\n**📋 No schemas available in current namespace**\n";
        }
        
        guidance.suggestions = [
          "Schemas define the structure of your data and enable validation",
          "I can create schemas from examples or generate them for you",
          schemaInfo
        ];
        guidance.nextSteps = [
          "**Available Actions:**",
          "• Ask me to 'create a schema for [your data type]'",
          "• Ask me to 'generate a Lambda function' using your schemas",
          "• Go to the Schemas tab to view and edit schemas",
          "• Go to the Web Scraping tab to automatically generate schemas from APIs"
        ];
        guidance.uiActions = [
          { action: 'openTab', tab: 'schemas', description: 'Open Schemas tab' }
        ];
        break;

      case 'namespaces':
        // Build comprehensive namespace information if available
        let namespaceInfo = '';
        if (namespaceData && namespaceData.namespaceInfo) {
          const ns = namespaceData.namespaceInfo;
          namespaceInfo = `\n\n**📁 Current Namespace: ${ns['namespace-name'] || 'Unknown'}**\n`;
          namespaceInfo += `• **ID:** ${ns['namespace-id'] || 'Unknown'}\n`;
          namespaceInfo += `• **URL:** ${ns['namespace-url'] || 'Not specified'}\n`;
          namespaceInfo += `• **Tags:** ${(ns.tags || []).join(', ') || 'None'}\n`;
          namespaceInfo += `• **Created:** ${ns['created-at'] || 'Unknown'}\n`;
          
          // Detailed schemas information
          if (namespaceData.schemas && namespaceData.schemas.length > 0) {
            namespaceInfo += `\n\n**📋 Available Schemas (${namespaceData.schemas.length}):**\n`;
            namespaceData.schemas.forEach((schema, index) => {
              const schemaName = schema.schemaName || schema.name || 'Unnamed Schema';
              const schemaType = schema.schemaType || schema.type || 'JSON';
              const description = schema.description || schema.schemaDescription || '';
              namespaceInfo += `${index + 1}. **${schemaName}** (${schemaType})\n`;
              if (description) {
                namespaceInfo += `   ${description.substring(0, 100)}${description.length > 100 ? '...' : ''}\n`;
              }
            });
          } else {
            namespaceInfo += `\n\n**📋 Schemas:** None available\n`;
          }
          
          // Detailed API methods information
          if (namespaceData.methods && namespaceData.methods.length > 0) {
            namespaceInfo += `\n\n**🔗 Available API Methods (${namespaceData.methods.length}):**\n`;
            namespaceData.methods.slice(0, 15).forEach((method, index) => {
              const methodName = method['namespace-method-name'] || method.methodName || 'Unnamed Method';
              const methodType = method['namespace-method-type'] || method.methodType || 'GET';
              const methodUrl = method['namespace-method-url-override'] || method.url || '';
              namespaceInfo += `${index + 1}. **${methodName}** (${methodType})\n`;
              if (methodUrl) {
                namespaceInfo += `   URL: ${methodUrl}\n`;
              }
            });
            if (namespaceData.methods.length > 15) {
              namespaceInfo += `   ... and ${namespaceData.methods.length - 15} more methods\n`;
            }
          } else {
            namespaceInfo += `\n\n**🔗 API Methods:** None available\n`;
          }
          
          // Webhooks information
          if (namespaceData.webhooks && namespaceData.webhooks.length > 0) {
            namespaceInfo += `\n\n**🔔 Webhooks (${namespaceData.webhooks.length}):**\n`;
            namespaceData.webhooks.forEach((webhook, index) => {
              const webhookName = webhook.webhookName || webhook.name || 'Unnamed Webhook';
              const webhookUrl = webhook.webhookUrl || webhook.url || '';
              namespaceInfo += `${index + 1}. **${webhookName}**\n`;
              if (webhookUrl) {
                namespaceInfo += `   URL: ${webhookUrl}\n`;
              }
            });
          } else {
            namespaceInfo += `\n\n**🔔 Webhooks:** None available\n`;
          }
          
          // Accounts information
          if (namespaceData.accounts && namespaceData.accounts.length > 0) {
            namespaceInfo += `\n\n**👤 Accounts (${namespaceData.accounts.length}):**\n`;
            namespaceData.accounts.forEach((account, index) => {
              const accountName = account.accountName || account.name || 'Unnamed Account';
              const accountType = account.accountType || account.type || 'Unknown';
              namespaceInfo += `${index + 1}. **${accountName}** (${accountType})\n`;
            });
          } else {
            namespaceInfo += `\n\n**👤 Accounts:** None available\n`;
          }
          
          // Summary statistics
          const totalResources = (namespaceData.schemas?.length || 0) + 
                                (namespaceData.methods?.length || 0) + 
                                (namespaceData.webhooks?.length || 0) + 
                                (namespaceData.accounts?.length || 0);
          namespaceInfo += `\n\n**📊 Summary:** ${totalResources} total resources in this namespace\n`;
        } else {
          namespaceInfo = "\n\n**No current namespace information available**\n";
        }
        
        guidance.suggestions = [
          "Namespaces help organize your APIs, schemas, and resources",
          "Each namespace can contain multiple APIs, schemas, and methods",
          namespaceInfo
        ];
        guidance.nextSteps = [
          "**Available Actions:**",
          "• Ask me to 'show schemas' for detailed schema information",
          "• Ask me to 'show methods' for detailed API method information", 
          "• Ask me to 'generate a Lambda function' using your schemas",
          "• Go to the Namespace Library tab to manage namespaces",
          "• Go to the Web Scraping tab to add more APIs"
        ];
        guidance.uiActions = [
          { action: 'openTab', tab: 'namespaces', description: 'Open Namespace Library tab' }
        ];
        break;

      case 'methods':
        // Build detailed methods information if available
        let methodsInfo = '';
        if (namespaceData && namespaceData.methods && namespaceData.methods.length > 0) {
          methodsInfo = `\n\n**🔗 Available API Methods in Current Namespace (${namespaceData.methods.length}):**\n`;
          namespaceData.methods.forEach((method, index) => {
            const methodName = method['namespace-method-name'] || method.methodName || 'Unnamed Method';
            const methodType = method['namespace-method-type'] || method.methodType || 'GET';
            const methodUrl = method['namespace-method-url-override'] || method.url || '';
            const description = method.description || method.methodDescription || '';
            const createdAt = method.createdAt || method['created-at'] || '';
            
            methodsInfo += `${index + 1}. **${methodName}** (${methodType})\n`;
            if (methodUrl) {
              methodsInfo += `   URL: ${methodUrl}\n`;
            }
            if (description) {
              methodsInfo += `   Description: ${description.substring(0, 100)}${description.length > 100 ? '...' : ''}\n`;
            }
            if (createdAt) {
              methodsInfo += `   Created: ${createdAt}\n`;
            }
            methodsInfo += `\n`;
          });
        } else {
          methodsInfo = "\n\n**🔗 No API methods available in current namespace**\n";
        }
        
        guidance.suggestions = [
          "API methods define the endpoints and operations available in your namespace",
          "These can be used to generate Lambda functions or integrate with external services",
          methodsInfo
        ];
        guidance.nextSteps = [
          "**Available Actions:**",
          "• Ask me to 'generate a Lambda function that calls [method name]'",
          "• Ask me to 'create a schema for [method name] response'",
          "• Go to the Web Scraping tab to add more API methods",
          "• Go to the Lambda tab to build functions using these methods"
        ];
        guidance.uiActions = [
          { action: 'openTab', tab: 'webScraping', description: 'Open Web Scraping tab to add more APIs' }
        ];
        break;

      case 'awsServices':
        guidance.suggestions = [
          "I can help you manage AWS services directly from this workspace",
          "Available services: Lambda, DynamoDB, S3, IAM, API Gateway"
        ];
        guidance.nextSteps = [
          "To manage AWS services:",
          "1. Go to the AWS Services tab",
          "2. Select the service you want to manage",
          "3. View, create, or update resources"
        ];
        guidance.uiActions = [
          { action: 'openTab', tab: 'awsServices', description: 'Open AWS Services tab' }
        ];
        break;
    }
  }

  // Add context-aware suggestions based on current namespace
  if (namespaceData && namespaceData.namespaceInfo) {
    const namespace = namespaceData.namespaceInfo;
    const schemas = namespaceData.schemas;
    const methods = namespaceData.methods;

    guidance.context = {
      currentNamespace: namespace['namespace-name'],
      availableSchemas: schemas.length,
      availableMethods: methods.length,
      suggestions: []
    };

    if (schemas.length === 0) {
      guidance.context.suggestions.push("You don't have any schemas yet. Try creating one or scraping APIs to get started.");
    }

    if (methods.length === 0) {
      guidance.context.suggestions.push("No API methods found. Try web scraping to discover APIs for this namespace.");
    }

    if (schemas.length > 0 && methods.length === 0) {
      guidance.context.suggestions.push("You have schemas but no API methods. Consider generating Lambda functions from your schemas.");
    }
  }

  return guidance;
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
  
  console.log('[Backend Intent Detection] Lambda generation check:', {
    isLambdaRequest,
    isLambdaWithSchemaContext,
    isQuestion,
    isCasualMention,
    isExplanatory,
    shouldGenerateLambda
  });
  
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

// Export the robust intent detection function and guidance functions
export { detectIntent, detectIntentWithGuidance, generateWorkspaceGuidance, getRealNamespaceData };


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

// Schema analysis agent to read and understand uploaded schemas
export async function analyzeSchemas(schemas, message = '') {
  console.log('[Schema Agent] Analyzing schemas:', schemas.length);
  
  const schemaAnalysis = schemas.map((schema, index) => {
    const schemaName = schema.schemaName || schema.name || `Schema_${index + 1}`;
    const schemaType = schema.schemaType || schema.type || 'JSON';
    const schemaContent = schema.schema || schema.content || schema;
    
    return {
      name: schemaName,
      type: schemaType,
      content: schemaContent,
      fields: extractSchemaFields(schemaContent),
      relationships: extractSchemaRelationships(schemaContent, schemas)
    };
  });
  
  return {
    schemas: schemaAnalysis,
    totalSchemas: schemas.length,
    suggestedLambdaPurpose: generateLambdaPurpose(schemaAnalysis, message),
    schemaRelationships: findSchemaRelationships(schemaAnalysis)
  };
}

// Helper function to extract fields from schema
function extractSchemaFields(schemaContent) {
  try {
    if (typeof schemaContent === 'string') {
      schemaContent = JSON.parse(schemaContent);
    }
    
    if (schemaContent.properties) {
      return Object.keys(schemaContent.properties).map(key => ({
        name: key,
        type: schemaContent.properties[key].type || 'string',
        required: schemaContent.required?.includes(key) || false,
        description: schemaContent.properties[key].description || ''
      }));
    }
    
    return [];
  } catch (error) {
    console.warn('[Schema Agent] Error extracting fields:', error.message);
    return [];
  }
}

// Helper function to extract relationships between schemas
function extractSchemaRelationships(schemaContent, allSchemas) {
  try {
    if (typeof schemaContent === 'string') {
      schemaContent = JSON.parse(schemaContent);
    }
    
    const relationships = [];
    
    // Look for foreign key patterns, references, or nested objects
    if (schemaContent.properties) {
      Object.entries(schemaContent.properties).forEach(([key, value]) => {
        if (value.type === 'object' || value.$ref || key.includes('Id') || key.includes('_id')) {
          relationships.push({
            field: key,
            type: 'reference',
            target: value.$ref || 'unknown'
          });
        }
      });
    }
    
    return relationships;
  } catch (error) {
    console.warn('[Schema Agent] Error extracting relationships:', error.message);
    return [];
  }
}

// Helper function to generate Lambda purpose based on schemas
function generateLambdaPurpose(schemaAnalysis, message) {
  const schemaNames = schemaAnalysis.map(s => s.name).join(', ');
  
  if (message.toLowerCase().includes('crud') || message.toLowerCase().includes('api')) {
    return `CRUD operations for ${schemaNames}`;
  } else if (message.toLowerCase().includes('process') || message.toLowerCase().includes('transform')) {
    return `Data processing and transformation for ${schemaNames}`;
  } else if (message.toLowerCase().includes('validate') || message.toLowerCase().includes('check')) {
    return `Data validation for ${schemaNames}`;
  } else if (message.toLowerCase().includes('webhook') || message.toLowerCase().includes('event')) {
    return `Event processing for ${schemaNames}`;
  } else {
    return `Business logic handler for ${schemaNames}`;
  }
}

// Helper function to find relationships between schemas
function findSchemaRelationships(schemaAnalysis) {
  const relationships = [];
  
  schemaAnalysis.forEach((schema, index) => {
    schemaAnalysis.forEach((otherSchema, otherIndex) => {
      if (index !== otherIndex) {
        // Check for common field patterns
        const commonFields = schema.fields.filter(field => 
          otherSchema.fields.some(otherField => 
            field.name.toLowerCase().includes(otherField.name.toLowerCase()) ||
            otherField.name.toLowerCase().includes(field.name.toLowerCase())
          )
        );
        
        if (commonFields.length > 0) {
          relationships.push({
            from: schema.name,
            to: otherSchema.name,
            commonFields: commonFields.map(f => f.name),
            type: 'related'
          });
        }
      }
    });
  });
  
  return relationships;
}

// Helper function to detect if a message is asking about specific namespace resources
function isResourceQuery(message) {
  const lowerMessage = message.toLowerCase();
  
  // Check for question patterns first (more specific)
  const questionPatterns = [
    'tell me about', 'what is', 'show me', 'describe', 'explain', 
    'details about', 'information about', 'tell me more about'
  ];
  
  const hasQuestionPattern = questionPatterns.some(pattern => lowerMessage.includes(pattern));
  
  // Check for resource-specific keywords
  const resourceKeywords = [
    'schema', 'schemas', 'method', 'methods', 'api', 'apis', 'endpoint', 'endpoints',
    'webhook', 'webhooks', 'account', 'accounts', 'pin', 'pins', 'create', 'user', 'order'
  ];
  
  const hasResourceKeyword = resourceKeywords.some(keyword => lowerMessage.includes(keyword));
  
  // Check for general question patterns
  const isGeneralQuestion = lowerMessage.includes('?') || 
                           lowerMessage.includes('what') || 
                           lowerMessage.includes('how') || 
                           lowerMessage.includes('tell me') ||
                           lowerMessage.includes('show me') ||
                           lowerMessage.includes('describe') ||
                           lowerMessage.includes('explain');
  
  // Return true if it has a question pattern OR (has resource keyword AND is a question)
  return hasQuestionPattern || (hasResourceKeyword && isGeneralQuestion);
}

// Function to handle resource queries intelligently
async function handleResourceQuery(message, namespaceData, namespaceId) {
  console.log('[LLM Agent] Handling resource query:', message);
  
  const lowerMessage = message.toLowerCase();
  
  // Determine what resource the user is asking about
  let resourceType = 'general';
  let resourceName = null;
  
  // First, try to extract resource name from common patterns
  const resourceNamePatterns = [
    /(?:tell me about|what is|show me|describe|explain)\s+(.+)/i,
    /(?:about|regarding)\s+(.+)/i,
    /(?:the|a|an)\s+(.+?)(?:\s+(?:schema|method|api|endpoint|webhook|account))?$/i
  ];
  
  for (const pattern of resourceNamePatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      resourceName = match[1].trim();
      break;
    }
  }
  
  // If no specific resource name found, try to extract from the message
  if (!resourceName) {
    // Look for common resource patterns
    const words = message.split(/\s+/);
    const resourceWords = words.filter(word => 
      word.length > 2 && 
      !['tell', 'me', 'about', 'what', 'is', 'show', 'describe', 'explain', 'the', 'a', 'an'].includes(word.toLowerCase())
    );
    
    if (resourceWords.length > 0) {
      resourceName = resourceWords.join(' ');
    }
  }
  
  console.log('[LLM Agent] Extracted resource name:', resourceName);
  
  // Determine resource type based on keywords and context
  if (lowerMessage.includes('schema')) {
    resourceType = 'schema';
  } else if (lowerMessage.includes('method') || lowerMessage.includes('api') || lowerMessage.includes('endpoint')) {
    resourceType = 'method';
  } else if (lowerMessage.includes('webhook')) {
    resourceType = 'webhook';
  } else if (lowerMessage.includes('account')) {
    resourceType = 'account';
  } else {
    // Try to determine type based on available resources
    const schemas = namespaceData.schemas || [];
    const methods = namespaceData.methods || [];
    const webhooks = namespaceData.webhooks || [];
    const accounts = namespaceData.accounts || [];
    
    // Check if the resource name matches any existing resources
    if (resourceName) {
      const matchingSchema = schemas.find(schema => 
        (schema.schemaName || schema.name || '').toLowerCase().includes(resourceName.toLowerCase()) ||
        resourceName.toLowerCase().includes((schema.schemaName || schema.name || '').toLowerCase())
      );
      
      const matchingMethod = methods.find(method => 
        (method['namespace-method-name'] || method.methodName || '').toLowerCase().includes(resourceName.toLowerCase()) ||
        resourceName.toLowerCase().includes((method['namespace-method-name'] || method.methodName || '').toLowerCase())
      );
      
      const matchingWebhook = webhooks.find(webhook => 
        (webhook.webhookName || webhook.name || '').toLowerCase().includes(resourceName.toLowerCase()) ||
        resourceName.toLowerCase().includes((webhook.webhookName || webhook.name || '').toLowerCase())
      );
      
      const matchingAccount = accounts.find(account => 
        (account.accountName || account.name || '').toLowerCase().includes(resourceName.toLowerCase()) ||
        resourceName.toLowerCase().includes((account.accountName || account.name || '').toLowerCase())
      );
      
      if (matchingSchema) {
        resourceType = 'schema';
        resourceName = matchingSchema.schemaName || matchingSchema.name;
      } else if (matchingMethod) {
        resourceType = 'method';
        resourceName = matchingMethod['namespace-method-name'] || matchingMethod.methodName;
      } else if (matchingWebhook) {
        resourceType = 'webhook';
        resourceName = matchingWebhook.webhookName || matchingWebhook.name;
      } else if (matchingAccount) {
        resourceType = 'account';
        resourceName = matchingAccount.accountName || matchingAccount.name;
      }
    }
  }
  
  console.log('[LLM Agent] Determined resource type:', resourceType, 'resource name:', resourceName);
  
  // Build intelligent response based on resource type and available data
  let response = '';
  
  if (resourceType === 'schema') {
    response = buildSchemaResponse(message, namespaceData, resourceName);
  } else if (resourceType === 'method') {
    response = buildMethodResponse(message, namespaceData, resourceName);
  } else if (resourceType === 'webhook') {
    response = buildWebhookResponse(message, namespaceData);
  } else if (resourceType === 'account') {
    response = buildAccountResponse(message, namespaceData);
  } else {
    response = buildGeneralNamespaceResponse(message, namespaceData);
  }
  
  return response;
}

// Build intelligent schema response
function buildSchemaResponse(message, namespaceData, schemaName) {
  const schemas = namespaceData.schemas || [];
  
  if (schemas.length === 0) {
    return `**No schemas found in this namespace.**\n\nYou can create schemas by:\n• Asking me to "generate a schema for [entity name]"\n• Uploading JSON schema files\n• Using the Schema tab to create new schemas`;
  }
  
  // If user asked about a specific schema
  if (schemaName) {
    const matchingSchema = schemas.find(schema => 
      (schema.schemaName || schema.name || '').toLowerCase().includes(schemaName.toLowerCase()) ||
      schemaName.toLowerCase().includes((schema.schemaName || schema.name || '').toLowerCase())
    );
    
    if (matchingSchema) {
      const schemaName = matchingSchema.schemaName || matchingSchema.name || 'Unnamed Schema';
      const schemaType = matchingSchema.schemaType || matchingSchema.type || 'JSON';
      const description = matchingSchema.description || matchingSchema.schemaDescription || 'No description available';
      const schemaContent = matchingSchema.schema || matchingSchema;
      
      // Extract key fields if it's a JSON schema
      let fieldsInfo = '';
      if (schemaContent && schemaContent.properties) {
        const fields = Object.keys(schemaContent.properties).slice(0, 10); // Show first 10 fields
        fieldsInfo = `\n**Key Fields:** ${fields.join(', ')}${Object.keys(schemaContent.properties).length > 10 ? ` (and ${Object.keys(schemaContent.properties).length - 10} more)` : ''}`;
      }
      
      return `**📋 Schema: ${schemaName}**\n\n**Type:** ${schemaType}\n**Description:** ${description}${fieldsInfo}\n\n**Schema Structure:**\n\`\`\`json\n${JSON.stringify(schemaContent, null, 2)}\n\`\`\`\n\n**Available Actions:**\n• Generate a Lambda function using this schema\n• Create API methods based on this schema\n• Modify or extend this schema\n• Test this schema in the Schema tab`;
    } else {
      // Try to find similar schemas
      const similarSchemas = schemas.filter(schema => {
        const name = (schema.schemaName || schema.name || '').toLowerCase();
        return name.includes(schemaName.toLowerCase()) || 
               schemaName.toLowerCase().includes(name) ||
               name.split(' ').some(word => schemaName.toLowerCase().includes(word)) ||
               schemaName.toLowerCase().split(' ').some(word => name.includes(word));
      });
      
      if (similarSchemas.length > 0) {
        return `**Schema "${schemaName}" not found, but I found similar schemas:**\n\n${similarSchemas.map((s, i) => `${i + 1}. **${s.schemaName || s.name || 'Unnamed Schema'}** (${s.schemaType || s.type || 'JSON'})`).join('\n')}\n\n**All available schemas in this namespace:**\n${schemas.map((s, i) => `${i + 1}. **${s.schemaName || s.name || 'Unnamed Schema'}** (${s.schemaType || s.type || 'JSON'})`).join('\n')}\n\nTry asking about one of these schemas by name.`;
      } else {
        return `**Schema "${schemaName}" not found.**\n\n**Available schemas in this namespace:**\n${schemas.map((s, i) => `${i + 1}. **${s.schemaName || s.name || 'Unnamed Schema'}** (${s.schemaType || s.type || 'JSON'})`).join('\n')}\n\nTry asking about one of these schemas by name.`;
      }
    }
  }
  
  // General schema information
  return `**📋 Available Schemas (${schemas.length}):**\n\n${schemas.map((schema, index) => {
    const name = schema.schemaName || schema.name || 'Unnamed Schema';
    const type = schema.schemaType || schema.type || 'JSON';
    const description = schema.description || schema.schemaDescription || 'No description';
    return `${index + 1}. **${name}** (${type})\n   ${description.substring(0, 100)}${description.length > 100 ? '...' : ''}`;
  }).join('\n\n')}\n\n**To get details about a specific schema:**\n• Ask "tell me about [schema name]"\n• Ask "what is the [schema name] schema?"\n• Ask "show me the [schema name] schema"`;
}

// Build intelligent method response
function buildMethodResponse(message, namespaceData, methodName) {
  const methods = namespaceData.methods || [];
  
  if (methods.length === 0) {
    return `**No API methods found in this namespace.**\n\nYou can add methods by:\n• Using the Web Scraping tab to scrape APIs\n• Creating methods manually in the API tab\n• Generating methods from schemas`;
  }
  
  // If user asked about a specific method
  if (methodName) {
    // Try to find exact or partial matches
    const matchingMethod = methods.find(method => {
      const methodNameLower = (method['namespace-method-name'] || method.methodName || '').toLowerCase();
      const queryLower = methodName.toLowerCase();
      
      return methodNameLower.includes(queryLower) ||
             queryLower.includes(methodNameLower) ||
             methodNameLower.split(' ').some(word => queryLower.includes(word)) ||
             queryLower.split(' ').some(word => methodNameLower.includes(word));
    });
    
    if (matchingMethod) {
      const methodName = matchingMethod['namespace-method-name'] || matchingMethod.methodName || 'Unnamed Method';
      const methodType = matchingMethod['namespace-method-type'] || matchingMethod.methodType || 'GET';
      const methodUrl = matchingMethod['namespace-method-url-override'] || matchingMethod.url || 'No URL specified';
      const methodDescription = matchingMethod.description || matchingMethod['method-description'] || 'No description available';
      
      // Extract key information from the method
      let methodInfo = `**🔗 API Method: ${methodName}**\n\n**Type:** ${methodType}\n**URL:** ${methodUrl}\n**Description:** ${methodDescription}`;
      
      // Add request/response info if available
      if (matchingMethod.requestBody || matchingMethod.request) {
        methodInfo += `\n**Request Body:** Available`;
      }
      if (matchingMethod.response || matchingMethod.responseBody) {
        methodInfo += `\n**Response:** Available`;
      }
      
      methodInfo += `\n\n**Method Details:**\n\`\`\`json\n${JSON.stringify(matchingMethod, null, 2)}\n\`\`\`\n\n**Available Actions:**\n• Test this method in the API tab\n• Generate a Lambda function that uses this method\n• Modify the method configuration\n• View request/response examples`;
      
      return methodInfo;
    } else {
      // Try to find similar methods
      const similarMethods = methods.filter(method => {
        const name = (method['namespace-method-name'] || method.methodName || '').toLowerCase();
        return name.includes(methodName.toLowerCase()) || 
               methodName.toLowerCase().includes(name) ||
               name.split(' ').some(word => methodName.toLowerCase().includes(word)) ||
               methodName.toLowerCase().split(' ').some(word => name.includes(word));
      });
      
      if (similarMethods.length > 0) {
        return `**Method "${methodName}" not found, but I found similar methods:**\n\n${similarMethods.map((m, i) => `${i + 1}. **${m['namespace-method-name'] || m.methodName || 'Unnamed Method'}** (${m['namespace-method-type'] || m.methodType || 'GET'})`).join('\n')}\n\n**All available methods in this namespace:**\n${methods.slice(0, 10).map((m, i) => `${i + 1}. **${m['namespace-method-name'] || m.methodName || 'Unnamed Method'}** (${m['namespace-method-type'] || m.methodType || 'GET'})`).join('\n')}${methods.length > 10 ? `\n... and ${methods.length - 10} more methods` : ''}\n\nTry asking about one of these methods by name.`;
      } else {
        return `**Method "${methodName}" not found.**\n\n**Available methods in this namespace:**\n${methods.slice(0, 10).map((m, i) => `${i + 1}. **${m['namespace-method-name'] || m.methodName || 'Unnamed Method'}** (${m['namespace-method-type'] || m.methodType || 'GET'})`).join('\n')}${methods.length > 10 ? `\n... and ${methods.length - 10} more methods` : ''}\n\nTry asking about one of these methods by name.`;
      }
    }
  }
  
  // General method information
  return `**🔗 Available API Methods (${methods.length}):**\n\n${methods.slice(0, 10).map((method, index) => {
    const name = method['namespace-method-name'] || method.methodName || 'Unnamed Method';
    const type = method['namespace-method-type'] || method.methodType || 'GET';
    const url = method['namespace-method-url-override'] || method.url || 'No URL';
    return `${index + 1}. **${name}** (${type})\n   URL: ${url}`;
  }).join('\n\n')}${methods.length > 10 ? `\n\n... and ${methods.length - 10} more methods` : ''}\n\n**To get details about a specific method:**\n• Ask "tell me about [method name]"\n• Ask "what is the [method name] method?"\n• Ask "show me the [method name] API"`;
}

// Build intelligent webhook response
function buildWebhookResponse(message, namespaceData) {
  const webhooks = namespaceData.webhooks || [];
  
  if (webhooks.length === 0) {
    return `**No webhooks found in this namespace.**\n\nYou can add webhooks by:\n• Using the Web Scraping tab to discover webhook endpoints\n• Creating webhooks manually in the API tab\n• Configuring webhooks for your API methods`;
  }
  
  return `**🔔 Available Webhooks (${webhooks.length}):**\n\n${webhooks.map((webhook, index) => {
    const name = webhook.webhookName || webhook.name || 'Unnamed Webhook';
    const url = webhook.webhookUrl || webhook.url || 'No URL specified';
    return `${index + 1}. **${name}**\n   URL: ${url}`;
  }).join('\n\n')}\n\n**Webhook Information:**\n• Webhooks allow external services to send data to your application\n• They can trigger Lambda functions or update your data\n• Configure webhooks in the API tab for real-time integrations`;
}

// Build intelligent account response
function buildAccountResponse(message, namespaceData) {
  const accounts = namespaceData.accounts || [];
  
  if (accounts.length === 0) {
    return `**No accounts found in this namespace.**\n\nYou can add accounts by:\n• Using the Web Scraping tab to discover service accounts\n• Creating accounts manually in the API tab\n• Configuring authentication for your API methods`;
  }
  
  return `**👤 Available Accounts (${accounts.length}):**\n\n${accounts.map((account, index) => {
    const name = account.accountName || account.name || 'Unnamed Account';
    const type = account.accountType || account.type || 'Unknown';
    return `${index + 1}. **${name}** (${type})`;
  }).join('\n\n')}\n\n**Account Information:**\n• Accounts store authentication credentials for external services\n• They can be used to authenticate API calls\n• Configure accounts in the API tab for secure integrations`;
}

// Build general namespace response
function buildGeneralNamespaceResponse(message, namespaceData) {
  const schemas = namespaceData.schemas || [];
  const methods = namespaceData.methods || [];
  const webhooks = namespaceData.webhooks || [];
  const accounts = namespaceData.accounts || [];
  
  const totalResources = schemas.length + methods.length + webhooks.length + accounts.length;
  
  return `**📁 Current Namespace Overview**\n\n**Total Resources:** ${totalResources}\n\n**Breakdown:**\n• **Schemas:** ${schemas.length}\n• **API Methods:** ${methods.length}\n• **Webhooks:** ${webhooks.length}\n• **Accounts:** ${accounts.length}\n\n**Available Actions:**\n• Ask about specific schemas: "tell me about [schema name]"\n• Ask about specific methods: "what is the [method name] method?"\n• Ask about webhooks: "show me webhooks"\n• Ask about accounts: "show me accounts"\n• Generate Lambda functions: "generate lambda function"\n• Create new resources using the respective tabs`;
}

// Enhanced Lambda codegen handler that can automatically use workspace schemas and uploaded schemas
export async function handleLambdaCodegen({ message, selectedSchema, functionName, runtime, handler, memory, timeout, environment, namespace, res = null, uploadedSchemas = [] }) {
  console.log('[LLM Agent] Enhanced Lambda codegen request:', { message, selectedSchema, functionName, runtime, handler, memory, timeout, environment, namespace, uploadedSchemasCount: uploadedSchemas.length });

  // Extract namespace ID
  const namespaceId = typeof namespace === 'object' && namespace !== null ? namespace.id : namespace;
  
  // If no explicit schema is selected, try to find relevant schemas from workspace and uploaded schemas
  let schemasToUse = [];
  let namespaceContext = '';
  let schemaAnalysis = null;
  
  // First, check if we have uploaded schemas
  if (uploadedSchemas && uploadedSchemas.length > 0) {
    console.log('[LLM Agent] Processing uploaded schemas:', uploadedSchemas.length);
    
    // Analyze uploaded schemas
    schemaAnalysis = await analyzeSchemas(uploadedSchemas, message);
    schemasToUse = schemaAnalysis.schemas;
    
    console.log('[LLM Agent] Schema analysis complete:', {
      totalSchemas: schemaAnalysis.totalSchemas,
      suggestedPurpose: schemaAnalysis.suggestedLambdaPurpose,
      relationships: schemaAnalysis.schemaRelationships.length
    });
  }
  
  // If no uploaded schemas or we need more context, check workspace schemas
  if (schemasToUse.length === 0 && !selectedSchema && namespaceId) {
    try {
      console.log('[LLM Agent] No uploaded schemas, searching for relevant schemas in workspace...');
      
      // Get all available schemas for the namespace
      const { schemas: availableSchemas, methods: availableMethods, namespaceInfo } = await getRealNamespaceData(namespaceId);
      
      // Intelligently select relevant schemas based on the message
      const relevantSchemas = await selectRelevantSchemas(message, namespaceId, availableSchemas);
      
      if (relevantSchemas.length > 0) {
        schemasToUse = relevantSchemas;
        console.log('[LLM Agent] Found relevant workspace schemas:', relevantSchemas.map(s => s.schemaName || s.name));
        
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
  
  // Combine uploaded schemas with workspace schemas if both exist
  if (uploadedSchemas && uploadedSchemas.length > 0 && schemasToUse.length > 0) {
    console.log('[LLM Agent] Combining uploaded schemas with workspace schemas');
    // Keep uploaded schemas as primary, add workspace schemas for context
    const workspaceSchemas = schemasToUse.filter(s => !uploadedSchemas.some(u => u.schemaName === s.schemaName || u.name === s.name));
    schemasToUse = [...schemaAnalysis.schemas, ...workspaceSchemas];
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

${schemaAnalysis ? `Schema Analysis:
- Total schemas: ${schemaAnalysis.totalSchemas}
- Suggested Lambda purpose: ${schemaAnalysis.suggestedLambdaPurpose}
- Schema relationships: ${schemaAnalysis.schemaRelationships.length > 0 ? schemaAnalysis.schemaRelationships.map(r => `${r.from} → ${r.to} (${r.commonFields.join(', ')})`).join(', ') : 'None detected'}

Use this analysis to create a Lambda function that intelligently combines and processes these schemas.\n` : ''}

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
      // Don't write headers here - they should already be written by the calling function

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
          // Send the chunk to the client, tagged for lambda route
          const data = JSON.stringify({ type: 'lambda_code_chunk', route: 'lambda', content });
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
      
      // Send completion signal and final payload with full code
      res.write(`data: ${JSON.stringify({ type: 'lambda_code_complete', route: 'lambda', code: fullCode })}\n\n`);
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

// Export the namespace generation functions
export { detectNamespaceGenerationIntent, isGeneralAIContext, generateNamespaceFromPrompt, saveGeneratedNamespace };

export const agentSystem = {
  async handleStreamingWithAgents(res, namespace, message, history = [], schema = null, uploadedSchemas = []) {
    const namespaceId = typeof namespace === 'object' && namespace !== null ? namespace.id : namespace;
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Check if this is a namespace generation request in general AI context
    const isGeneralContext = isGeneralAIContext(namespace, uploadedSchemas, []);
    const isNamespaceGenerationRequest = detectNamespaceGenerationIntent(message);
    
    console.log('[LLM Agent] Namespace generation check:', {
      isGeneralContext,
      isNamespaceGenerationRequest,
      message: message.substring(0, 100),
      namespace: namespace,
      apiKeyStatus: process.env.ANTHROPIC_API_KEY ? 'SET' : 'NOT SET'
    });
    
    if (isGeneralContext && isNamespaceGenerationRequest) {
      console.log('[LLM Agent] Namespace generation request detected in general AI context');
      
      try {
        // Generate the namespace structure
        const generationResult = await generateNamespaceFromPrompt(message);
        
        if (generationResult.success) {
          // Save to database
          const saveResult = await saveGeneratedNamespace(generationResult.data);
          
          if (saveResult.success) {
            // Send success response
            const successMessage = {
              type: 'namespace_generated',
              route: 'chat',
              content: `✅ **Complete Namespace Generated!**\n\n**Namespace:** ${generationResult.data.namespace['namespace-name']}\n**Description:** ${generationResult.data.namespace['namespace-description']}\n\n**Generated Components:**\n• **${generationResult.data.schemas.length} Schemas** - Data models and structures\n• **${generationResult.data.methods.length} API Methods** - REST endpoints\n• **${generationResult.data.accounts.length} Account Types** - Authentication systems\n• **${generationResult.data.webhooks.length} Webhooks** - Event integrations\n• **${generationResult.data.lambdaFunctions.length} Lambda Functions** - Serverless logic\n\n**Namespace ID:** \`${generationResult.namespaceId}\`\n\nYou can now open this namespace to start working with the generated components!`,
              namespaceId: generationResult.namespaceId,
              namespaceData: generationResult.data
            };
            
            res.write(`data: ${JSON.stringify(successMessage)}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          } else {
            throw new Error(saveResult.error);
          }
        } else {
          throw new Error(generationResult.error);
        }
      } catch (error) {
        console.error('[LLM Agent] Namespace generation error:', error);
        const errorMessage = {
          type: 'chat',
          route: 'chat',
          content: `❌ **Namespace Generation Failed**\n\nError: ${error.message}\n\nPlease try again with a more specific description of what you want to build.`
        };
        
        res.write(`data: ${JSON.stringify(errorMessage)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
    }

    let llmBuffer = '';
    
    // Enhanced intent detection with workspace guidance
    const intentWithGuidance = detectIntentWithGuidance(message);
    const intent = detectIntent(message);
    const isSchemaIntent = intent.shouldGenerateSchema;
    
    // Check if user is asking for guidance
    if (intentWithGuidance.shouldProvideGuidance) {
      console.log('[LLM Agent] Guidance request detected:', intentWithGuidance.feature);
      
      // Get namespace context for personalized guidance
      let namespaceData = null;
      if (namespaceId) {
        try {
          namespaceData = await getRealNamespaceData(namespaceId);
        } catch (err) {
          console.warn('[LLM Agent] Failed to get namespace data for guidance:', err.message);
        }
      }
      
      // Generate workspace guidance
      const guidance = generateWorkspaceGuidance(intentWithGuidance.intent, intentWithGuidance.feature, namespaceData);
      
      // Send guidance response as a chat message so the frontend can display it
      const chatMessage = {
        type: 'chat',
        content: `I can help you with ${intentWithGuidance.feature}!\n\n${guidance.suggestions.join('\n\n')}\n\n${guidance.nextSteps.join('\n')}`,
        route: 'chat'
      };
      
      res.write(`data: ${JSON.stringify(chatMessage)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    
    // Check if user is asking about specific namespace resources (schemas, methods, webhooks, accounts)
    if (namespaceId && isResourceQuery(message)) {
      console.log('[LLM Agent] Resource query detected for namespace:', namespaceId);
      
      try {
        const namespaceData = await getRealNamespaceData(namespaceId);
        const resourceResponse = await handleResourceQuery(message, namespaceData, namespaceId);
        
        if (resourceResponse) {
          const chatMessage = {
            type: 'chat',
            content: resourceResponse,
            route: 'chat'
          };
          
          res.write(`data: ${JSON.stringify(chatMessage)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
      } catch (err) {
        console.warn('[LLM Agent] Failed to handle resource query:', err.message);
      }
    }
    
    // Check if user is requesting Lambda generation with a specific schema or uploaded schemas
    if (intent.shouldGenerateLambda && namespaceId) {
      console.log('[LLM Agent] Lambda generation request detected for message:', message);
      console.log('[LLM Agent] Intent details:', intent);
      console.log('[LLM Agent] Uploaded schemas:', uploadedSchemas?.length || 0);
      
      try {
        // First check if we have uploaded schemas (from drag and drop)
        if (uploadedSchemas && uploadedSchemas.length > 0) {
          console.log('[LLM Agent] Using uploaded schemas for lambda generation:', uploadedSchemas.length);
          
          const lambdaCodegenParams = {
            message: message,
            selectedSchema: null,
            functionName: 'UploadedSchemaHandler',
            runtime: 'nodejs18.x',
            handler: 'index.handler',
            memory: 256,
            timeout: 30,
            environment: null,
            namespace: namespaceId,
            res: res,
            uploadedSchemas: uploadedSchemas
          };
          
          await handleLambdaCodegen(lambdaCodegenParams);
          return;
        }
        
        // Get namespace data to find available schemas
        const namespaceData = await getRealNamespaceData(namespaceId);
        
        // Check if the message contains a schema name
        const availableSchemas = namespaceData.schemas || [];
        const messageLower = message.toLowerCase();
        
        console.log('[LLM Agent] Available schemas for matching:', availableSchemas.map(s => s.schemaName || s.name));
        console.log('[LLM Agent] Message to match:', messageLower);
        
        // Look for schema names in the message - improved matching
        let selectedSchema = null;
        for (const schema of availableSchemas) {
          const schemaName = (schema.schemaName || schema.name || '').toLowerCase();
          if (schemaName) {
            // Check for exact match
            if (messageLower.includes(schemaName)) {
              selectedSchema = schema;
              break;
            }
            // Check for partial match (schema name contains words from message)
            const schemaWords = schemaName.split(/\s+/);
            const messageWords = messageLower.split(/\s+/);
            const hasPartialMatch = schemaWords.some(word => 
              word.length > 2 && messageWords.some(msgWord => 
                msgWord.includes(word) || word.includes(msgWord)
              )
            );
            if (hasPartialMatch) {
              console.log('[LLM Agent] Found partial match for schema:', schemaName);
              selectedSchema = schema;
              break;
            }
          }
        }
        
        console.log('[LLM Agent] Selected schema:', selectedSchema ? (selectedSchema.schemaName || selectedSchema.name) : 'None');
        
        // Check if user mentioned multiple schemas or uploaded schemas
        const multipleSchemaKeywords = ['multiple schemas', 'all schemas', 'combine schemas', 'use schemas', 'with schemas'];
        const hasMultipleSchemaIntent = multipleSchemaKeywords.some(keyword => messageLower.includes(keyword));
        
        // If user wants to use multiple schemas, generate Lambda with all available schemas
        if (hasMultipleSchemaIntent && availableSchemas.length > 1) {
          console.log('[LLM Agent] Multiple schema Lambda generation requested');
          
          const lambdaCodegenParams = {
            message: message,
            selectedSchema: null,
            functionName: 'MultiSchemaHandler',
            runtime: 'nodejs18.x',
            handler: 'index.handler',
            memory: 256,
            timeout: 30,
            environment: null,
            namespace: namespaceId,
            res: res,
            uploadedSchemas: availableSchemas // Use all available schemas
          };
          await handleLambdaCodegen(lambdaCodegenParams);
          return;
        }
        
        if (selectedSchema) {
          console.log('[LLM Agent] Found schema for Lambda generation:', selectedSchema.schemaName || selectedSchema.name);
          
          // Use the existing handleLambdaCodegen function but capture the result
          const lambdaCodegenParams = {
            message: `Generate a Lambda function using the ${selectedSchema.schemaName || selectedSchema.name} schema`,
            selectedSchema: selectedSchema,
            functionName: `${selectedSchema.schemaName || selectedSchema.name}Handler`,
            runtime: 'nodejs18.x',
            handler: 'index.handler',
            memory: 256,
            timeout: 30,
            environment: null,
            namespace: namespaceId,
            res: res,
            uploadedSchemas: [] // No uploaded schemas for single schema selection
          };
          await handleLambdaCodegen(lambdaCodegenParams);
          return;
        } else if (availableSchemas.length > 0) {
          // Check if this is an explicit lambda generation request
          const explicitLambdaKeywords = ['generate lambda', 'create lambda', 'build lambda', 'make lambda', 'lambda function'];
          const isExplicitLambdaRequest = explicitLambdaKeywords.some(keyword => messageLower.includes(keyword));
          
          if (isExplicitLambdaRequest) {
            // Auto-select first available schema for explicit lambda requests
            console.log('[LLM Agent] Explicit lambda request detected, auto-selecting first schema:', availableSchemas[0].schemaName || availableSchemas[0].name);
            
            const selectedSchema = availableSchemas[0];
            const lambdaCodegenParams = {
              message: message,
              selectedSchema: selectedSchema,
              functionName: `${selectedSchema.schemaName || selectedSchema.name}Handler`,
              runtime: 'nodejs18.x',
              handler: 'index.handler',
              memory: 256,
              timeout: 30,
              environment: null,
              namespace: namespaceId,
              res: res,
              uploadedSchemas: []
            };
            
            await handleLambdaCodegen(lambdaCodegenParams);
            return;
          } else {
            // Show available schemas for selection
            const schemaList = availableSchemas.map((schema, index) => 
              `${index + 1}. **${schema.schemaName || schema.name}** (${schema.schemaType || schema.type || 'JSON'})`
            ).join('\n');
            
            const chatMessage = {
              type: 'chat',
              content: `I can generate a Lambda function for you! Here are the available schemas:\n\n${schemaList}\n\n**To generate a Lambda function:**\n• Type the exact name of a schema (e.g., "${availableSchemas[0].schemaName || availableSchemas[0].name}")\n• Or ask me to "generate Lambda for [schema name]"`,
              route: 'chat'
            };
            
            res.write(`data: ${JSON.stringify(chatMessage)}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
        } else {
          // No schemas available, but user wants Lambda generation - generate a general Lambda function
          console.log('[LLM Agent] Lambda generation requested but no schemas available, generating general Lambda function');
          
          const lambdaCodegenParams = {
            message: message,
            selectedSchema: null,
            functionName: 'GeneralHandler',
            runtime: 'nodejs18.x',
            handler: 'index.handler',
            memory: 256,
            timeout: 30,
            environment: null,
            namespace: namespaceId,
            res: res, // Stream directly
            uploadedSchemas: []
          };
          
          // Call the Lambda codegen handler with streaming
          await handleLambdaCodegen(lambdaCodegenParams);
          return;
        }
      } catch (err) {
        console.warn('[LLM Agent] Failed to process Lambda generation request:', err.message);
      }
    }
    
    // If we have a schema and the user mentions schema-related keywords, treat it as editing
    // But prioritize lambda requests over schema editing
    const hasSchemaKeywords = detectSchemaIntent(message);
    
    console.log('[Backend Agent System] Intent analysis:', {
      message,
      intent: intent.intent,
      shouldGenerateLambda: intent.shouldGenerateLambda,
      shouldGenerateSchema: intent.shouldGenerateSchema,
      hasSchemaKeywords,
      namespaceId
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
      // Enhanced system prompt for schema workspace with guidance capabilities
      const schemaWorkspaceContext = `
WORKSPACE FEATURES AND CAPABILITIES:

1. SCHEMA WORKSPACE:
   - You're currently in the Schema tab where users can create and view JSON schemas
   - Schemas can be used to generate Lambda functions, validate data, and organize information

2. RELATED FEATURES:
   - Lambda Functions: Generate serverless functions from schemas (Lambda tab)
   - Web Scraping: Scrape APIs and create schemas automatically (Web Scraping tab)
   - Namespace Management: Organize schemas and APIs (Namespace Library tab)
   - AWS Services: Deploy and manage resources (AWS Services tab)

Current Generated Schema:
${JSON.stringify(schema, null, 2)}

Namespace Context:
${namespaceContext}

User message: ${message}

Instructions:
1. Answer questions about the generated schema
2. Provide guidance on schema usage and validation
3. Answer questions about existing namespace schemas, methods, accounts, and webhooks
4. Be conversational and helpful
5. If the user asks about namespace data, provide information from the namespace context
6. Guide users to other workspace features when relevant (e.g., "You can generate a Lambda function from this schema using the Lambda tab")
7. Suggest next steps like generating Lambda functions from schemas or organizing in namespaces

Respond conversationally and helpfully, using both the generated schema and namespace context as needed. Guide users to other workspace features when appropriate.`;
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
        let hasStartedJson = false;
        let hasEndedJson = false;
        
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta') {
            const content = chunk.delta.text;
            schemaContent += content;
            chunkCount++;
            
            // Check if we're starting JSON generation
            if (content.includes('{') && !hasStartedJson) {
              hasStartedJson = true;
              // Send a message indicating schema generation is starting
              res.write(`data: ${JSON.stringify({ content: "\n\n🔄 Generating schema...", type: 'chat', route: 'chat' })}\n\n`);
            }
            
            // Stream conversational content to chat UI
            if (!hasStartedJson) {
              res.write(`data: ${JSON.stringify({ content, type: 'chat', route: 'chat' })}\n\n`);
            }
            
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
                
                // Send live schema update to frontend live box
                res.write(`data: ${JSON.stringify({ 
                  type: 'live_schema', 
                  content: JSON.stringify(schemaJson, null, 2), 
                  route: 'schema' 
                })}\n\n`);
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
            
            // Send final completion signal to close the live generation window
            res.write(`data: ${JSON.stringify({ 
              type: 'live_schema_complete', 
              route: 'schema' 
            })}\n\n`);
            
            // Send the final schema action
            const actionData = { actions: [{ type: 'generate_schema', status: 'complete', data: schemaJson }], type: 'actions', route: 'chat' };
            console.log('[Backend] Sending final schema action:', actionData);
            res.write(`data: ${JSON.stringify(actionData)}\n\n`);
          } else {
            console.log('[LLM Agent] No valid schema detected in streamed content');
            res.write(`data: ${JSON.stringify({ content: "❌ I encountered an issue while generating the schema. Please try again.", type: 'chat', route: 'chat' })}\n\n`);
            res.write(`data: ${JSON.stringify({ actions: [{ type: 'error', status: 'failed', message: 'No valid schema found in generated content.' }], type: 'actions', route: 'chat' })}\n\n`);
          }
        
        res.end();
        return;
      } catch (err) {
        console.log('[LLM Agent] Schema generation streaming error:', err);
        res.write(`data: ${JSON.stringify({ content: "I encountered an error while generating the schema. Please try again.", type: 'chat', route: 'chat' })}\n\n`);
        res.write(`data: ${JSON.stringify({ actions: [{ type: 'error', status: 'failed', message: 'Agent error: ' + err.message }], type: 'actions', route: 'chat' })}\n\n`);
        res.end();
        return;
      }
    } else {
      // Regular chat - use AI Agent Workspace context if schema is available
      if (schema) {
        // If user mentions schema-related keywords, guide them
        if (hasSchemaKeywords) {
          systemPrompt = `You are a helpful AI assistant working in the AI Agent Workspace. You have access to both the generated schema in this workspace AND the namespace context.

Current Generated Schema:
${JSON.stringify(schema, null, 2)}

Namespace Context:
${namespaceContext}

User message: ${message}

Instructions:
1. The user is asking about schema-related topics
2. Answer questions about the current generated schema
3. Answer questions about existing namespace schemas, methods, accounts, and webhooks
4. Be conversational and helpful
5. Guide users to other workspace features when relevant

Respond conversationally and helpfully about the schema and namespace context.`;
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
        // Enhanced system prompt with workspace context and guidance capabilities
        const workspaceContext = `
WORKSPACE FEATURES AND CAPABILITIES:

1. WEB SCRAPING:
   - Automatically scrape APIs, schemas, and documentation from websites
   - Known services: GitHub, Stripe, Shopify, and custom URLs
   - Automatic namespace management and method creation
   - Available at: Web Scraping tab

2. AWS LAMBDA FUNCTIONS:
   - Generate and deploy serverless functions from schemas
   - Auto-deploy to AWS with proper configurations
   - Schema-based code generation
   - Available at: Lambda tab

3. DATA SCHEMAS:
   - Create and manage JSON schemas for data validation
   - Schema-based code generation and validation
   - Namespace organization
   - Available at: Schemas tab

4. NAMESPACE MANAGEMENT:
   - Organize APIs, schemas, and resources by project/service
   - Manage namespace methods, accounts, and webhooks
   - Available at: Namespace Library tab

5. AWS SERVICES MANAGEMENT:
   - Manage Lambda, DynamoDB, S3, IAM, API Gateway
   - Direct AWS resource management from workspace
   - Available at: AWS Services tab

GUIDANCE CAPABILITIES:
- I can guide users to specific tabs and features
- Provide step-by-step instructions for workspace features
- Suggest next steps based on current context
- Help with feature discovery and usage

Current Namespace Context:
${namespaceContext}

INSTRUCTIONS:
1. Be conversational and helpful
2. Use the namespace context when relevant
3. Guide users to appropriate tabs and features when they ask about functionality
4. Provide step-by-step instructions for workspace features
5. Suggest relevant next steps based on their current context
6. If users ask about features, explain what's available and how to access it
7. Help users discover and use workspace capabilities effectively

Remember: I can help users navigate the workspace, understand features, and provide guidance on how to use different capabilities.`;

        systemPrompt = `You are an intelligent AI assistant for the BRMH platform with deep knowledge of all workspace features and capabilities.

${workspaceContext}

Answer the user's questions conversationally, provide guidance on workspace features, and help them navigate and use the platform effectively.`;
      }
    }
    console.log('System prompt for LLM:', systemPrompt);

    try {
      // Clean history messages to only include role and content (remove id, timestamp, etc.)
      const cleanedHistory = history.slice(-10).map(msg => {
        // Ensure we only include role and content, and handle missing fields gracefully
        const cleaned = {
          role: msg.role || 'user',
          content: msg.content || ''
        };
        
        // Log any unexpected fields for debugging
        const unexpectedFields = Object.keys(msg).filter(key => !['role', 'content'].includes(key));
        if (unexpectedFields.length > 0) {
          console.log('[LLM Agent] Removing unexpected fields from message:', unexpectedFields);
        }
        
        return cleaned;
      });
      
      console.log('[LLM Agent] Cleaned history messages:', {
        originalCount: history.length,
        cleanedCount: cleanedHistory.length,
        sampleMessage: cleanedHistory[0] || 'No history'
      });
      
      const messages = [
        { role: 'user', content: systemPrompt },
        ...cleanedHistory,
        { role: 'user', content: message }
      ];
      
      // Final validation - ensure no message has unexpected fields
      const validatedMessages = messages.map((msg, index) => {
        const validated = {
          role: msg.role,
          content: msg.content
        };
        
        // Check for any unexpected fields
        const unexpectedFields = Object.keys(msg).filter(key => !['role', 'content'].includes(key));
        if (unexpectedFields.length > 0) {
          console.error(`[LLM Agent] Message ${index} has unexpected fields:`, unexpectedFields);
        }
        
        return validated;
      });
      
      // Log the final messages array to debug
      console.log('[LLM Agent] Final messages array being sent to Anthropic:', {
        messageCount: validatedMessages.length,
        messages: validatedMessages.map((msg, index) => ({
          index,
          role: msg.role,
          contentLength: msg.content?.length || 0,
          hasId: 'id' in msg,
          hasTimestamp: 'timestamp' in msg,
          keys: Object.keys(msg)
        }))
      });

      const stream = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: 4000,
        messages: validatedMessages,
        stream: true,
      });

      // Stream the response and detect schema code blocks
      let schemaJson = null;
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta') {
          const content = chunk.delta.text;
          llmBuffer += content;
          res.write(`data: ${JSON.stringify({ content, type: 'chat', route: 'chat' })}\n\n`);

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

      // If a schema was detected, send generate action (no editing)
      if (schemaJson) {
        console.log('[Backend] Schema detected in response. Sending generate_schema action');
        res.write(`data: ${JSON.stringify({ actions: [{ type: 'generate_schema', status: 'complete', data: schemaJson }], type: 'actions', route: 'chat' })}\n\n`);
      }

      if (isSchemaIntent && !schema) {
        // Only generate new schema if no existing schema is available
        console.log('[Backend] Processing schema generation intent with no existing schema');
        try {
          const outputParser = new JsonOutputParser();
          const parsed = await outputParser.parse(llmBuffer);
          if (parsed && (parsed.properties || parsed.type)) {
            console.log('[Backend] Sending generate_schema action for new schema');
            res.write(`data: ${JSON.stringify({ actions: [{ type: 'generate_schema', status: 'complete', data: parsed }], type: 'actions', route: 'chat' })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ actions: [{ type: 'error', status: 'failed', message: 'No valid schema found in LLM output.' }], type: 'actions', route: 'chat' })}\n\n`);
          }
        } catch (err) {
          res.write(`data: ${JSON.stringify({ actions: [{ type: 'error', status: 'failed', message: 'Schema extraction error: ' + err.message }], type: 'actions', route: 'chat' })}\n\n`);
        }
      }
    } catch (error) {
      console.error('[LLM Agent] Error in handleStreamingWithAgents:', {
        message: error.message,
        type: error.type,
        status: error.status,
        code: error.code,
        stack: error.stack
      });
      
      // Provide more detailed error information
      let errorMessage = error.message;
      let errorType = 'unknown_error';
      
      if (error.status === 400) {
        errorType = 'invalid_request';
        if (error.message.includes('invalid_request')) {
          errorMessage = 'Invalid request to AI service. This could be due to API key issues, rate limiting, or request format problems.';
        }
      } else if (error.status === 401) {
        errorType = 'authentication_error';
        errorMessage = 'Authentication failed. Please check the API key configuration.';
      } else if (error.status === 429) {
        errorType = 'rate_limit_error';
        errorMessage = 'Rate limit exceeded. Please try again in a moment.';
      } else if (error.status === 500) {
        errorType = 'server_error';
        errorMessage = 'AI service is temporarily unavailable. Please try again later.';
      }
      
      res.write(`data: ${JSON.stringify({ 
        actions: [{ 
          type: 'error', 
          status: 'failed', 
          message: errorMessage,
          errorType: errorType,
          originalError: error.message,
          statusCode: error.status
        }], 
        type: 'actions', 
        route: 'chat' 
      })}\n\n`);
    } finally {
      res.end();
    }
  }
};
