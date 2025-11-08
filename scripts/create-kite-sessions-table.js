#!/usr/bin/env node

/**
 * Script to create the kite-sessions DynamoDB table
 * Stores Kite access tokens with 24-hour expiry
 * Run: node create-kite-sessions-table.js
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

const TABLE_NAME = 'kite-sessions';

console.log('🔧 AWS Configuration:');
console.log(`   Region: ${process.env.AWS_REGION || 'us-east-1'}`);
console.log(`   AWS Access Key: ${process.env.AWS_ACCESS_KEY_ID ? '✅ Set' : '❌ Not Set'}`);
console.log(`   AWS Secret Key: ${process.env.AWS_SECRET_ACCESS_KEY ? '✅ Set' : '❌ Not Set'}`);
console.log('');

async function tableExists() {
  try {
    const command = new DescribeTableCommand({ TableName: TABLE_NAME });
    await client.send(command);
    return true;
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      return false;
    }
    throw error;
  }
}

async function createKiteSessionsTable() {
  console.log(`📦 Creating table: ${TABLE_NAME}...`);

  const params = {
    TableName: TABLE_NAME,
    KeySchema: [
      { AttributeName: 'sessionId', KeyType: 'HASH' }, // Partition key
    ],
    AttributeDefinitions: [
      { AttributeName: 'sessionId', AttributeType: 'S' },
      { AttributeName: 'accountId', AttributeType: 'S' },
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'expiresAt', AttributeType: 'N' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'accountId-index',
        KeySchema: [
          { AttributeName: 'accountId', KeyType: 'HASH' },
        ],
        Projection: {
          ProjectionType: 'ALL',
        },
      },
      {
        IndexName: 'userId-index',
        KeySchema: [
          { AttributeName: 'userId', KeyType: 'HASH' },
        ],
        Projection: {
          ProjectionType: 'ALL',
        },
      },
      {
        IndexName: 'expiresAt-index',
        KeySchema: [
          { AttributeName: 'expiresAt', KeyType: 'HASH' },
        ],
        Projection: {
          ProjectionType: 'ALL',
        },
      },
    ],
    BillingMode: 'PAY_PER_REQUEST', // On-demand billing
    // Enable TTL for automatic session cleanup
    TimeToLiveSpecification: {
      Enabled: true,
      AttributeName: 'ttl', // TTL field
    },
    Tags: [
      {
        Key: 'Project',
        Value: 'Kite-App',
      },
      {
        Key: 'Purpose',
        Value: 'Kite Session and Access Token Storage',
      },
      {
        Key: 'Environment',
        Value: process.env.NODE_ENV || 'development',
      },
    ],
  };

  try {
    const command = new CreateTableCommand(params);
    const result = await client.send(command);
    console.log('✅ Table created successfully!');
    console.log(`   Table Name: ${TABLE_NAME}`);
    console.log(`   Table ARN: ${result.TableDescription.TableArn}`);
    console.log(`   Status: ${result.TableDescription.TableStatus}`);
    console.log('\n⏳ Waiting for table to become active...');
    
    // Wait for table to become active
    let tableActive = false;
    while (!tableActive) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const describeCommand = new DescribeTableCommand({ TableName: TABLE_NAME });
      const description = await client.send(describeCommand);
      if (description.Table.TableStatus === 'ACTIVE') {
        tableActive = true;
        console.log('✅ Table is now active and ready to use!');
      }
    }
  } catch (error) {
    console.error('❌ Error creating table:', error.message);
    throw error;
  }
}

async function main() {
  console.log('🔍 Checking if kite-sessions table exists...');
  
  const exists = await tableExists();
  
  if (exists) {
    console.log(`✅ Table "${TABLE_NAME}" already exists. No action needed.`);
    return;
  }
  
  console.log(`❌ Table "${TABLE_NAME}" does not exist.`);
  await createKiteSessionsTable();
  
  console.log('\n🎉 Setup completed successfully!');
  console.log('\n📋 Table Structure:');
  console.log('   Primary Key:');
  console.log('     - Partition Key: sessionId (String) - UUID');
  console.log('   Global Secondary Indexes:');
  console.log('     - accountId-index: Query sessions by account');
  console.log('     - userId-index: Query sessions by user');
  console.log('     - expiresAt-index: Query sessions by expiry');
  console.log('   TTL:');
  console.log('     - Enabled on "ttl" field for automatic cleanup');
  console.log('\n📝 Stored Fields:');
  console.log('   - sessionId: Unique session identifier');
  console.log('   - accountId: Associated account ID');
  console.log('   - userId: Owner user ID');
  console.log('   - accessToken: Kite access token');
  console.log('   - refreshToken: Kite refresh token (if available)');
  console.log('   - requestToken: Kite request token');
  console.log('   - enctoken: Kite encrypted token');
  console.log('   - createdAt: Token creation timestamp');
  console.log('   - expiresAt: Token expiry timestamp (24 hours)');
  console.log('   - ttl: Unix timestamp for DynamoDB TTL (auto-delete)');
  console.log('   - status: active/expired/invalid');
  console.log('   - lastUsed: Last usage timestamp');
  console.log('   - metadata: Additional session info');
}

main().catch((error) => {
  console.error('\n❌ Setup failed:', error);
  process.exit(1);
});

