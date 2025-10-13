#!/usr/bin/env node

/**
 * Debug script for API Gateway creation issues
 * Run this to test API Gateway creation independently
 */

import { LambdaDeploymentManager } from './lib/lambda-deployment.js';

const debugApiGateway = async () => {
  console.log('🔍 Debugging API Gateway Creation...\n');
  
  const manager = new LambdaDeploymentManager();
  
  // Test parameters (replace with your actual values)
  const testParams = {
    functionName: 'test-function-debug',
    functionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function-debug',
    runtime: 'nodejs18.x',
    handler: 'index.handler',
    deploymentId: 'debug-test-' + Date.now()
  };
  
  console.log('📋 Test Parameters:');
  console.log(JSON.stringify(testParams, null, 2));
  console.log('\n');
  
  // Check environment variables
  console.log('🔧 Environment Variables:');
  console.log(`AWS_REGION: ${process.env.AWS_REGION || 'Not set'}`);
  console.log(`AWS_ACCOUNT_ID: ${process.env.AWS_ACCOUNT_ID || 'Not set'}`);
  console.log(`AWS_ACCESS_KEY_ID: ${process.env.AWS_ACCESS_KEY_ID ? 'Set' : 'Not set'}`);
  console.log(`AWS_SECRET_ACCESS_KEY: ${process.env.AWS_SECRET_ACCESS_KEY ? 'Set' : 'Not set'}`);
  console.log('\n');
  
  try {
    console.log('🚀 Attempting to create API Gateway...\n');
    
    const result = await manager.createApiGateway(
      testParams.functionName,
      testParams.functionArn,
      testParams.runtime,
      testParams.handler,
      testParams.deploymentId
    );
    
    console.log('✅ API Gateway creation successful!');
    console.log('📊 Result:', JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('❌ API Gateway creation failed!');
    console.error('🔍 Error details:');
    console.error('Message:', error.message);
    console.error('Code:', error.code || error.name);
    console.error('Stack:', error.stack);
    
    // Common error analysis
    console.log('\n🔍 Common Issues Analysis:');
    
    if (error.message.includes('credentials')) {
      console.log('❌ AWS Credentials Issue:');
      console.log('   - Check AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
      console.log('   - Verify credentials have API Gateway permissions');
    }
    
    if (error.message.includes('permission') || error.message.includes('AccessDenied')) {
      console.log('❌ Permission Issue:');
      console.log('   - Your AWS user/role needs API Gateway permissions');
      console.log('   - Required permissions: apigateway:*, lambda:AddPermission');
    }
    
    if (error.message.includes('region')) {
      console.log('❌ Region Issue:');
      console.log('   - Check AWS_REGION environment variable');
      console.log('   - Ensure region supports API Gateway');
    }
    
    if (error.message.includes('account')) {
      console.log('❌ Account ID Issue:');
      console.log('   - Check AWS_ACCOUNT_ID environment variable');
      console.log('   - Or ensure STS GetCallerIdentity works');
    }
    
    if (error.message.includes('throttl') || error.message.includes('TooManyRequests')) {
      console.log('❌ Rate Limiting Issue:');
      console.log('   - AWS API Gateway has rate limits');
      console.log('   - Wait a few minutes and try again');
    }
  }
};

// Run the debug
debugApiGateway().catch(console.error);
