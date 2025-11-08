#!/usr/bin/env node

/**
 * Script to populate the brmh-notification-configs DynamoDB table with sample data
 * Run: node populate-notification-configs.js
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = 'brmh-notification-configs';

console.log('🔧 AWS Configuration:');
console.log(`   Region: ${process.env.AWS_REGION || 'us-east-1'}`);
console.log(`   AWS Access Key: ${process.env.AWS_ACCESS_KEY_ID ? '✅ Set' : '❌ Not Set'}`);
console.log(`   AWS Secret Key: ${process.env.AWS_SECRET_ACCESS_KEY ? '✅ Set' : '❌ Not Set'}`);
console.log('');

const sampleData = [
  // Sample Connection
  {
    id: 'conn-default',
    type: 'connection',
    name: 'Default WHAPI Connection',
    baseUrl: 'https://gate.whapi.cloud',
    token: 'sample_token_here',
    testMode: true,
    active: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  
  // Sample Templates
  {
    id: 'template-task-created',
    type: 'template',
    name: 'Task Assignment',
    category: 'task',
    eventType: 'task_created',
    template: '🎯 New task assigned to you!\n\n📋 **{{task.title}}**\n👤 Project: {{project.name}}\n📅 Due: {{task.dueDate}}\n⭐ Priority: {{task.priority}}\n\nGood luck! 🚀',
    variables: ['task.title', 'task.assignee', 'task.dueDate', 'task.priority', 'project.name'],
    active: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'template-task-updated',
    type: 'template',
    name: 'Task Update',
    category: 'task',
    eventType: 'task_updated',
    template: '📝 Task updated!\n\n📋 **{{task.title}}**\n🔄 Status: {{task.status}}\n👤 Assigned to: {{task.assignee}}\n📅 Due: {{task.dueDate}}\n\nProject: {{project.name}}',
    variables: ['task.title', 'task.status', 'task.assignee', 'task.dueDate', 'project.name'],
    active: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'template-project-created',
    type: 'template',
    name: 'Project Launch',
    category: 'project',
    eventType: 'project_created',
    template: '🚀 New project launched!\n\n📁 **{{project.name}}**\n📝 {{project.description}}\n👥 Team: {{team.name}}\n📅 Start: {{project.startDate}}\n\nLet\'s make it amazing! 💪',
    variables: ['project.name', 'project.description', 'team.name', 'project.startDate'],
    active: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  
  // Sample Triggers
  {
    id: 'trigger-task-alerts',
    type: 'trigger',
    name: 'Task Assignment Alert',
    eventType: 'task_created',
    entityType: 'task',
    connectionId: 'conn-default',
    action: {
      type: 'whapi_message',
      to: '+911234567890',
      textTemplate: '🎯 New task assigned!\n\n📋 **{{task.title}}**\n👤 Project: {{project.name}}\n📅 Due: {{task.dueDate}}\n⭐ Priority: {{task.priority}}'
    },
    active: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'trigger-project-updates',
    type: 'trigger',
    name: 'Project Update Notifications',
    eventType: 'project_updated',
    entityType: 'project',
    connectionId: 'conn-default',
    action: {
      type: 'whapi_message',
      to: '+911234567890',
      textTemplate: '📁 Project updated!\n\n**{{project.name}}**\n📝 {{project.description}}\n👥 Team: {{team.name}}'
    },
    active: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  
  // Sample Configurations
  {
    id: 'config-task-assignments',
    type: 'config',
    name: 'Task Assignment Notifications',
    eventType: 'task_created',
    entityType: 'task',
    recipients: {
      type: 'user',
      ids: ['user-1', 'user-2']
    },
    messageTemplate: '🎯 New task assigned to you!\n\n📋 **{{task.title}}**\n👤 Project: {{project.name}}\n📅 Due: {{task.dueDate}}\n⭐ Priority: {{task.priority}}',
    active: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'config-project-updates',
    type: 'config',
    name: 'Project Updates',
    eventType: 'project_updated',
    entityType: 'project',
    recipients: {
      type: 'team',
      ids: ['team-1']
    },
    messageTemplate: '📁 Project updated!\n\n**{{project.name}}**\n📝 {{project.description}}\n👥 Team: {{team.name}}',
    active: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

async function populateTable() {
  console.log(`📦 Populating table: ${TABLE_NAME} with sample data...`);
  
  try {
    // Process items in batches of 25 (DynamoDB limit)
    const batches = [];
    for (let i = 0; i < sampleData.length; i += 25) {
      batches.push(sampleData.slice(i, i + 25));
    }
    
    for (const batch of batches) {
      const putRequests = batch.map(item => ({
        PutRequest: {
          Item: item
        }
      }));
      
      const command = new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: putRequests
        }
      });
      
      await docClient.send(command);
      console.log(`✅ Inserted ${batch.length} items`);
    }
    
    console.log(`\n🎉 Successfully populated table with ${sampleData.length} sample items!`);
    
  } catch (error) {
    console.error('❌ Error populating table:', error.message);
    throw error;
  }
}

async function main() {
  console.log('🚀 Starting notification configs table population...');
  
  await populateTable();
  
  console.log('\n📊 Sample Data Summary:');
  console.log('   📱 Connections: 1');
  console.log('   📝 Templates: 3');
  console.log('   ⚡ Triggers: 2');
  console.log('   🎯 Configurations: 2');
  console.log('   📈 Total Items: 8');
  
  console.log('\n💡 Next Steps:');
  console.log('   1. Update your frontend to use this table');
  console.log('   2. Modify the API service to read from brmh-notification-configs');
  console.log('   3. Test the notification system with sample data');
  console.log('   4. Add more connections, triggers, and configurations as needed');
}

main().catch((error) => {
  console.error('\n❌ Population failed:', error);
  process.exit(1);
});
