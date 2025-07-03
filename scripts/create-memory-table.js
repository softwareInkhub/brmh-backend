import { DynamoDBClient, CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const TABLE_NAME = 'brmh-conversation-memory';

async function createMemoryTable() {
  try {
    // Check if table already exists
    try {
      await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
      console.log(`Table ${TABLE_NAME} already exists`);
      return;
    } catch (error) {
      if (error.name !== 'ResourceNotFoundException') {
        throw error;
      }
    }

    const params = {
      TableName: TABLE_NAME,
      AttributeDefinitions: [
        {
          AttributeName: 'SessionId',
          AttributeType: 'S'
        },
        {
          AttributeName: 'MessageId',
          AttributeType: 'S'
        },
        {
          AttributeName: 'UserId',
          AttributeType: 'S'
        },
        {
          AttributeName: 'Timestamp',
          AttributeType: 'S'
        }
      ],
      KeySchema: [
        {
          AttributeName: 'SessionId',
          KeyType: 'HASH'
        },
        {
          AttributeName: 'MessageId',
          KeyType: 'RANGE'
        }
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'UserIdTimestampIndex',
          KeySchema: [
            {
              AttributeName: 'UserId',
              KeyType: 'HASH'
            },
            {
              AttributeName: 'Timestamp',
              KeyType: 'RANGE'
            }
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
    };

    console.log('Creating conversation memory table...');
    const result = await client.send(new CreateTableCommand(params));
    console.log('Table created successfully:', result);
    
    // Wait for table to be active
    console.log('Waiting for table to become active...');
    await waitForTableActive();
    console.log('Table is now active and ready to use');
    
  } catch (error) {
    console.error('Error creating table:', error);
    throw error;
  }
}

async function waitForTableActive() {
  const maxAttempts = 30;
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    try {
      const result = await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
      if (result.Table.TableStatus === 'ACTIVE') {
        return;
      }
      console.log(`Table status: ${result.Table.TableStatus}, waiting...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      attempts++;
    } catch (error) {
      console.error('Error checking table status:', error);
      throw error;
    }
  }
  
  throw new Error('Table did not become active within expected time');
}

// Run the setup
createMemoryTable()
  .then(() => {
    console.log('Memory table setup completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Memory table setup failed:', error);
    process.exit(1);
  }); 