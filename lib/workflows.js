import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, CreateStateMachineCommand, UpdateStateMachineCommand, DescribeStateMachineCommand, DeleteStateMachineCommand, StartExecutionCommand, DescribeExecutionCommand } from '@aws-sdk/client-sfn';
import { LambdaClient, CreateFunctionCommand, UpdateFunctionCodeCommand, GetFunctionCommand, AddPermissionCommand } from '@aws-sdk/client-lambda';
import { IAMClient, GetRoleCommand } from '@aws-sdk/client-iam';
import { EventBridgeClient, CreateConnectionCommand, DescribeConnectionCommand } from '@aws-sdk/client-eventbridge';
import { v4 as uuidv4 } from 'uuid';
import archiver from 'archiver';
import { docClient } from './dynamodb-client.js';

const sfnClient = new SFNClient({ region: process.env.AWS_REGION || 'us-east-1' });
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
const iamClient = new IAMClient({ region: process.env.AWS_REGION || 'us-east-1' });
const eventBridgeClient = new EventBridgeClient({ region: process.env.AWS_REGION || 'us-east-1' });

const WORKFLOWS_TABLE = 'brmh-workflows';
const STEP_FUNCTIONS_ROLE_ARN = process.env.STEP_FUNCTIONS_ROLE_ARN || 'arn:aws:iam::YOUR_ACCOUNT:role/StepFunctionsExecutionRole';
const LAMBDA_EXECUTION_ROLE_ARN = process.env.LAMBDA_EXECUTION_ROLE_ARN || 'arn:aws:iam::YOUR_ACCOUNT:role/LambdaExecutionRole';

// Validate IAM role ARN format
function validateIamRoleArn(arn, roleName) {
  if (!arn || arn.includes('YOUR_ACCOUNT')) {
    throw new Error(
      `Invalid ${roleName} IAM Role ARN. Please set the ${roleName} environment variable with a valid ARN.\n` +
      `Example: arn:aws:iam::123456789012:role/LambdaExecutionRole\n` +
      `Current value: ${arn || 'not set'}`
    );
  }
  const arnPattern = /^arn:(aws[a-zA-Z-]*)?:iam::\d{12}:role\/?[a-zA-Z_0-9+=,.@\-_/]+$/;
  if (!arnPattern.test(arn)) {
    throw new Error(
      `Invalid ${roleName} IAM Role ARN format: ${arn}\n` +
      `Expected format: arn:aws:iam::ACCOUNT_ID:role/ROLE_NAME`
    );
  }
  return arn;
}

/**
 * Create a ZIP buffer from Lambda code
 */
function createZipBuffer(code) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    archive.on('error', (err) => reject(err));
    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    
    // Add the Lambda code as index.js
    archive.append(code, { name: 'index.js' });
    
    archive.finalize();
  });
}

// Get backend URL and normalize it (remove trailing slash)
const getBackendUrl = () => {
  const url = process.env.BACKEND_URL || process.env.CRUD_API_BASE_URL || 'http://localhost:5001';
  // Remove trailing slash if present
  return url.replace(/\/+$/, '');
};
const BACKEND_URL = getBackendUrl();

/**
 * Get API method details from namespace system
 */
async function getApiMethodDetails(methodId, accountId, namespaceId) {
  try {
    const baseUrl = BACKEND_URL;
    
    // Construct full URLs - ensure no double slashes
    const methodUrl = `${baseUrl}/unified/methods/${methodId}`;
    const accountUrl = `${baseUrl}/unified/accounts/${accountId}`;
    const namespaceUrl = `${baseUrl}/unified/namespaces/${namespaceId}`;
    
    console.log(`[Workflow] Fetching method details from: ${methodUrl}`);
    console.log(`[Workflow] Fetching account details from: ${accountUrl}`);
    console.log(`[Workflow] Fetching namespace details from: ${namespaceUrl}`);
    
    // Fetch method details
    const methodRes = await fetch(methodUrl);
    if (!methodRes.ok) {
      throw new Error(`Method ${methodId} not found (${methodRes.status}): ${methodUrl}`);
    }
    const methodData = await methodRes.json();
    // Method data might be wrapped in a 'data' field
    const method = methodData.data || methodData;

    // Fetch account details
    const accountRes = await fetch(accountUrl);
    if (!accountRes.ok) {
      throw new Error(`Account ${accountId} not found (${accountRes.status}): ${accountUrl}`);
    }
    const accountData = await accountRes.json();
    // Account data might be wrapped in a 'data' field
    const account = accountData.data || accountData;

    // Fetch namespace details
    const namespaceRes = await fetch(namespaceUrl);
    if (!namespaceRes.ok) {
      throw new Error(`Namespace ${namespaceId} not found (${namespaceRes.status}): ${namespaceUrl}`);
    }
    const namespaceData = await namespaceRes.json();
    // Namespace data might be wrapped in a 'data' field
    const namespace = namespaceData.data || namespaceData;

    return {
      method,
      account,
      namespace
    };
  } catch (error) {
    console.error('Error fetching API method details:', error);
    throw error;
  }
}

/**
 * Generate unified Lambda function code for workflow operations
 * Handles: Data transformation (API execution now uses Step Functions HTTP integration)
 * Uses built-in fetch (available in Node.js 18.x)
 * 
 * Note: API execution is now handled directly by Step Functions HTTP integration
 * Lambda is only used for data transformations which require custom logic
 */
function generateUnifiedWorkflowLambdaCode() {
  return `
// Unified workflow Lambda handler
// Now only handles transformations - API execution uses Step Functions HTTP integration
exports.handler = async (event) => {
  console.log('Workflow Lambda - Event:', JSON.stringify(event, null, 2));
  
  const operation = event.operation || 'transform'; // Only 'transform' now
  
  try {
    switch (operation) {
      case 'transform':
        return await handleTransformation(event);
      default:
        throw new Error(\`Unknown operation: \${operation}. Only 'transform' is supported.\`);
    }
  } catch (error) {
    console.error('Workflow Lambda Error:', error);
    return {
      success: false,
      error: error.message,
      operation
    };
  }
};

// Legacy API Execution Handler (kept for reference, but not used)
// API execution now uses Step Functions native HTTP integration
async function handleApiExecution(event) {
  const {
    url,
    method = 'GET',
    headers = {},
    queryParams = {},
    body = null,
    timeout = 30000
  } = event;
  
  if (!url) {
    throw new Error('URL is required for API execution');
  }
  
  try {
    // Build URL with query parameters
    const urlObj = new URL(url);
    Object.entries(queryParams || {}).forEach(([key, value]) => {
      if (key && value !== null && value !== undefined) {
        urlObj.searchParams.append(key, String(value));
      }
    });
    
    // Build fetch options
    const fetchOptions = {
      method: method.toUpperCase(),
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };
    
    // Add body for non-GET requests
    if (body && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(urlObj.toString(), {
        ...fetchOptions,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      // Get response headers
      const responseHeaders = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      
      // Parse response body
      let responseData;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        try {
          responseData = await response.json();
        } catch (e) {
          responseData = await response.text();
        }
      } else {
        responseData = await response.text();
      }
      
      return {
        statusCode: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        data: responseData,
        success: response.status >= 200 && response.status < 300
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        return {
          statusCode: 408,
          statusText: 'Request Timeout',
          error: 'Request exceeded timeout',
          success: false
        };
      }
      
      throw fetchError;
    }
  } catch (error) {
    console.error('API Execution Error:', error);
    
    return {
      statusCode: 500,
      statusText: 'Internal Server Error',
      error: error.message,
      success: false
    };
  }
}

// Transformation Handler
async function handleTransformation(event) {
  const transformationRules = event.transformationRules || {};
  const inputData = event.input || event;
  const previousResults = event.previousResults || {};
  
  try {
    const transformed = {};
    
    // Apply transformation rules
    for (const [targetField, sourceExpression] of Object.entries(transformationRules)) {
      try {
        // Simple template replacement: {{previousStep.result.field}}
        let value = sourceExpression;
        
        // Replace template variables
        value = value.replace(/\\{\\{([^}]+)\\}\\}/g, (match, path) => {
          const parts = path.trim().split('.');
          let result = previousResults;
          
          for (const part of parts) {
            if (result && typeof result === 'object') {
              result = result[part];
            } else {
              return match; // Return original if path not found
            }
          }
          
          return result !== undefined ? String(result) : match;
        });
        
        // If value is still a template, try to evaluate as JSON path
        if (value.includes('{{')) {
          // Try to extract JSON path
          const pathMatch = value.match(/\\{\\{([^}]+)\\}\\}/);
          if (pathMatch) {
            const path = pathMatch[1].trim();
            const parts = path.split('.');
            let result = previousResults;
            
            for (const part of parts) {
              if (result && typeof result === 'object') {
                result = result[part];
              } else {
                result = null;
                break;
              }
            }
            
            value = result !== undefined && result !== null ? result : value;
          }
        }
        
        // Try to parse as JSON if it looks like JSON
        if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
          try {
            value = JSON.parse(value);
          } catch (e) {
            // Keep as string if not valid JSON
          }
        }
        
        transformed[targetField] = value;
      } catch (error) {
        console.error(\`Error transforming field \${targetField}:\`, error);
        transformed[targetField] = sourceExpression; // Fallback to original
      }
    }
    
    return {
      success: true,
      transformed,
      originalInput: inputData,
      previousResults
    };
  } catch (error) {
    console.error('Transformation Error:', error);
    return {
      success: false,
      error: error.message,
      originalInput: inputData
    };
  }
}
`;
}

/**
 * Ensure EventBridge connection exists for HTTP invoke
 * Creates a basic HTTP connection if it doesn't exist
 */
async function ensureEventBridgeConnection() {
  const connectionName = 'brmh-http-connection';
  
  try {
    // Check if connection exists
    try {
      const result = await eventBridgeClient.send(new DescribeConnectionCommand({ Name: connectionName }));
      if (result.ConnectionState === 'AUTHORIZED') {
        console.log(`✅ EventBridge connection ${connectionName} already exists and is authorized: ${result.ConnectionArn}`);
        return result.ConnectionArn;
      } else {
        console.warn(`⚠️  EventBridge connection ${connectionName} exists but is not authorized. State: ${result.ConnectionState}. ARN: ${result.ConnectionArn}`);
        // Return the ARN anyway - it might work, or user can authorize it later
        return result.ConnectionArn;
      }
    } catch (error) {
      // Connection doesn't exist - we'll create it below
      if (error.name === 'ResourceNotFoundException' || error.name === 'NotFoundException' || error.code === 'ResourceNotFoundException') {
        // Continue to create connection
      } else {
        throw error;
      }
    }
    
    // Create connection if it doesn't exist
    console.log(`Creating EventBridge connection: ${connectionName}`);
    
    const createCommand = new CreateConnectionCommand({
      Name: connectionName,
      Description: 'BRMH HTTP connection for Step Functions HTTP invoke',
      AuthorizationType: 'BASIC', // Basic HTTP connection
      AuthParameters: {
        BasicAuthParameters: {
          Username: 'not-used', // Placeholder - actual auth is in headers
          Password: 'not-used'  // Placeholder - actual auth is in headers
        }
      }
    });
    
    const result = await eventBridgeClient.send(createCommand);
    console.log(`✅ Created EventBridge connection: ${connectionName}, ARN: ${result.ConnectionArn}`);
    console.log(`⚠️  Note: Connection needs to be authorized. Please authorize it in AWS Console or wait for auto-authorization.`);
    
    return result.ConnectionArn;
  } catch (error) {
    console.error('Error ensuring EventBridge connection:', error);
    // Don't throw - let the caller handle it
    throw new Error(`Failed to create EventBridge connection: ${error.message}. Please create a connection manually in AWS EventBridge.`);
  }
}

/**
 * Ensure unified Lambda function exists for all workflow operations
 * This single Lambda handles: API execution, data transformation, and future operations
 */
async function ensureWorkflowLambda() {
  const functionName = 'brmh-workflow-executor';
  
  try {
    // Validate IAM role ARN before attempting to create Lambda
    const validatedRoleArn = validateIamRoleArn(LAMBDA_EXECUTION_ROLE_ARN, 'LAMBDA_EXECUTION_ROLE_ARN');
    
    // Check if function exists
    try {
      await lambdaClient.send(new GetFunctionCommand({ FunctionName: functionName }));
      console.log(`✅ Unified workflow Lambda function ${functionName} already exists`);
      return functionName;
    } catch (error) {
      if (error.name !== 'ResourceNotFoundException') {
        throw error;
      }
    }
    
    // Create function if it doesn't exist
    console.log(`Creating unified workflow Lambda function: ${functionName}`);
    
    // Create Lambda code as a proper ZIP file
    const code = generateUnifiedWorkflowLambdaCode();
    const zipBuffer = await createZipBuffer(code);
    
    const createCommand = new CreateFunctionCommand({
      FunctionName: functionName,
      Runtime: 'nodejs18.x',
      Handler: 'index.handler',
      Role: validatedRoleArn,
      Code: {
        ZipFile: zipBuffer
      },
      Description: 'BRMH Workflow Executor - Handles data transformations (API execution uses Step Functions HTTP integration)',
      Timeout: 60,
      MemorySize: 256
    });
    
    const result = await lambdaClient.send(createCommand);
    console.log(`✅ Created unified workflow Lambda function: ${functionName}`);
    
    // Add permission for Step Functions to invoke
    try {
      await lambdaClient.send(new AddPermissionCommand({
        FunctionName: functionName,
        StatementId: 'step-functions-invoke',
        Action: 'lambda:InvokeFunction',
        Principal: 'states.amazonaws.com'
      }));
    } catch (permError) {
      if (permError.name !== 'ResourceConflictException') {
        console.warn('Could not add Step Functions permission:', permError.message);
      }
    }
    
    return functionName;
  } catch (error) {
    console.error('Error ensuring workflow Lambda:', error);
    throw error;
  }
}

/**
 * Build API execution parameters from method, account, and input mapping
 */
async function buildApiExecutionParams(step, previousResults = {}) {
  const { methodId, accountId, namespaceId, inputMapping, input, tableName, save } = step;
  
  // Get API method details
  const { method, account, namespace } = await getApiMethodDetails(methodId, accountId, namespaceId);
  
  // Build request body using input mapping or direct input
  let requestBody = input || {};
  
  if (inputMapping) {
    // Apply transformation to input
    const transformed = {};
    for (const [targetField, sourceExpression] of Object.entries(inputMapping)) {
      // Replace template variables
      let value = sourceExpression;
      
      // Replace {{previousStep.result.field}} patterns
      value = value.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
        const parts = path.trim().split('.');
        let result = previousResults;
        
        for (const part of parts) {
          if (result && typeof result === 'object') {
            result = result[part];
          } else {
            return match;
          }
        }
        
        return result !== undefined ? (typeof result === 'object' ? JSON.stringify(result) : String(result)) : match;
      });
      
      // Try to parse as JSON if it looks like JSON
      if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
        try {
          value = JSON.parse(value);
        } catch (e) {
          // Keep as string
        }
      }
      
      transformed[targetField] = value;
    }
    
    // Merge with sample input from method
    const sampleInput = method['sample-request'] || method['request-schema'] || {};
    requestBody = { ...sampleInput, ...transformed };
  }
  
  // Build the execute endpoint request body format
  // This matches the format: { executeType, namespaceId, accountId, methodId, requestBody, save, tableName }
  const executeRequestBody = {
    executeType: 'namespace',
    namespaceId: namespaceId,
    accountId: accountId,
    methodId: methodId,
    requestBody: requestBody,
    save: save !== undefined ? save : false,
    ...(tableName ? { tableName: tableName } : {})
  };
  
  // Get the execute endpoint URL
  const executeEndpoint = process.env.EXECUTE_ENDPOINT || process.env.BACKEND_URL || process.env.CRUD_API_BASE_URL || 'https://brmh.in';
  const executeUrl = executeEndpoint.endsWith('/execute') ? executeEndpoint : 
                     executeEndpoint.endsWith('/') ? `${executeEndpoint}execute` : 
                     `${executeEndpoint}/execute`;
  
  return {
    url: executeUrl,
    method: 'POST', // Execute endpoint is always POST
    headers: {
      'Content-Type': 'application/json'
    },
    queryParams: {}, // No query params for execute endpoint
    body: executeRequestBody // Execute endpoint request body
  };
}

/**
 * Generate Step Functions state machine definition from workflow
 */
export async function generateStepFunctionsDefinition(workflow) {
  const { workflowId, name, steps, startStep } = workflow;
  const states = {};
  // Map step IDs to state names for tracking
  const stepIdToStateName = {};
  
  // Generate readable state names
  let stepCounter = 0;
  for (const step of steps) {
    if (step.type === 'api') {
      stepCounter++;
      const stateName = step.name || `Call HTTPS APIs${stepCounter > 1 ? ` (${stepCounter - 1})` : ''}`;
      stepIdToStateName[step.id] = stateName;
    } else if (step.type === 'choice' || step.type === 'condition') {
      stepIdToStateName[step.id] = step.name || 'Choice';
    } else {
      stepIdToStateName[step.id] = step.name || step.id;
    }
  }
  
  let startAt = startStep ? stepIdToStateName[startStep] : (steps[0] ? stepIdToStateName[steps[0].id] : 'Start');
  
  // Ensure unified workflow Lambda exists
  const workflowLambda = await ensureWorkflowLambda();
  // Get account ID from role ARN or environment
  const accountId = STEP_FUNCTIONS_ROLE_ARN.split(':')[4] || process.env.AWS_ACCOUNT_ID || 'YOUR_ACCOUNT';
  const workflowLambdaArn = `arn:aws:lambda:${process.env.AWS_REGION || 'us-east-1'}:${accountId}:function:${workflowLambda}`;
  
  // Process each step
  for (const step of steps) {
    const { id, type, next, onSuccess, onFailure, resultKey = 'result' } = step;
    
    if (type === 'api') {
      // Build API execution parameters
      const apiParams = await buildApiExecutionParams(step);
      
      // Always use Step Functions HTTP invoke for API calls (not Lambda)
      // Lambda is only used for transformations
      // Use Parameters (not Arguments) when using JSONPath (default QueryLanguage)
      const httpTaskParams = {
        ApiEndpoint: apiParams.url,
        Method: (apiParams.method || 'POST').toUpperCase(),
        RequestBody: apiParams.body
      };
      
      // Add Headers if present
      if (apiParams.headers && Object.keys(apiParams.headers).length > 0) {
        httpTaskParams.Headers = apiParams.headers;
      }
      
      // AWS Step Functions HTTP invoke REQUIRES either InvocationConfig or Authentication
      // Both require a ConnectionArn. If not provided, create/use a default one
      const connectionArn = step.connectionArn;
      let trimmedArn = null;
      
      if (connectionArn !== undefined && connectionArn !== null) {
        if (typeof connectionArn === 'string') {
          trimmedArn = connectionArn.trim();
          if (trimmedArn !== '' && trimmedArn.startsWith('arn:aws:') && trimmedArn.length >= 20) {
            // Valid ConnectionArn - use it
            console.log(`[Workflow] Using provided ConnectionArn for step ${id}:`, trimmedArn);
          } else {
            console.warn(`[Workflow] Invalid ConnectionArn format for step ${id}, will create/use default connection:`, connectionArn);
            trimmedArn = null;
          }
        } else {
          console.warn(`[Workflow] ConnectionArn must be a string for step ${id}, will create/use default connection:`, typeof connectionArn);
          trimmedArn = null;
        }
      }
      
      // If no valid ConnectionArn provided, ensure default connection exists
      if (!trimmedArn) {
        try {
          trimmedArn = await ensureEventBridgeConnection();
          console.log(`[Workflow] Using default EventBridge connection for step ${id}:`, trimmedArn);
        } catch (error) {
          throw new Error(`No ConnectionArn provided for step ${id} and failed to create default connection: ${error.message}. Please provide a ConnectionArn in your workflow step configuration or create an EventBridge connection manually.`);
        }
      }
      
      // Add InvocationConfig with ConnectionArn
      httpTaskParams.InvocationConfig = {
        ConnectionArn: trimmedArn
      };
      
      // Build Retry configuration (default or from step config)
      const retryConfig = step.retry || {
        ErrorEquals: ['States.ALL'],
        BackoffRate: 2,
        IntervalSeconds: 1,
        MaxAttempts: 3,
        JitterStrategy: 'FULL'
      };
      
      // Get the state name for this step
      const stateName = stepIdToStateName[id];
      
      // Determine next state or end
      let nextState = null;
      let isEnd = false;
      
      if (onSuccess && onFailure) {
        const choiceStateName = `${stateName}Choice`;
        nextState = choiceStateName;
        stepIdToStateName[`${id}Choice`] = choiceStateName;
      } else if (onSuccess) {
        const choiceStateName = `${stateName}Choice`;
        nextState = choiceStateName;
        stepIdToStateName[`${id}Choice`] = choiceStateName;
      } else if (next) {
        nextState = stepIdToStateName[next] || next;
      } else {
        isEnd = true;
      }
      
      // Build HTTP task state - using Parameters (not Arguments) for JSONPath QueryLanguage
      const httpTaskState = {
        Type: 'Task',
        Resource: 'arn:aws:states:::http:invoke',
        Parameters: httpTaskParams, // Use Parameters for JSONPath, Arguments is only for JSONata
        Retry: [retryConfig],
        ...(isEnd ? { End: true } : { Next: nextState })
      };
      
      states[stateName] = httpTaskState;
      
      // Handle Choice states for HTTP invoke
      if (onSuccess && onFailure) {
        const choiceStateName = `${stateName}Choice`;
        const successStateName = stepIdToStateName[onSuccess] || onSuccess;
        const failureStateName = stepIdToStateName[onFailure] || onFailure;
        
        states[choiceStateName] = {
          Type: 'Choice',
          Choices: [
            {
              Variable: `$.${resultKey || 'result'}.StatusCode`,
              NumericGreaterThanEquals: 200,
              NumericLessThan: 300,
              Next: successStateName
            }
          ],
          Default: failureStateName
        };
      } else if (onSuccess) {
        const choiceStateName = `${stateName}Choice`;
        const successStateName = stepIdToStateName[onSuccess] || onSuccess;
        
        states[choiceStateName] = {
          Type: 'Choice',
          Choices: [
            {
              Variable: `$.${resultKey || 'result'}.StatusCode`,
              NumericGreaterThanEquals: 200,
              NumericLessThan: 300,
              Next: successStateName
            }
          ],
          Default: 'FailState'
        };
      }
      
    } else if (type === 'transform') {
      // Use unified workflow Lambda for transformation
      const transformState = {
        Type: 'Task',
        Resource: workflowLambdaArn,
        Parameters: {
          operation: 'transform', // Specify operation type
          transformationRules: step.inputMapping || {},
          input: step.input || {},
          previousResults: step.previousResults || {}
        },
        ResultPath: `$.${resultKey || 'transformed'}`
      };
      
      // Only set Next OR End, never both
      if (next) {
        transformState.Next = next;
      } else {
        transformState.End = true;
      }
      
      states[id] = transformState;
      
    } else if (type === 'sns') {
      // SNS notification step
      const snsState = {
        Type: 'Task',
        Resource: 'arn:aws:states:::sns:publish',
        Parameters: {
          TopicArn: step.topicArn,
          Message: step.message || 'Workflow notification',
          Subject: step.subject || 'Workflow Update'
        }
      };
      if (next) {
        snsState.Next = next;
      } else {
        snsState.End = true;
      }
      states[id] = snsState;
      
    } else if (type === 'sqs') {
      // SQS send message step
      const sqsState = {
        Type: 'Task',
        Resource: 'arn:aws:states:::sqs:sendMessage',
        Parameters: {
          QueueUrl: step.queueUrl,
          MessageBody: step.messageBody || '{}'
        }
      };
      if (next) {
        sqsState.Next = next;
      } else {
        sqsState.End = true;
      }
      states[id] = sqsState;
      
    } else if (type === 'wait') {
      // Wait step
      const waitState = {
        Type: 'Wait',
        Seconds: step.seconds || 1
      };
      if (next) {
        waitState.Next = next;
      } else {
        waitState.End = true;
      }
      states[id] = waitState;
      
    } else if (type === 'choice' || type === 'condition') {
      // Choice/Condition step - conditional branching
      const choices = [];
      
      // Process each condition rule
      if (step.conditions && Array.isArray(step.conditions)) {
        for (const condition of step.conditions) {
          const choiceRule = {
            Variable: condition.variable || condition.field, // Support both field names
            Next: condition.next || condition.then
          };
          
          // Add comparison operator
          if (condition.operator) {
            const operator = condition.operator.toLowerCase();
            const value = condition.value;
            
            // String comparisons
            if (operator === 'equals' || operator === '===' || operator === '==') {
              choiceRule.StringEquals = String(value);
            } else if (operator === 'notequals' || operator === '!==') {
              choiceRule.StringNotEquals = String(value);
            } else if (operator === 'contains' || operator === 'matches') {
              // Step Functions doesn't have direct "contains", use StringMatches with wildcard
              choiceRule.StringMatches = `*${String(value)}*`;
            } else if (operator === 'startswith' || operator === 'starts-with') {
              choiceRule.StringMatches = `${String(value)}*`;
            } else if (operator === 'endswith' || operator === 'ends-with') {
              choiceRule.StringMatches = `*${String(value)}`;
            }
            // Numeric comparisons
            else if (operator === 'greaterthan' || operator === '>') {
              choiceRule.NumericGreaterThan = Number(value);
            } else if (operator === 'greaterthanorequal' || operator === '>=') {
              choiceRule.NumericGreaterThanEquals = Number(value);
            } else if (operator === 'lessthan' || operator === '<') {
              choiceRule.NumericLessThan = Number(value);
            } else if (operator === 'lessthanorequal' || operator === '<=') {
              choiceRule.NumericLessThanEquals = Number(value);
            }
            // Boolean comparisons
            else if (operator === 'istrue' || operator === 'true') {
              choiceRule.BooleanEquals = true;
            } else if (operator === 'isfalse' || operator === 'false') {
              choiceRule.BooleanEquals = false;
            }
            // Presence checks
            else if (operator === 'exists' || operator === 'present') {
              choiceRule.IsPresent = true;
            } else if (operator === 'notexists' || operator === 'notpresent') {
              choiceRule.IsPresent = false;
            }
            // Default: StringEquals
            else {
              choiceRule.StringEquals = String(value);
            }
          } else if (condition.equals !== undefined) {
            // Support direct 'equals' property
            choiceRule.StringEquals = String(condition.equals);
          } else if (condition.value !== undefined) {
            // Default to StringEquals if no operator specified
            choiceRule.StringEquals = String(condition.value);
          }
          
          choices.push(choiceRule);
        }
      }
      
      // Create Choice state
      states[id] = {
        Type: 'Choice',
        Choices: choices,
        Default: step.default || step.defaultNext || 'FailState'
      };
      
      // Add default FailState if referenced and doesn't exist
      if (states[id].Default === 'FailState' && !states.FailState) {
        states.FailState = {
          Type: 'Fail',
          Error: 'ConditionNotMet',
          Cause: 'No condition matched and no default path specified'
        };
      }
      
    } else if (type === 'end') {
      // End state
      states[id] = {
        Type: 'Succeed'
      };
      
    } else if (type === 'fail') {
      // Fail state
      states[id] = {
        Type: 'Fail',
        Error: step.error || 'WorkflowFailed',
        Cause: step.cause || 'Workflow execution failed'
      };
    }
  }
  
  // Add a default FailState if referenced
  if (Object.values(states).some(state => state.Default === 'FailState')) {
    states.FailState = {
      Type: 'Fail',
      Error: 'WorkflowFailed',
      Cause: 'A step in the workflow failed'
    };
  }
  
  return {
    Comment: `Workflow: ${name}`,
    StartAt: startAt,
    States: states
  };
}

/**
 * Create or update Step Functions state machine for workflow
 */
async function createOrUpdateStateMachine(workflow) {
  try {
    const { workflowId, name } = workflow;
    const stateMachineName = `brmh-workflow-${workflowId}`.substring(0, 80); // Step Functions name limit
    
    // Validate Step Functions role ARN before creating/updating state machine
    const validatedStepFunctionsRoleArn = validateIamRoleArn(STEP_FUNCTIONS_ROLE_ARN, 'STEP_FUNCTIONS_ROLE_ARN');
    
    // Generate state machine definition
    const definition = await generateStepFunctionsDefinition(workflow);
    
    // Debug: Log the full definition to help diagnose issues
    console.log('[Workflow] Generated State Machine Definition:', JSON.stringify(definition, null, 2));
    
    // Check if state machine already exists
    let stateMachineArn = workflow.stateMachineArn;
    
    if (stateMachineArn) {
      try {
        // Update existing state machine
        await sfnClient.send(new UpdateStateMachineCommand({
          stateMachineArn,
          definition: JSON.stringify(definition)
        }));
        console.log(`✅ Updated state machine: ${stateMachineArn}`);
        return stateMachineArn;
      } catch (error) {
        if (error.name !== 'StateMachineDoesNotExist') {
          throw error;
        }
        // State machine doesn't exist, create new one
        stateMachineArn = null;
      }
    }
    
    if (!stateMachineArn) {
      // Create new state machine
      const createCommand = new CreateStateMachineCommand({
        name: stateMachineName,
        definition: JSON.stringify(definition),
        roleArn: validatedStepFunctionsRoleArn,
        type: 'STANDARD'
      });
      
      const result = await sfnClient.send(createCommand);
      stateMachineArn = result.stateMachineArn;
      console.log(`✅ Created state machine: ${stateMachineArn}`);
    }
    
    return stateMachineArn;
  } catch (error) {
    console.error('Error creating/updating state machine:', error);
    throw error;
  }
}

/**
 * Workflow CRUD Handlers
 */

export const createWorkflow = async (workflowData) => {
  try {
    const workflowId = uuidv4();
    const timestamp = new Date().toISOString();
    
    const workflow = {
      id: workflowId,
      workflowId,
      name: workflowData.name,
      description: workflowData.description || '',
      steps: workflowData.steps || [],
      startStep: workflowData.startStep || workflowData.steps?.[0]?.id,
      status: 'draft', // draft, active, inactive
      stateMachineArn: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: workflowData.createdBy || 'system',
      tags: workflowData.tags || [],
      ...workflowData
    };
    
    // Create Step Functions state machine if workflow is active
    if (workflow.status === 'active') {
      try {
        const stateMachineArn = await createOrUpdateStateMachine(workflow);
        workflow.stateMachineArn = stateMachineArn;
      } catch (error) {
        console.error('Error creating state machine for new workflow:', error);
        // Continue without state machine - can be created later
      }
    }
    
    await docClient.send(new PutCommand({
      TableName: WORKFLOWS_TABLE,
      Item: workflow
    }));
    
    console.log(`✅ Created workflow: ${workflowId}`);
    return workflow;
  } catch (error) {
    console.error('Error creating workflow:', error);
    throw error;
  }
};

export const getWorkflow = async (workflowId) => {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: WORKFLOWS_TABLE,
      Key: { id: workflowId }
    }));
    
    if (!result.Item) {
      throw new Error('Workflow not found');
    }
    
    return result.Item;
  } catch (error) {
    console.error('Error getting workflow:', error);
    throw error;
  }
};

export const listWorkflows = async (filters = {}) => {
  try {
    const scanParams = {
      TableName: WORKFLOWS_TABLE
    };
    
    // Add filters if provided
    if (Object.keys(filters).length > 0) {
      const filterExpressions = [];
      const expressionAttributeNames = {};
      const expressionAttributeValues = {};
      
      if (filters.status) {
        filterExpressions.push('#status = :status');
        expressionAttributeNames['#status'] = 'status';
        expressionAttributeValues[':status'] = filters.status;
      }
      
      if (filters.createdBy) {
        filterExpressions.push('#createdBy = :createdBy');
        expressionAttributeNames['#createdBy'] = 'createdBy';
        expressionAttributeValues[':createdBy'] = filters.createdBy;
      }
      
      if (filterExpressions.length > 0) {
        scanParams.FilterExpression = filterExpressions.join(' AND ');
        scanParams.ExpressionAttributeNames = expressionAttributeNames;
        scanParams.ExpressionAttributeValues = expressionAttributeValues;
      }
    }
    
    const result = await docClient.send(new ScanCommand(scanParams));
    return result.Items || [];
  } catch (error) {
    console.error('Error listing workflows:', error);
    throw error;
  }
};

export const updateWorkflow = async (workflowId, updates) => {
  try {
    const timestamp = new Date().toISOString();
    
    // Get existing workflow
    const existing = await getWorkflow(workflowId);
    const updatedWorkflow = { ...existing, ...updates, updatedAt: timestamp };
    
    // If status changed to active or steps were updated, update state machine
    if ((updates.status === 'active' || updates.steps) && updatedWorkflow.steps.length > 0) {
      try {
        const stateMachineArn = await createOrUpdateStateMachine(updatedWorkflow);
        updatedWorkflow.stateMachineArn = stateMachineArn;
      } catch (error) {
        console.error('Error updating state machine:', error);
        // Continue without updating state machine
      }
    }
    
    // Update in DynamoDB
    const updateExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};
    
    // Build update expressions from updates object, excluding stateMachineArn (handled separately)
    Object.keys(updates).forEach(key => {
      if (key !== 'id' && key !== 'workflowId' && key !== 'stateMachineArn') {
        updateExpressions.push(`#${key} = :${key}`);
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = updates[key];
      }
    });
    
    // Always update updatedAt
    updateExpressions.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = timestamp;
    
    // Handle stateMachineArn separately (from updates or from state machine creation)
    if (updatedWorkflow.stateMachineArn) {
      updateExpressions.push('#stateMachineArn = :stateMachineArn');
      expressionAttributeNames['#stateMachineArn'] = 'stateMachineArn';
      expressionAttributeValues[':stateMachineArn'] = updatedWorkflow.stateMachineArn;
    }
    
    await docClient.send(new UpdateCommand({
      TableName: WORKFLOWS_TABLE,
      Key: { id: workflowId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    }));
    
    console.log(`✅ Updated workflow: ${workflowId}`);
    return updatedWorkflow;
  } catch (error) {
    console.error('Error updating workflow:', error);
    throw error;
  }
};

export const deleteWorkflow = async (workflowId) => {
  try {
    // Get workflow to check for state machine
    const workflow = await getWorkflow(workflowId);
    
    // Delete state machine if it exists
    if (workflow.stateMachineArn) {
      try {
        await sfnClient.send(new DeleteStateMachineCommand({
          stateMachineArn: workflow.stateMachineArn
        }));
        console.log(`✅ Deleted state machine: ${workflow.stateMachineArn}`);
      } catch (error) {
        console.warn('Error deleting state machine:', error.message);
        // Continue with workflow deletion
      }
    }
    
    // Delete workflow from DynamoDB
    await docClient.send(new DeleteCommand({
      TableName: WORKFLOWS_TABLE,
      Key: { id: workflowId }
    }));
    
    console.log(`✅ Deleted workflow: ${workflowId}`);
    return { success: true };
  } catch (error) {
    console.error('Error deleting workflow:', error);
    throw error;
  }
};

/**
 * Execute workflow
 */
export const executeWorkflow = async (workflowId, input = {}, waitForCompletion = false) => {
  try {
    const workflow = await getWorkflow(workflowId);
    
    if (!workflow.stateMachineArn) {
      throw new Error('Workflow does not have an associated state machine. Please deploy the workflow first.');
    }
    
    // Start Step Functions execution
    const executionName = `${workflowId}-${Date.now()}`;
    const startCommand = new StartExecutionCommand({
      stateMachineArn: workflow.stateMachineArn,
      name: executionName,
      input: JSON.stringify(input)
    });
    
    const result = await sfnClient.send(startCommand);
    
    console.log(`✅ Started workflow execution: ${result.executionArn}`);
    
    const executionResponse = {
      executionArn: result.executionArn,
      startDate: result.startDate,
      workflowId,
      workflowName: workflow.name
    };
    
    // If waitForCompletion is true, poll for results
    if (waitForCompletion) {
      const executionResult = await waitForExecution(result.executionArn);
      return {
        ...executionResponse,
        ...executionResult
      };
    }
    
    return executionResponse;
  } catch (error) {
    console.error('Error executing workflow:', error);
    throw error;
  }
};

/**
 * Get execution status and output
 */
export const getExecutionStatus = async (executionArn) => {
  try {
    const describeCommand = new DescribeExecutionCommand({
      executionArn
    });
    
    const result = await sfnClient.send(describeCommand);
    
    let output = null;
    try {
      output = result.output ? JSON.parse(result.output) : null;
    } catch (e) {
      output = result.output;
    }
    
    return {
      executionArn: result.executionArn,
      status: result.status, // RUNNING, SUCCEEDED, FAILED, TIMED_OUT, ABORTED
      startDate: result.startDate,
      stopDate: result.stopDate,
      output,
      error: result.error || null,
      cause: result.cause || null
    };
  } catch (error) {
    console.error('Error getting execution status:', error);
    throw error;
  }
};

/**
 * Wait for execution to complete (with polling)
 */
async function waitForExecution(executionArn, maxWaitTime = 300000, pollInterval = 2000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitTime) {
    const status = await getExecutionStatus(executionArn);
    
    if (status.status === 'SUCCEEDED') {
      return {
        status: 'SUCCEEDED',
        output: status.output,
        stopDate: status.stopDate
      };
    }
    
    if (status.status === 'FAILED' || status.status === 'TIMED_OUT' || status.status === 'ABORTED') {
      return {
        status: status.status,
        error: status.error,
        cause: status.cause,
        stopDate: status.stopDate
      };
    }
    
    // Still running, wait and poll again
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  // Timeout
  return {
    status: 'RUNNING',
    message: 'Execution is still running. Use getExecutionStatus to check later.'
  };
}

/**
 * Deploy workflow (create/update state machine)
 */
export const deployWorkflow = async (workflowId) => {
  try {
    const workflow = await getWorkflow(workflowId);
    
    if (!workflow.steps || workflow.steps.length === 0) {
      throw new Error('Workflow has no steps');
    }
    
    // Create or update state machine
    const stateMachineArn = await createOrUpdateStateMachine(workflow);
    
    // Update workflow with state machine ARN
    await updateWorkflow(workflowId, {
      stateMachineArn,
      status: 'active'
    });
    
    return {
      success: true,
      stateMachineArn,
      workflowId
    };
  } catch (error) {
    console.error('Error deploying workflow:', error);
    throw error;
  }
};

/**
 * Get available API methods for workflow steps
 */
export const getAvailableApiMethods = async (namespaceId = null) => {
  try {
    let methods = [];
    
    if (namespaceId) {
      // Get methods for specific namespace
      const response = await fetch(`${BACKEND_URL}/unified/namespaces/${namespaceId}/methods`);
      if (response.ok) {
        methods = await response.json();
      }
    } else {
      // Get all methods from all namespaces
      const namespacesRes = await fetch(`${BACKEND_URL}/unified/namespaces`);
      if (namespacesRes.ok) {
        const namespaces = await namespacesRes.json();
        
        // Fetch methods for each namespace
        const methodPromises = namespaces.map(async (ns) => {
          try {
            const methodsRes = await fetch(`${BACKEND_URL}/unified/namespaces/${ns['namespace-id']}/methods`);
            if (methodsRes.ok) {
              const nsMethods = await methodsRes.json();
              return nsMethods.map(m => ({
                ...m,
                namespaceId: ns['namespace-id'],
                namespaceName: ns['namespace-name']
              }));
            }
          } catch (error) {
            console.warn(`Error fetching methods for namespace ${ns['namespace-id']}:`, error);
          }
          return [];
        });
        
        const allMethods = await Promise.all(methodPromises);
        methods = allMethods.flat();
      }
    }
    
    return methods;
  } catch (error) {
    console.error('Error getting available API methods:', error);
    throw error;
  }
};

/**
 * Get Step Functions definition for a workflow
 */
export const getStepFunctionsDefinition = async (workflowId) => {
  try {
    const workflow = await getWorkflow(workflowId);
    
    if (!workflow.steps || workflow.steps.length === 0) {
      throw new Error('Workflow has no steps');
    }
    
    // Generate Step Functions definition
    const definition = await generateStepFunctionsDefinition(workflow);
    
    return {
      success: true,
      definition,
      workflowId
    };
  } catch (error) {
    console.error('Error getting Step Functions definition:', error);
    throw error;
  }
};

export const handlers = {
  createWorkflow,
  getWorkflow,
  listWorkflows,
  updateWorkflow,
  deleteWorkflow,
  executeWorkflow,
  getExecutionStatus,
  deployWorkflow,
  getAvailableApiMethods,
  getStepFunctionsDefinition
};

