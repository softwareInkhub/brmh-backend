import { LambdaClient, CreateFunctionCommand, UpdateFunctionCodeCommand, GetFunctionCommand, InvokeCommand, AddPermissionCommand } from '@aws-sdk/client-lambda';
import { IAMClient, CreateRoleCommand, AttachRolePolicyCommand, GetRoleCommand } from '@aws-sdk/client-iam';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ApiGatewayV2Client, CreateApiCommand, CreateIntegrationCommand, CreateRouteCommand, CreateStageCommand, GetApiCommand, GetApisCommand } from '@aws-sdk/client-apigatewayv2';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import archiver from 'archiver';
import { Readable } from 'stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize AWS clients
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
const iamClient = new IAMClient({ region: process.env.AWS_REGION || 'us-east-1' });
const stsClient = new STSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamoDBClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const apiGatewayClient = new ApiGatewayV2Client({ region: process.env.AWS_REGION || 'us-east-1' });

// Lambda execution role ARN
const LAMBDA_EXECUTION_ROLE_ARN = process.env.LAMBDA_EXECUTION_ROLE_ARN || 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole';

export class LambdaDeploymentManager {
  constructor() {
    this.tempDir = path.join(__dirname, '../temp');
    this.ensureTempDir();
  }

  ensureTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async createLambdaRole(roleName) {
    try {
      // Check if role already exists
      try {
        await iamClient.send(new GetRoleCommand({ RoleName: roleName }));
        console.log(`[Lambda Deployment] Role ${roleName} already exists`);
        return `arn:aws:iam::${process.env.AWS_ACCOUNT_ID || '123456789012'}:role/${roleName}`;
      } catch (error) {
        if (error.name !== 'NoSuchEntity') {
          throw error;
        }
      }

      // Create trust policy for Lambda
      const trustPolicy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'lambda.amazonaws.com'
            },
            Action: 'sts:AssumeRole'
          }
        ]
      };

      // Create the role
      const createRoleResponse = await iamClient.send(new CreateRoleCommand({
        RoleName: roleName,
        AssumeRolePolicyDocument: JSON.stringify(trustPolicy),
        Description: `Lambda execution role for ${roleName}`
      }));

      // Attach basic execution policy
      await iamClient.send(new AttachRolePolicyCommand({
        RoleName: roleName,
        PolicyArn: LAMBDA_EXECUTION_ROLE_ARN
      }));

      console.log(`[Lambda Deployment] Created role: ${createRoleResponse.Role.Arn}`);
      return createRoleResponse.Role.Arn;
    } catch (error) {
      console.error('[Lambda Deployment] Error creating role:', error);
      throw error;
    }
  }

  async createDeploymentPackage(functionName, code, dependencies = {}) {
    const functionDir = path.join(this.tempDir, functionName);
    
    // Clean up existing directory
    if (fs.existsSync(functionDir)) {
      fs.rmSync(functionDir, { recursive: true });
    }
    fs.mkdirSync(functionDir, { recursive: true });

    // Write the main Lambda code
    fs.writeFileSync(path.join(functionDir, 'index.js'), code);

    // Check if we have a package.json from the frontend files
    // For now, we'll create a basic package.json and let npm install handle dependencies
    const packageJson = {
      name: functionName,
      version: '1.0.0',
      description: `Generated Lambda function: ${functionName}`,
      main: 'index.js',
      dependencies: dependencies
    };

    fs.writeFileSync(path.join(functionDir, 'package.json'), JSON.stringify(packageJson, null, 2));

    // Install dependencies with timeout
    const { exec } = await import('child_process');
    return new Promise((resolve, reject) => {
      const npmProcess = exec('npm install --production', { cwd: functionDir }, (error) => {
        if (error) {
          console.error('[Lambda Deployment] npm install error:', error);
          reject(error);
          return;
        }
        
        console.log('[Lambda Deployment] npm install completed successfully');
      });
      
      // Set timeout for npm install (5 minutes)
      const timeout = setTimeout(() => {
        npmProcess.kill();
        reject(new Error('npm install timed out after 5 minutes'));
      }, 5 * 60 * 1000);
      
      npmProcess.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`npm install failed with code ${code}`));
          return;
        }

        // Create zip file
        const zipPath = path.join(this.tempDir, `${functionName}.zip`);
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
          console.log(`[Lambda Deployment] Created deployment package: ${zipPath}`);
          resolve(zipPath);
        });

        archive.on('error', (err) => {
          reject(err);
        });

        archive.pipe(output);
        archive.directory(functionDir, false);
        archive.finalize();
      });
    });
  }

  async deployLambdaFunction(functionName, code, runtime = 'nodejs18.x', handler = 'index.handler', memorySize = 128, timeout = 30, dependencies = {}) {
    try {
      console.log(`[Lambda Deployment] Deploying function: ${functionName}`);
      console.log(`[Lambda Deployment] Configuration:`, { runtime, handler, memorySize, timeout });
      console.log(`[Lambda Deployment] Dependencies:`, dependencies);
      
      // Test AWS credentials first
      try {
        const stsResponse = await stsClient.send(new GetCallerIdentityCommand({}));
        console.log(`[Lambda Deployment] AWS credentials valid. Account: ${stsResponse.Account}`);
      } catch (credError) {
        console.error('[Lambda Deployment] AWS credentials error:', credError);
        throw new Error(`AWS credentials invalid: ${credError.message}`);
      }
      
      // Create deployment package
      const zipPath = await this.createDeploymentPackage(functionName, code, dependencies);
      
      // Get the real AWS account ID using STS
      let accountId;
      try {
        const stsResponse = await stsClient.send(new GetCallerIdentityCommand({}));
        accountId = stsResponse.Account;
        console.log(`[Lambda Deployment] Got real account ID: ${accountId}`);
      } catch (stsError) {
        console.error('[Lambda Deployment] Failed to get account ID from STS:', stsError);
        accountId = process.env.AWS_ACCOUNT_ID || '123456789012';
        console.log(`[Lambda Deployment] Using fallback account ID: ${accountId}`);
      }
      
      // Try to find or create a Lambda execution role
      let roleArn;
      const commonRoleNames = [
        'lambda-execution-role',
        'AWSLambdaBasicExecutionRole',
        'lambda-role',
        `${functionName}-execution-role`
      ];
      
      for (const roleName of commonRoleNames) {
        try {
          const fullRoleArn = `arn:aws:iam::${accountId}:role/${roleName}`;
          await iamClient.send(new GetRoleCommand({ RoleName: roleName }));
          roleArn = fullRoleArn;
          console.log(`[Lambda Deployment] Using existing role: ${roleArn}`);
          break;
        } catch (error) {
          if (error.name === 'NoSuchEntity') {
            console.log(`[Lambda Deployment] Role ${roleName} does not exist, trying next...`);
            continue;
          }
          throw error;
        }
      }
      
      // If no existing role found, create one
      if (!roleArn) {
        console.log(`[Lambda Deployment] No existing role found, creating new role...`);
        const roleName = `${functionName}-execution-role`;
        roleArn = await this.createLambdaRole(roleName);
      }
      
      // Check if function exists
      let functionExists = false;
      try {
        await lambdaClient.send(new GetFunctionCommand({ FunctionName: functionName }));
        functionExists = true;
        console.log(`[Lambda Deployment] Function ${functionName} already exists, updating...`);
      } catch (error) {
        if (error.name !== 'ResourceNotFoundException') {
          throw error;
        }
        console.log(`[Lambda Deployment] Function ${functionName} does not exist, creating...`);
      }

      const zipBuffer = fs.readFileSync(zipPath);
      
      if (functionExists) {
        // Update existing function
        const updateResponse = await lambdaClient.send(new UpdateFunctionCodeCommand({
          FunctionName: functionName,
          ZipFile: zipBuffer
        }));
        
        console.log(`[Lambda Deployment] Function updated: ${updateResponse.FunctionArn}`);
        return {
          success: true,
          functionArn: updateResponse.FunctionArn,
          functionName: functionName,
          runtime: runtime,
          handler: handler,
          codeSize: zipBuffer.length,
          description: `Generated Lambda function: ${functionName}`,
          timeout: timeout,
          memorySize: memorySize,
          lastModified: updateResponse.LastModified
        };
      } else {
        // Create new function
        const createResponse = await lambdaClient.send(new CreateFunctionCommand({
          FunctionName: functionName,
          Runtime: runtime,
          Handler: handler,
          Role: roleArn,
          Code: {
            ZipFile: zipBuffer
          },
          Description: `Generated Lambda function: ${functionName}`,
          Timeout: timeout,
          MemorySize: memorySize
        }));
        
        console.log(`[Lambda Deployment] Function created: ${createResponse.FunctionArn}`);
        return {
          success: true,
          functionArn: createResponse.FunctionArn,
          functionName: functionName,
          runtime: runtime,
          handler: handler,
          codeSize: zipBuffer.length,
          description: `Generated Lambda function: ${functionName}`,
          timeout: timeout,
          memorySize: memorySize,
          lastModified: createResponse.LastModified
        };
      }
    } catch (error) {
      console.error('[Lambda Deployment] Error deploying function:', error);
      throw error;
    } finally {
      // Clean up temp files
      await this.cleanupTempFiles(functionName);
    }
  }

  async invokeLambdaFunction(functionName, payload = {}) {
    try {
      console.log(`[Lambda Deployment] Invoking function: ${functionName}`);
      
      const response = await lambdaClient.send(new InvokeCommand({
        FunctionName: functionName,
        Payload: JSON.stringify(payload),
        LogType: 'Tail'
      }));

      const result = {
        statusCode: response.StatusCode,
        payload: JSON.parse(Buffer.from(response.Payload).toString()),
        logResult: response.LogResult ? Buffer.from(response.LogResult, 'base64').toString() : null
      };

      console.log(`[Lambda Deployment] Function invoked successfully:`, result);
      return result;
    } catch (error) {
      console.error('[Lambda Deployment] Error invoking function:', error);
      throw error;
    }
  }

  async cleanupTempFiles(functionName) {
    try {
      const functionDir = path.join(this.tempDir, functionName);
      const zipPath = path.join(this.tempDir, `${functionName}.zip`);
      
      if (fs.existsSync(functionDir)) {
        fs.rmSync(functionDir, { recursive: true });
      }
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
      }
      
      console.log(`[Lambda Deployment] Cleaned up temp files for: ${functionName}`);
    } catch (error) {
      console.error('[Lambda Deployment] Error cleaning up temp files:', error);
    }
  }

  async createApiGateway(functionName, functionArn, runtime, handler) {
    try {
      console.log(`[API Gateway] Creating API Gateway for function: ${functionName}`);
      console.log(`[API Gateway] Function ARN: ${functionArn}`);
      console.log(`[API Gateway] Runtime: ${runtime}`);
      console.log(`[API Gateway] Handler: ${handler}`);
      console.log(`[API Gateway] AWS Region: ${process.env.AWS_REGION || 'us-east-1'}`);
      console.log(`[API Gateway] AWS Account ID: ${process.env.AWS_ACCOUNT_ID || 'Not set'}`);
      
      // Validate required parameters
      if (!functionName || !functionArn) {
        throw new Error('Function name and ARN are required');
      }
      
      if (!process.env.AWS_ACCOUNT_ID) {
        console.warn(`[API Gateway] AWS_ACCOUNT_ID not set, using default: 123456789012`);
      }
      
      // Check if API already exists for this function
      let apiId = null;
      let apiName = `lambda-api-${functionName}`;
      
      try {
        console.log(`[API Gateway] Checking for existing APIs...`);
        const apisResponse = await apiGatewayClient.send(new GetApisCommand({}));
        console.log(`[API Gateway] Found ${apisResponse.Items?.length || 0} existing APIs`);
        
        const existingApi = apisResponse.Items?.find(api => api.Name === apiName);
        if (existingApi) {
          apiId = existingApi.ApiId;
          console.log(`[API Gateway] Found existing API: ${apiId}`);
        } else {
          console.log(`[API Gateway] No existing API found with name: ${apiName}`);
        }
      } catch (error) {
        console.error(`[API Gateway] Error checking existing APIs:`, error);
        console.log(`[API Gateway] Will create new API`);
      }

      if (!apiId) {
        // Create new API
        try {
          console.log(`[API Gateway] Creating new API with name: ${apiName}`);
          const createApiResponse = await apiGatewayClient.send(new CreateApiCommand({
            Name: apiName,
            ProtocolType: 'HTTP',
            Description: `API Gateway for Lambda function: ${functionName}`
          }));
          
          apiId = createApiResponse.ApiId;
          console.log(`[API Gateway] Created new API: ${apiId}`);
        } catch (error) {
          console.error(`[API Gateway] Error creating API:`, error);
          throw new Error(`Failed to create API Gateway: ${error.message}`);
        }
      }

      // Create integration
      let integrationResponse;
      try {
        console.log(`[API Gateway] Creating integration for API: ${apiId}`);
        integrationResponse = await apiGatewayClient.send(new CreateIntegrationCommand({
          ApiId: apiId,
          IntegrationType: 'AWS_PROXY',
          IntegrationUri: functionArn,
          IntegrationMethod: 'POST',
          PayloadFormatVersion: '2.0'
        }));

        console.log(`[API Gateway] Created integration: ${integrationResponse.IntegrationId}`);
      } catch (error) {
        console.error(`[API Gateway] Error creating integration:`, error);
        throw new Error(`Failed to create API Gateway integration: ${error.message}`);
      }

      // Create route
      let routeResponse;
      try {
        console.log(`[API Gateway] Creating route for integration: ${integrationResponse.IntegrationId}`);
        routeResponse = await apiGatewayClient.send(new CreateRouteCommand({
          ApiId: apiId,
          RouteKey: `POST /${functionName}`,
          Target: `integrations/${integrationResponse.IntegrationId}`
        }));

        console.log(`[API Gateway] Created route: ${routeResponse.RouteId}`);
      } catch (error) {
        console.error(`[API Gateway] Error creating route:`, error);
        throw new Error(`Failed to create API Gateway route: ${error.message}`);
      }

      // Create stage
      let stageResponse;
      try {
        console.log(`[API Gateway] Creating stage for API: ${apiId}`);
        stageResponse = await apiGatewayClient.send(new CreateStageCommand({
          ApiId: apiId,
          StageName: 'prod',
          AutoDeploy: true
        }));

        console.log(`[API Gateway] Created stage: ${stageResponse.StageName}`);
      } catch (error) {
        console.error(`[API Gateway] Error creating stage:`, error);
        throw new Error(`Failed to create API Gateway stage: ${error.message}`);
      }

      // Add Lambda permission for API Gateway
      try {
        console.log(`[API Gateway] Adding Lambda permission for API Gateway`);
        await lambdaClient.send(new AddPermissionCommand({
          FunctionName: functionName,
          StatementId: `api-gateway-${apiId}`,
          Action: 'lambda:InvokeFunction',
          Principal: 'apigateway.amazonaws.com',
          SourceArn: `arn:aws:execute-api:${process.env.AWS_REGION || 'us-east-1'}:${process.env.AWS_ACCOUNT_ID || '123456789012'}:${apiId}/*/*/${functionName}`
        }));
        console.log(`[API Gateway] Added Lambda permission for API Gateway`);
      } catch (error) {
        if (error.name !== 'ResourceConflictException') {
          console.warn(`[API Gateway] Warning: Could not add Lambda permission: ${error.message}`);
          console.warn(`[API Gateway] This might cause issues with API Gateway invocation`);
        } else {
          console.log(`[API Gateway] Lambda permission already exists`);
        }
      }

      // Construct the API Gateway URL
      const region = process.env.AWS_REGION || 'us-east-1';
      const apiGatewayUrl = `https://${apiId}.execute-api.${region}.amazonaws.com/prod`;

      console.log(`[API Gateway] API Gateway URL: ${apiGatewayUrl}`);

      return {
        success: true,
        apiGatewayUrl: apiGatewayUrl,
        apiId: apiId,
        stage: 'prod',
        integrationId: integrationResponse.IntegrationId,
        routeId: routeResponse.RouteId,
        functionName: functionName
      };

    } catch (error) {
      console.error('[API Gateway] Error creating API Gateway:', error);
      throw error;
    }
  }
}

export const lambdaDeploymentManager = new LambdaDeploymentManager(); 