import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import dotenv from 'dotenv';

dotenv.config();

const isLocal = process.env.NODE_ENV === 'development' || !process.env.AWS_REGION;

const config = {
  region: process.env.AWS_REGION || "us-east-1",
  ...(isLocal ? {
    endpoint: "http://localhost:8000",
    credentials: {
      accessKeyId: "local",
      secretAccessKey: "local"
    }
  } : {
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  })
};

console.log('[DynamoDB] Using configuration:', {
  region: config.region,
  endpoint: config.endpoint,
  isLocal
});

// Create the DynamoDB client instance
const client = new DynamoDBClient(config);

// Create the DynamoDB Document client with custom marshalling options
const marshallOptions = {
  convertEmptyValues: false,
  removeUndefinedValues: true,
  convertClassInstanceToMap: false
};

const unmarshallOptions = {
  wrapNumbers: false
};

const translateConfig = { marshallOptions, unmarshallOptions };

// Create Document Client
const docClient = DynamoDBDocumentClient.from(client, translateConfig);

export { client, docClient }; 