#!/usr/bin/env node

/**
 * Quick test script to verify Lambda deployment with API Gateway trigger
 */

import fetch from 'node-fetch';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:5001';

// Simple test Lambda function
const testCode = `
exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));
    
    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            message: 'Hello from test Lambda!',
            timestamp: new Date().toISOString(),
            event: event
        }),
    };
};
`;

const testDeploy = async () => {
  console.log('🧪 Testing Lambda Deployment with API Gateway Trigger...\n');
  
  const deployPayload = {
    functionName: 'test-lambda-with-trigger',
    code: testCode,
    runtime: 'nodejs18.x',
    handler: 'index.handler',
    memorySize: 128,
    timeout: 30,
    dependencies: {},
    environment: '{}',
    createApiGateway: true  // This should trigger API Gateway creation
  };
  
  console.log('📋 Deployment payload:');
  console.log(JSON.stringify(deployPayload, null, 2));
  console.log('\n');
  
  try {
    console.log(`🚀 Sending deployment request to ${API_BASE_URL}/lambda/deploy...\n`);
    
    const response = await fetch(`${API_BASE_URL}/lambda/deploy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(deployPayload)
    });
    
    console.log(`📊 Response status: ${response.status}\n`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Deployment failed!');
      console.error('Error response:', errorText);
      return;
    }
    
    const result = await response.json();
    
    console.log('✅ Deployment Response:');
    console.log(JSON.stringify(result, null, 2));
    console.log('\n');
    
    // Check if API Gateway was created
    if (result.apiGatewayUrl) {
      console.log('✅ SUCCESS! API Gateway trigger was created!');
      console.log(`🌐 API Gateway URL: ${result.apiGatewayUrl}`);
      console.log(`🆔 API ID: ${result.apiId}`);
      console.log(`🎯 Function ARN: ${result.functionArn}`);
      console.log('\n');
      console.log('🧪 Test your Lambda function:');
      console.log(`curl -X POST ${result.apiGatewayUrl} \\`);
      console.log(`  -H "Content-Type: application/json" \\`);
      console.log(`  -d '{"test": "data"}'`);
    } else if (result.apiGatewayError) {
      console.log('❌ Lambda deployed but API Gateway creation FAILED!');
      console.log(`🔍 Error: ${result.apiGatewayError}`);
      console.log('\n');
      console.log('🔧 Troubleshooting:');
      console.log('1. Check AWS permissions (see below)');
      console.log('2. Verify environment variables');
      console.log('3. Check backend logs for detailed error');
    } else {
      console.log('⚠️ Lambda deployed but createApiGateway was false or failed silently');
      console.log('Check backend logs for more details');
    }
    
    console.log('\n');
    console.log('📋 Full deployment result saved to: test-deployment-result.json');
    
    // Save result to file
    const fs = await import('fs');
    fs.writeFileSync('test-deployment-result.json', JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('❌ Error during deployment test:', error);
    console.error('Stack:', error.stack);
  }
};

console.log('═══════════════════════════════════════════════════════');
console.log('  Lambda Deployment with API Gateway Trigger Test');
console.log('═══════════════════════════════════════════════════════\n');

console.log('📝 Prerequisites:');
console.log('1. Backend server must be running (npm start in brmh-backend)');
console.log('2. AWS credentials must be configured in .env');
console.log('3. AWS permissions must include API Gateway access\n');

console.log('🔑 Required AWS Permissions:');
console.log('- apigateway:POST, GET, PUT, DELETE, PATCH');
console.log('- lambda:AddPermission');
console.log('- lambda:GetFunction\n');

testDeploy().catch(console.error);

