import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { CreateTableCommand, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const client = new DynamoDBClient({ 
  region: process.env.AWS_REGION || "us-east-1" 
});

const tableName = "brmh-user-roles";

console.log('🔧 AWS Configuration:');
console.log(`   Region: ${process.env.AWS_REGION || "us-east-1"}`);
console.log(`   AWS Access Key: ${process.env.AWS_ACCESS_KEY_ID ? '✅ Set' : '❌ Not Set'}`);
console.log(`   AWS Secret Key: ${process.env.AWS_SECRET_ACCESS_KEY ? '✅ Set' : '❌ Not Set'}`);
console.log('');

async function createUserRolesTable() {
  try {
    // Check if table already exists
    try {
      const describeCommand = new DescribeTableCommand({ TableName: tableName });
      await client.send(describeCommand);
      console.log(`✅ Table ${tableName} already exists`);
      return;
    } catch (error) {
      if (error.name !== "ResourceNotFoundException") {
        throw error;
      }
      // Table doesn't exist, proceed to create it
    }

    const createTableCommand = new CreateTableCommand({
      TableName: tableName,
      KeySchema: [
        { AttributeName: "userId", KeyType: "HASH" },        // Partition key
        { AttributeName: "namespaceId", KeyType: "RANGE" }   // Sort key
      ],
      AttributeDefinitions: [
        { AttributeName: "userId", AttributeType: "S" },
        { AttributeName: "namespaceId", AttributeType: "S" },
        { AttributeName: "roleId", AttributeType: "S" }
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "RoleIndex",
          KeySchema: [
            { AttributeName: "roleId", KeyType: "HASH" },
            { AttributeName: "namespaceId", KeyType: "RANGE" }
          ],
          Projection: {
            ProjectionType: "ALL"
          },
          ProvisionedThroughput: {
            ReadCapacityUnits: 5,
            WriteCapacityUnits: 5
          }
        }
      ],
      BillingMode: "PROVISIONED",
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      },
      Tags: [
        { Key: "Project", Value: "BRMH" },
        { Key: "Purpose", Value: "User Role Assignments" }
      ]
    });

    console.log(`📦 Creating table: ${tableName}...`);
    const response = await client.send(createTableCommand);
    
    console.log(`✅ Table created successfully!`);
    console.log(`   Table Name: ${tableName}`);
    console.log(`   Table ARN: ${response.TableDescription.TableArn}`);
    console.log(`   Status: ${response.TableDescription.TableStatus}`);
    console.log(`\n⏳ Waiting for table to become active...`);
    
    // Wait for table to become active
    let tableActive = false;
    while (!tableActive) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const describeCommand = new DescribeTableCommand({ TableName: tableName });
      const description = await client.send(describeCommand);
      if (description.Table.TableStatus === "ACTIVE") {
        tableActive = true;
        console.log(`✅ Table is now active and ready to use!`);
      }
    }
    
  } catch (error) {
    console.error(`❌ Error creating table:`, error);
    throw error;
  }
}

// Run the script
createUserRolesTable()
  .then(() => {
    console.log("\n🎉 Setup completed successfully!");
    console.log("\n📋 Table Structure:");
    console.log("   Primary Key:");
    console.log("     - Partition Key: userId");
    console.log("     - Sort Key: namespaceId");
    console.log("   Global Secondary Index:");
    console.log("     - RoleIndex: Query users by roleId and namespaceId");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Setup failed:", error);
    process.exit(1);
  });

