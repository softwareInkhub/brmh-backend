import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new DynamoDBClient({ 
  region: process.env.AWS_REGION || 'us-east-1' 
});

const TABLE_NAME = 'brmh-user-resources';

async function createUserResourcesTable() {
  try {
    console.log(`🔍 Checking if table ${TABLE_NAME} exists...`);
    
    // Check if table already exists
    try {
      const describeCommand = new DescribeTableCommand({ TableName: TABLE_NAME });
      await client.send(describeCommand);
      console.log(`✅ Table ${TABLE_NAME} already exists!`);
      return;
    } catch (error) {
      if (error.name !== 'ResourceNotFoundException') {
        throw error;
      }
      console.log(`📝 Table ${TABLE_NAME} does not exist. Creating...`);
    }

    // Create the table
    const createCommand = new CreateTableCommand({
      TableName: TABLE_NAME,
      KeySchema: [
        { AttributeName: 'userId', KeyType: 'HASH' },      // Partition key
        { AttributeName: 'resourceId', KeyType: 'RANGE' }   // Sort key
      ],
      AttributeDefinitions: [
        { AttributeName: 'userId', AttributeType: 'S' },
        { AttributeName: 'resourceId', AttributeType: 'S' },
        { AttributeName: 'resourceType', AttributeType: 'S' },
        { AttributeName: 'grantedBy', AttributeType: 'S' }
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'ResourceTypeIndex',
          KeySchema: [
            { AttributeName: 'userId', KeyType: 'HASH' },
            { AttributeName: 'resourceType', KeyType: 'RANGE' }
          ],
          Projection: { ProjectionType: 'ALL' },
          ProvisionedThroughput: {
            ReadCapacityUnits: 5,
            WriteCapacityUnits: 5
          }
        },
        {
          IndexName: 'GrantedByIndex',
          KeySchema: [
            { AttributeName: 'grantedBy', KeyType: 'HASH' },
            { AttributeName: 'resourceId', KeyType: 'RANGE' }
          ],
          Projection: { ProjectionType: 'ALL' },
          ProvisionedThroughput: {
            ReadCapacityUnits: 5,
            WriteCapacityUnits: 5
          }
        }
      ],
      BillingMode: 'PROVISIONED',
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      },
      Tags: [
        { Key: 'Project', Value: 'BRMH' },
        { Key: 'Environment', Value: process.env.NODE_ENV || 'development' },
        { Key: 'Purpose', Value: 'User Resource Access Control' }
      ]
    });

    await client.send(createCommand);

    console.log(`✅ Table ${TABLE_NAME} created successfully!`);
    console.log(`
📊 Table Structure:
   - Primary Key: userId (HASH) + resourceId (RANGE)
   - GSI 1: ResourceTypeIndex (userId + resourceType)
   - GSI 2: GrantedByIndex (grantedBy + resourceId)
   
🎯 Resource Types Supported:
   - namespace: Access to entire namespace
   - schema: Access to specific schema/table
   - drive-folder: Access to drive folder
   - drive-file: Access to drive file
   
🔐 Permission Types:
   - read: View/read access
   - write: Create/update access
   - delete: Delete access
   - admin: Full administrative access
   - execute: Execute operations (for schemas/APIs)
   
💡 Usage Examples:
   1. Grant namespace access:
      userId: "user-123"
      resourceId: "namespace#ns-456"
      resourceType: "namespace"
      permissions: ["read", "write"]
      
   2. Grant schema access:
      userId: "user-123"
      resourceId: "schema#schema-789"
      resourceType: "schema"
      permissions: ["read", "execute"]
      
   3. Grant drive folder access:
      userId: "user-123"
      resourceId: "drive-folder#FOLDER_abc123"
      resourceType: "drive-folder"
      permissions: ["read", "write", "delete"]
    `);

  } catch (error) {
    console.error('❌ Error creating table:', error);
    throw error;
  }
}

// Run the script
createUserResourcesTable()
  .then(() => {
    console.log('✅ Script completed successfully!');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });

