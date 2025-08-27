import { LambdaClient, CreateFunctionCommand, UpdateFunctionCodeCommand, GetFunctionCommand, InvokeCommand, AddPermissionCommand } from '@aws-sdk/client-lambda';
import { IAMClient, CreateRoleCommand, AttachRolePolicyCommand, GetRoleCommand } from '@aws-sdk/client-iam';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { DynamoDBClient, PutItemCommand, GetItemCommand, QueryCommand, ScanCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
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
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const apiGatewayClient = new ApiGatewayV2Client({ region: process.env.AWS_REGION || 'us-east-1' });

// Configuration
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || 'brhm-lambda-deployments';
const DYNAMODB_TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'brhm-lambda-deployment-metadata';

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

  async ensureS3Bucket() {
    try {
      // Check if bucket exists by trying to get its location
      await s3Client.send(new GetObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: 'test'
      }));
    } catch (error) {
      if (error.name === 'NoSuchBucket') {
        console.log(`[S3] Bucket ${S3_BUCKET_NAME} does not exist, creating...`);
        // Note: In a real implementation, you would create the bucket here
        // For now, we'll assume the bucket exists or will be created manually
        console.log(`[S3] Please ensure bucket ${S3_BUCKET_NAME} exists in your AWS account`);
      }
    }
  }

  async uploadToS3(functionName, zipPath, deploymentId) {
    try {
      console.log(`[S3] Uploading deployment package to S3: ${functionName}`);
      
      const fileStream = fs.createReadStream(zipPath);
      const key = `deployments/${deploymentId}/${functionName}.zip`;
      
      await s3Client.send(new PutObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: key,
        Body: fileStream,
        ContentType: 'application/zip',
        Metadata: {
          functionName: functionName,
          deploymentId: deploymentId,
          uploadedAt: new Date().toISOString()
        }
      }));
      
      const s3Url = `s3://${S3_BUCKET_NAME}/${key}`;
      console.log(`[S3] Successfully uploaded to: ${s3Url}`);
      
      return {
        s3Url: s3Url,
        s3Key: key,
        bucket: S3_BUCKET_NAME
      };
    } catch (error) {
      console.error('[S3] Error uploading to S3:', error);
      throw error;
    }
  }

  async storeDeploymentMetadata(deploymentData) {
    try {
      console.log(`[DynamoDB] Storing deployment metadata for: ${deploymentData.functionName}`);
      
      const item = {
        deploymentId: { S: deploymentData.deploymentId },
        functionName: { S: deploymentData.functionName },
        functionArn: { S: deploymentData.functionArn },
        runtime: { S: deploymentData.runtime },
        handler: { S: deploymentData.handler },
        codeSize: { N: deploymentData.codeSize.toString() },
        timeout: { N: deploymentData.timeout.toString() },
        memorySize: { N: deploymentData.memorySize.toString() },
        s3Url: { S: deploymentData.s3Url },
        s3Key: { S: deploymentData.s3Key },
        apiGatewayUrl: { S: deploymentData.apiGatewayUrl || '' },
        apiId: { S: deploymentData.apiId || '' },
        status: { S: deploymentData.status || 'deployed' },
        deployedAt: { S: deploymentData.deployedAt },
        lastModified: { S: deploymentData.lastModified },
        description: { S: deploymentData.description || '' },
        environment: { S: deploymentData.environment || '' },
        dependencies: { S: JSON.stringify(deploymentData.dependencies || {}) }
      };
      
      await dynamoDBClient.send(new PutItemCommand({
        TableName: DYNAMODB_TABLE_NAME,
        Item: item
      }));
      
      console.log(`[DynamoDB] Successfully stored metadata for deployment: ${deploymentData.deploymentId}`);
      return true;
    } catch (error) {
      console.error('[DynamoDB] Error storing deployment metadata:', error);
      throw error;
    }
  }

  async getDeploymentMetadata(deploymentId) {
    try {
      console.log(`[DynamoDB] Retrieving deployment metadata for: ${deploymentId}`);
      
      const response = await dynamoDBClient.send(new GetItemCommand({
        TableName: DYNAMODB_TABLE_NAME,
        Key: {
          deploymentId: { S: deploymentId }
        }
      }));
      
      if (!response.Item) {
        return null;
      }
      
      return {
        deploymentId: response.Item.deploymentId.S,
        functionName: response.Item.functionName.S,
        functionArn: response.Item.functionArn.S,
        runtime: response.Item.runtime.S,
        handler: response.Item.handler.S,
        codeSize: parseInt(response.Item.codeSize.N),
        timeout: parseInt(response.Item.timeout.N),
        memorySize: parseInt(response.Item.memorySize.N),
        s3Url: response.Item.s3Url.S,
        s3Key: response.Item.s3Key.S,
        apiGatewayUrl: response.Item.apiGatewayUrl.S,
        apiId: response.Item.apiId.S,
        status: response.Item.status.S,
        deployedAt: response.Item.deployedAt.S,
        lastModified: response.Item.lastModified.S,
        description: response.Item.description.S,
        environment: response.Item.environment.S,
        dependencies: JSON.parse(response.Item.dependencies.S)
      };
    } catch (error) {
      console.error('[DynamoDB] Error retrieving deployment metadata:', error);
      throw error;
    }
  }

  async listDeployments(functionName = null) {
    try {
      console.log(`[DynamoDB] Listing deployments${functionName ? ` for function: ${functionName}` : ''}`);
      
      let queryParams = {
        TableName: DYNAMODB_TABLE_NAME,
        IndexName: 'functionName-index' // You'll need to create this GSI
      };
      
      if (functionName) {
        queryParams.KeyConditionExpression = 'functionName = :functionName';
        queryParams.ExpressionAttributeValues = {
          ':functionName': { S: functionName }
        };
      }
      
      const response = await dynamoDBClient.send(new QueryCommand(queryParams));
      
      return response.Items.map(item => ({
        deploymentId: item.deploymentId.S,
        functionName: item.functionName.S,
        functionArn: item.functionArn.S,
        runtime: item.runtime.S,
        handler: item.handler.S,
        status: item.status.S,
        deployedAt: item.deployedAt.S,
        apiGatewayUrl: item.apiGatewayUrl.S
      }));
    } catch (error) {
      console.error('[DynamoDB] Error listing deployments:', error);
      throw error;
    }
  }

  async saveFilesToS3(namespaceId, projectName, zipData, fileCount, files) {
    try {
      console.log(`[S3] Saving files to S3 for namespace: ${namespaceId}`);
      console.log(`[S3] Project name: ${projectName}`);
      console.log(`[S3] File count: ${fileCount}`);
      
      // Generate unique ID for this file save
      const saveId = `files-${namespaceId}-${Date.now()}`;
      
      // Remove data URL prefix from base64 data
      const base64Data = zipData.replace(/^data:application\/zip;base64,/, '');
      const zipBuffer = Buffer.from(base64Data, 'base64');
      
      // Create S3 key with organized structure
      const s3Key = `project-files/${namespaceId}/${saveId}/${projectName}.zip`;
      
      console.log(`[S3] Uploading to S3 key: ${s3Key}`);
      
      // Upload to S3
      await s3Client.send(new PutObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: s3Key,
        Body: zipBuffer,
        ContentType: 'application/zip',
        Metadata: {
          namespaceId: namespaceId,
          projectName: projectName,
          saveId: saveId,
          fileCount: fileCount.toString(),
          savedAt: new Date().toISOString()
        }
      }));
      
      const s3Url = `s3://${S3_BUCKET_NAME}/${s3Key}`;
      console.log(`[S3] Successfully uploaded to: ${s3Url}`);
      
      // Store metadata in DynamoDB
      const metadataId = `file-save-${saveId}`;
      const metadata = {
        saveId: saveId,
        namespaceId: namespaceId,
        projectName: projectName,
        s3Url: s3Url,
        s3Key: s3Key,
        fileCount: fileCount,
        files: files,
        savedAt: new Date().toISOString(),
        type: 'project-files'
      };
      
      await this.storeFileSaveMetadata(metadata);
      console.log(`[S3] Metadata stored in DynamoDB: ${metadataId}`);
      
      return {
        success: true,
        saveId: saveId,
        metadataId: metadataId,
        s3Url: s3Url,
        s3Key: s3Key,
        bucket: S3_BUCKET_NAME,
        filesSaved: fileCount,
        projectName: projectName
      };
    } catch (error) {
      console.error('[S3] Error saving files to S3:', error);
      throw error;
    }
  }

  async storeFileSaveMetadata(metadata) {
    try {
      console.log(`[DynamoDB] Storing file save metadata for: ${metadata.saveId}`);
      
      const item = {
        saveId: { S: metadata.saveId },
        namespaceId: { S: metadata.namespaceId },
        projectName: { S: metadata.projectName },
        s3Url: { S: metadata.s3Url },
        s3Key: { S: metadata.s3Key },
        fileCount: { N: metadata.fileCount.toString() },
        files: { S: JSON.stringify(metadata.files) },
        savedAt: { S: metadata.savedAt },
        type: { S: metadata.type }
      };
      
      await dynamoDBClient.send(new PutItemCommand({
        TableName: DYNAMODB_TABLE_NAME,
        Item: item
      }));
      
      console.log(`[DynamoDB] Successfully stored file save metadata: ${metadata.saveId}`);
      return true;
    } catch (error) {
      console.error('[DynamoDB] Error storing file save metadata:', error);
      throw error;
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

  async deployLambdaFunction(functionName, code, runtime = 'nodejs18.x', handler = 'index.handler', memorySize = 128, timeout = 30, dependencies = {}, environment = '', createApiGateway = true) {
    try {
      console.log(`[Lambda Deployment] Deploying function: ${functionName}`);
      console.log(`[Lambda Deployment] Configuration:`, { runtime, handler, memorySize, timeout, environment });
      console.log(`[Lambda Deployment] Dependencies:`, dependencies);
      
      // Generate deployment ID
      const deploymentId = `${functionName}-${Date.now()}`;
      console.log(`[Lambda Deployment] Deployment ID: ${deploymentId}`);
      
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
      
      // Upload to S3
      console.log(`[Lambda Deployment] Uploading deployment package to S3...`);
      const s3Result = await this.uploadToS3(functionName, zipPath, deploymentId);
      
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
        
        const deploymentData = {
          deploymentId: deploymentId,
          functionArn: updateResponse.FunctionArn,
          functionName: functionName,
          runtime: runtime,
          handler: handler,
          codeSize: zipBuffer.length,
          description: `Generated Lambda function: ${functionName}`,
          timeout: timeout,
          memorySize: memorySize,
          lastModified: updateResponse.LastModified,
          deployedAt: new Date().toISOString(),
          s3Url: s3Result.s3Url,
          s3Key: s3Result.s3Key,
          environment: environment,
          dependencies: dependencies,
          status: 'deployed'
        };
        
        // Create API Gateway if requested
        let apiGatewayResult = null;
        if (createApiGateway) {
          try {
            console.log(`[Lambda Deployment] Creating API Gateway for function: ${functionName}`);
            apiGatewayResult = await this.createApiGateway(functionName, updateResponse.FunctionArn, runtime, handler, deploymentId);
            
            // Update deployment data with API Gateway information
            deploymentData.apiGatewayUrl = apiGatewayResult.apiGatewayUrl;
            deploymentData.apiId = apiGatewayResult.apiId;
          } catch (apiError) {
            console.warn(`[Lambda Deployment] API Gateway creation failed: ${apiError.message}`);
            // Continue with deployment even if API Gateway fails
          }
        }
        
        // Store metadata in DynamoDB
        await this.storeDeploymentMetadata(deploymentData);
        
        return {
          success: true,
          deploymentId: deploymentId,
          functionArn: updateResponse.FunctionArn,
          functionName: functionName,
          runtime: runtime,
          handler: handler,
          codeSize: zipBuffer.length,
          description: `Generated Lambda function: ${functionName}`,
          timeout: timeout,
          memorySize: memorySize,
          lastModified: updateResponse.LastModified,
          s3Url: s3Result.s3Url,
          s3Key: s3Result.s3Key,
          apiGatewayUrl: apiGatewayResult?.apiGatewayUrl || null,
          apiId: apiGatewayResult?.apiId || null
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
        
        const deploymentData = {
          deploymentId: deploymentId,
          functionArn: createResponse.FunctionArn,
          functionName: functionName,
          runtime: runtime,
          handler: handler,
          codeSize: zipBuffer.length,
          description: `Generated Lambda function: ${functionName}`,
          timeout: timeout,
          memorySize: memorySize,
          lastModified: createResponse.LastModified,
          deployedAt: new Date().toISOString(),
          s3Url: s3Result.s3Url,
          s3Key: s3Result.s3Key,
          environment: environment,
          dependencies: dependencies,
          status: 'deployed'
        };
        
        // Create API Gateway if requested
        let apiGatewayResult = null;
        if (createApiGateway) {
          try {
            console.log(`[Lambda Deployment] Creating API Gateway for function: ${functionName}`);
            apiGatewayResult = await this.createApiGateway(functionName, createResponse.FunctionArn, runtime, handler, deploymentId);
            
            // Update deployment data with API Gateway information
            deploymentData.apiGatewayUrl = apiGatewayResult.apiGatewayUrl;
            deploymentData.apiId = apiGatewayResult.apiId;
          } catch (apiError) {
            console.warn(`[Lambda Deployment] API Gateway creation failed: ${apiError.message}`);
            // Continue with deployment even if API Gateway fails
          }
        }
        
        // Store metadata in DynamoDB
        await this.storeDeploymentMetadata(deploymentData);
        
        return {
          success: true,
          deploymentId: deploymentId,
          functionArn: createResponse.FunctionArn,
          functionName: functionName,
          runtime: runtime,
          handler: handler,
          codeSize: zipBuffer.length,
          description: `Generated Lambda function: ${functionName}`,
          timeout: timeout,
          memorySize: memorySize,
          lastModified: createResponse.LastModified,
          s3Url: s3Result.s3Url,
          s3Key: s3Result.s3Key,
          apiGatewayUrl: apiGatewayResult?.apiGatewayUrl || null,
          apiId: apiGatewayResult?.apiId || null
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

  async createApiGateway(functionName, functionArn, runtime, handler, deploymentId = null) {
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

      // Update DynamoDB with API Gateway information
      try {
        // Get existing deployment metadata
        const existingMetadata = await this.getDeploymentMetadata(deploymentId);
        if (existingMetadata) {
          const updatedMetadata = {
            ...existingMetadata,
            apiGatewayUrl: apiGatewayUrl,
            apiId: apiId,
            lastModified: new Date().toISOString()
          };
          await this.storeDeploymentMetadata(updatedMetadata);
          console.log(`[API Gateway] Updated DynamoDB with API Gateway information`);
        }
      } catch (error) {
        console.warn(`[API Gateway] Could not update DynamoDB with API Gateway info: ${error.message}`);
      }

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

  async saveLambdaToNamespace(namespaceId, lambdaData) {
    try {
      console.log(`[Lambda Save] Saving Lambda function to namespace: ${namespaceId}`);
      console.log(`[Lambda Save] Function name: ${lambdaData.functionName}`);
      console.log(`[Lambda Save] Lambda ID: ${lambdaData.id}`);
      
      // Store Lambda metadata in DynamoDB
      const metadataId = `lambda-${lambdaData.id}`;
      const metadata = {
        id: metadataId,
        namespaceId: namespaceId,
        lambdaId: lambdaData.id,
        functionName: lambdaData.functionName,
        apiGatewayUrl: lambdaData.apiGatewayUrl || '',
        functionArn: lambdaData.functionArn || '',
        description: lambdaData.description,
        code: lambdaData.code,
        runtime: lambdaData.runtime,
        handler: lambdaData.handler,
        memory: lambdaData.memory,
        timeout: lambdaData.timeout,
        environment: lambdaData.environment,
        savedAt: lambdaData.savedAt,
        type: 'lambda-function',
        status: 'saved'
      };
      
      await this.storeDeploymentMetadata(metadata);
      console.log(`[Lambda Save] Lambda metadata stored in DynamoDB: ${metadataId}`);
      
      return {
        success: true,
        lambdaId: lambdaData.id,
        functionName: lambdaData.functionName,
        metadataId: metadataId,
        savedAt: lambdaData.savedAt,
        message: 'Lambda function saved to namespace library successfully'
      };
      
    } catch (error) {
      console.error('[Lambda Save] Error saving Lambda to namespace:', error);
      throw error;
    }
  }

  async getLambdasForNamespace(namespaceId) {
    try {
      console.log(`[Lambda Fetch] Fetching Lambda functions for namespace: ${namespaceId}`);
      
      // Scan DynamoDB for Lambda functions in this namespace
      const params = {
        TableName: DYNAMODB_TABLE_NAME,
        FilterExpression: 'namespaceId = :namespaceId AND #type = :type',
        ExpressionAttributeNames: {
          '#type': 'type'
        },
        ExpressionAttributeValues: {
          ':namespaceId': { S: namespaceId },
          ':type': { S: 'lambda-function' }
        }
      };
      
      const result = await dynamoDBClient.send(new ScanCommand(params));
      
      const lambdas = result.Items || [];
      console.log(`[Lambda Fetch] Found ${lambdas.length} Lambda functions`);
      
      return {
        success: true,
        lambdas: lambdas.map(lambda => ({
          id: lambda.lambdaId?.S || lambda.id?.S,
          functionName: lambda.functionName?.S,
          apiGatewayUrl: lambda.apiGatewayUrl?.S || '',
          functionArn: lambda.functionArn?.S || '',
          description: lambda.description?.S || '',
          runtime: lambda.runtime?.S || '',
          handler: lambda.handler?.S || '',
          memory: lambda.memory?.N ? parseInt(lambda.memory.N) : 128,
          timeout: lambda.timeout?.N ? parseInt(lambda.timeout.N) : 3,
          environment: lambda.environment?.S || '',
          savedAt: lambda.savedAt?.S || new Date().toISOString(),
          status: lambda.status?.S || 'saved'
        }))
      };
      
    } catch (error) {
      console.error('[Lambda Fetch] Error fetching Lambda functions:', error);
      // Return empty array instead of throwing error
      return {
        success: true,
        lambdas: []
      };
    }
  }
}

export const lambdaDeploymentManager = new LambdaDeploymentManager(); 