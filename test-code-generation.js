import { generateBackendCode } from './lib/code-generator.js';

// Test data
const testNamespaceId = 'test-namespace-' + Date.now();
const testSchemas = [
  {
    name: 'User',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      email: { type: 'string' },
      age: { type: 'number' }
    }
  }
];

const testApis = [
  {
    name: 'UserAPI',
    endpoints: [
      {
        method: 'GET',
        path: '/users',
        description: 'Get all users'
      },
      {
        method: 'POST',
        path: '/users',
        description: 'Create a new user'
      }
    ]
  }
];

async function testCodeGeneration() {
  console.log('🧪 Testing code generation...');
  console.log('Namespace ID:', testNamespaceId);
  console.log('Schemas:', testSchemas.length);
  console.log('APIs:', testApis.length);
  
  try {
    const result = await generateBackendCode(testNamespaceId, testSchemas, testApis);
    console.log('✅ Code generation result:', result);
    
    if (result.success) {
      console.log('📁 Generated files:');
      result.files.forEach(file => {
        console.log(`  - ${file.type}: ${file.path}`);
      });
    }
  } catch (error) {
    console.error('❌ Code generation failed:', error);
  }
}

testCodeGeneration(); 