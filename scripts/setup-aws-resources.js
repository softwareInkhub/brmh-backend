import { S3Client, CreateBucketCommand, PutBucketVersioningCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, CreateTableCommand, UpdateTableCommand } from '@aws-sdk/client-dynamodb';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamoDBClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });

const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || 'brhm-lambda-deployments';
const DYNAMODB_TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'brhm-lambda-deployment-metadata';

async function setupS3Bucket() {
  try {
    console.log(`[Setup] Creating S3 bucket: ${S3_BUCKET_NAME}`);
    
    await s3Client.send(new CreateBucketCommand({
      Bucket: S3_BUCKET_NAME,
      CreateBucketConfiguration: {
        LocationConstraint: process.env.AWS_REGION === 'us-east-1' ? undefined : process.env.AWS_REGION
      }
    }));
    
    // Enable versioning
    await s3Client.send(new PutBucketVersioningCommand({
      Bucket: S3_BUCKET_NAME,
      VersioningConfiguration: {
        Status: 'Enabled'
      }
    }));
    
    console.log(`[Setup] ✅ S3 bucket created successfully: ${S3_BUCKET_NAME}`);
  } catch (error) {
    if (error.name === 'BucketAlreadyExists') {
      console.log(`[Setup] ℹ️ S3 bucket already exists: ${S3_BUCKET_NAME}`);
    } else {
      console.error(`[Setup] ❌ Error creating S3 bucket:`, error);
      throw error;
    }
  }
}

async function setupDynamoDBTable() {
  try {
    console.log(`[Setup] Creating DynamoDB table: ${DYNAMODB_TABLE_NAME}`);
    
    await dynamoDBClient.send(new CreateTableCommand({
      TableName: DYNAMODB_TABLE_NAME,
      KeySchema: [
        { AttributeName: 'deploymentId', KeyType: 'HASH' }
      ],
      AttributeDefinitions: [
        { AttributeName: 'deploymentId', AttributeType: 'S' },
        { AttributeName: 'functionName', AttributeType: 'S' }
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'functionName-index',
          KeySchema: [
            { AttributeName: 'functionName', KeyType: 'HASH' }
          ],
          Projection: {
            ProjectionType: 'ALL'
          },
          ProvisionedThroughput: {
            ReadCapacityUnits: 5,
            WriteCapacityUnits: 5
          }
        }
      ],
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      }
    }));
    
    console.log(`[Setup] ✅ DynamoDB table created successfully: ${DYNAMODB_TABLE_NAME}`);
  } catch (error) {
    if (error.name === 'ResourceInUseException') {
      console.log(`[Setup] ℹ️ DynamoDB table already exists: ${DYNAMODB_TABLE_NAME}`);
    } else {
      console.error(`[Setup] ❌ Error creating DynamoDB table:`, error);
      throw error;
    }
  }
}

async function main() {
  console.log('[Setup] Starting AWS resource setup...');
  console.log(`[Setup] AWS Region: ${process.env.AWS_REGION || 'us-east-1'}`);
  console.log(`[Setup] S3 Bucket: ${S3_BUCKET_NAME}`);
  console.log(`[Setup] DynamoDB Table: ${DYNAMODB_TABLE_NAME}`);
  
  try {
    await setupS3Bucket();
    await setupDynamoDBTable();
    
    console.log('[Setup] ✅ All AWS resources setup completed successfully!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Deploy Lambda functions using the AI Agent Workspace');
    console.log('2. Check S3 bucket for deployment packages');
    console.log('3. Check DynamoDB table for deployment metadata');
  } catch (error) {
    console.error('[Setup] ❌ Setup failed:', error);
    process.exit(1);
  }
}

main();

