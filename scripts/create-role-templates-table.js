#!/usr/bin/env node

/**
 * Script to create the brmh-role-templates DynamoDB table
 * Run: node scripts/create-role-templates-table.js
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

const TABLE_NAME = 'brmh-role-templates';

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

async function createRoleTemplatesTable() {
  console.log(`📦 Creating table: ${TABLE_NAME}...`);

  const params = {
    TableName: TABLE_NAME,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' }, // Partition key
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'namespace', AttributeType: 'S' },
      { AttributeName: 'name', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'namespace-index',
        KeySchema: [
          { AttributeName: 'namespace', KeyType: 'HASH' },
        ],
        Projection: {
          ProjectionType: 'ALL',
        },
      },
      {
        IndexName: 'name-index',
        KeySchema: [
          { AttributeName: 'name', KeyType: 'HASH' },
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
        Value: 'BRMH',
      },
      {
        Key: 'Purpose',
        Value: 'Role Templates Management',
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
  console.log('🔍 Checking if role templates table exists...');
  
  const exists = await tableExists();
  
  if (exists) {
    console.log(`✅ Table "${TABLE_NAME}" already exists. No action needed.`);
    return;
  }
  
  console.log(`❌ Table "${TABLE_NAME}" does not exist.`);
  await createRoleTemplatesTable();
  
  console.log('\n🎉 Setup completed successfully!');
  console.log('\n📋 Table Structure:');
  console.log('   Primary Key:');
  console.log('     - Partition Key: id (String)');
  console.log('   Global Secondary Indexes:');
  console.log('     - namespace-index: Query templates by namespace');
  console.log('     - name-index: Query templates by name');
  console.log('\n💡 Usage:');
  console.log('   - Frontend will automatically use this table for role templates');
  console.log('   - Templates are stored with id, name, namespace, role, permissions, tags, createdAt, createdBy');
}

main().catch((error) => {
  console.error('\n❌ Setup failed:', error);
  process.exit(1);
});
