#!/usr/bin/env node

/**
 * Script to create the brmh-notification-configs DynamoDB table
 * Run: node create-notification-configs-table.js
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

const TABLE_NAME = 'brmh-notification-configs';

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

async function createNotificationConfigsTable() {
  console.log(`📦 Creating table: ${TABLE_NAME}...`);

  const params = {
    TableName: TABLE_NAME,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' }, // Partition key
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'type', AttributeType: 'S' }, // config, trigger, template, connection
      { AttributeName: 'eventType', AttributeType: 'S' }, // task_created, project_updated, etc.
      { AttributeName: 'entityType', AttributeType: 'S' }, // task, project, team
      { AttributeName: 'active', AttributeType: 'S' }, // active, inactive
      { AttributeName: 'createdAt', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'type-index',
        KeySchema: [
          { AttributeName: 'type', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' },
        ],
        Projection: {
          ProjectionType: 'ALL',
        },
      },
      {
        IndexName: 'eventType-index',
        KeySchema: [
          { AttributeName: 'eventType', KeyType: 'HASH' },
          { AttributeName: 'active', KeyType: 'RANGE' },
        ],
        Projection: {
          ProjectionType: 'ALL',
        },
      },
      {
        IndexName: 'entityType-index',
        KeySchema: [
          { AttributeName: 'entityType', KeyType: 'HASH' },
          { AttributeName: 'active', KeyType: 'RANGE' },
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
        Value: 'Notification Configurations Management',
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
  console.log('🔍 Checking if notification configs table exists...');
  
  const exists = await tableExists();
  
  if (exists) {
    console.log(`✅ Table "${TABLE_NAME}" already exists. No action needed.`);
    return;
  }
  
  console.log(`❌ Table "${TABLE_NAME}" does not exist.`);
  await createNotificationConfigsTable();
  
  console.log('\n🎉 Setup completed successfully!');
  console.log('\n📋 Table Structure:');
  console.log('   Primary Key:');
  console.log('     - Partition Key: id (String)');
  console.log('   Global Secondary Indexes:');
  console.log('     - type-index: Query by type (config/trigger/template/connection) and createdAt');
  console.log('     - eventType-index: Query by eventType (task_created, project_updated, etc.) and active status');
  console.log('     - entityType-index: Query by entityType (task/project/team) and active status');
  console.log('\n💾 Data Schema Examples:');
  console.log('\n   📱 Connection:');
  console.log('     {');
  console.log('       id: "conn-123",');
  console.log('       type: "connection",');
  console.log('       name: "Production WHAPI",');
  console.log('       baseUrl: "https://gate.whapi.cloud",');
  console.log('       token: "encrypted_token",');
  console.log('       testMode: true,');
  console.log('       active: "active",');
  console.log('       createdAt: "2024-01-01T00:00:00Z"');
  console.log('     }');
  console.log('\n   ⚡ Trigger:');
  console.log('     {');
  console.log('       id: "trigger-123",');
  console.log('       type: "trigger",');
  console.log('       name: "Task Assignment Alert",');
  console.log('       eventType: "task_created",');
  console.log('       entityType: "task",');
  console.log('       connectionId: "conn-123",');
  console.log('       action: { type: "whapi_message", to: "+911234567890", textTemplate: "..." },');
  console.log('       active: "active",');
  console.log('       createdAt: "2024-01-01T00:00:00Z"');
  console.log('     }');
  console.log('\n   🎯 Configuration:');
  console.log('     {');
  console.log('       id: "config-123",');
  console.log('       type: "config",');
  console.log('       name: "Task Assignment Notifications",');
  console.log('       eventType: "task_created",');
  console.log('       entityType: "task",');
  console.log('       recipients: { type: "user", ids: ["user-1", "user-2"] },');
  console.log('       messageTemplate: "New task: {{task.title}}",');
  console.log('       active: "active",');
  console.log('       createdAt: "2024-01-01T00:00:00Z"');
  console.log('     }');
  console.log('\n   📝 Template:');
  console.log('     {');
  console.log('       id: "template-123",');
  console.log('       type: "template",');
  console.log('       name: "Task Assignment",');
  console.log('       category: "task",');
  console.log('       eventType: "task_created",');
  console.log('       template: "🎯 New task: {{task.title}}",');
  console.log('       variables: ["task.title", "task.assignee"],');
  console.log('       active: "active",');
  console.log('       createdAt: "2024-01-01T00:00:00Z"');
  console.log('     }');
  console.log('\n💡 Usage:');
  console.log('   - Frontend will automatically use this table for notification configurations');
  console.log('   - Supports WHAPI connections, triggers, event configs, and message templates');
  console.log('   - Efficient querying by type, event, entity, and active status');
}

main().catch((error) => {
  console.error('\n❌ Setup failed:', error);
  process.exit(1);
});
