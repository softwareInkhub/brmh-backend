#!/usr/bin/env node

/**
 * Script to create the kite-accounts DynamoDB table
 * Stores Kite account credentials, client_id, phone, passwords
 * Run: node create-kite-accounts-table.js
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

const TABLE_NAME = 'kite-accounts';

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

async function createKiteAccountsTable() {
  console.log(`📦 Creating table: ${TABLE_NAME}...`);

  const params = {
    TableName: TABLE_NAME,
    KeySchema: [
      { AttributeName: 'accountId', KeyType: 'HASH' }, // Partition key
    ],
    AttributeDefinitions: [
      { AttributeName: 'accountId', AttributeType: 'S' },
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'clientId', AttributeType: 'S' },
      { AttributeName: 'phoneNumber', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
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
        IndexName: 'clientId-index',
        KeySchema: [
          { AttributeName: 'clientId', KeyType: 'HASH' },
        ],
        Projection: {
          ProjectionType: 'ALL',
        },
      },
      {
        IndexName: 'phoneNumber-index',
        KeySchema: [
          { AttributeName: 'phoneNumber', KeyType: 'HASH' },
        ],
        Projection: {
          ProjectionType: 'ALL',
        },
      },
    ],
    BillingMode: 'PAY_PER_REQUEST', // On-demand billing
    Tags: [
      {
        Key: 'Project',
        Value: 'Kite-App',
      },
      {
        Key: 'Purpose',
        Value: 'Kite Account Credentials Storage',
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
  console.log('🔍 Checking if kite-accounts table exists...');
  
  const exists = await tableExists();
  
  if (exists) {
    console.log(`✅ Table "${TABLE_NAME}" already exists. No action needed.`);
    return;
  }
  
  console.log(`❌ Table "${TABLE_NAME}" does not exist.`);
  await createKiteAccountsTable();
  
  console.log('\n🎉 Setup completed successfully!');
  console.log('\n📋 Table Structure:');
  console.log('   Primary Key:');
  console.log('     - Partition Key: accountId (String) - UUID');
  console.log('   Global Secondary Indexes:');
  console.log('     - userId-index: Query accounts by user');
  console.log('     - clientId-index: Query accounts by client ID');
  console.log('     - phoneNumber-index: Query accounts by phone');
  console.log('\n📝 Stored Fields:');
  console.log('   - accountId: Unique account identifier');
  console.log('   - userId: Owner user ID');
  console.log('   - clientId: Kite client ID / username');
  console.log('   - phoneNumber: Phone number');
  console.log('   - password: Encrypted password');
  console.log('   - apiKey: Kite API key');
  console.log('   - apiSecret: Kite API secret');
  console.log('   - accountName: Display name for the account');
  console.log('   - accountType: Type of account (live/sandbox)');
  console.log('   - status: active/inactive');
  console.log('   - createdAt: Timestamp');
  console.log('   - updatedAt: Timestamp');
  console.log('   - metadata: Additional account info');
}

main().catch((error) => {
  console.error('\n❌ Setup failed:', error);
  process.exit(1);
});

