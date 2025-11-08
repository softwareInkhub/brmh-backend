import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { CreateTableCommand, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const client = new DynamoDBClient({ 
  region: process.env.AWS_REGION || "us-east-1" 
});

const tableName = "brmh-roles-permissions";

console.log('🔧 AWS Configuration:');
console.log(`   Region: ${process.env.AWS_REGION || "us-east-1"}`);
console.log(`   AWS Access Key: ${process.env.AWS_ACCESS_KEY_ID ? '✅ Set' : '❌ Not Set'}`);
console.log(`   AWS Secret Key: ${process.env.AWS_SECRET_ACCESS_KEY ? '✅ Set' : '❌ Not Set'}`);
console.log('');

async function createRolesPermissionsTable() {
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
        { AttributeName: "namespaceId", KeyType: "HASH" },  // Partition key
        { AttributeName: "roleId", KeyType: "RANGE" }        // Sort key
      ],
      AttributeDefinitions: [
        { AttributeName: "namespaceId", AttributeType: "S" },
        { AttributeName: "roleId", AttributeType: "S" }
      ],
      BillingMode: "PAY_PER_REQUEST", // On-demand billing
      Tags: [
        { Key: "Project", Value: "BRMH" },
        { Key: "Purpose", Value: "Roles and Permissions Management" }
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
createRolesPermissionsTable()
  .then(() => {
    console.log("\n🎉 Setup completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Setup failed:", error);
    process.exit(1);
  });

