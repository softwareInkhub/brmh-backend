import { updateIndexingForItem, findActiveIndexingConfigs } from './utils/search-indexing.js';

// Test function to simulate indexing updates
async function testIndexingUpdate() {
  console.log('🧪 Testing indexing update functionality...');
  
  try {
    // Test 1: Find active indexing configurations
    console.log('\n📋 Test 1: Finding active indexing configurations...');
    const activeConfigs = await findActiveIndexingConfigs('shopify-inkhub-get-orders');
    console.log('Active configurations found:', activeConfigs.length);
    console.log('Configurations:', JSON.stringify(activeConfigs, null, 2));
    
    // Test 2: Simulate an INSERT operation
    console.log('\n📝 Test 2: Simulating INSERT operation...');
    const testItem = {
      id: 'test-order-123',
      orderNumber: 'ORD-001',
      customerName: 'John Doe',
      total: 99.99,
      status: 'pending'
    };
    
    await updateIndexingForItem('shopify-inkhub-get-orders', testItem, 'INSERT');
    
    // Test 3: Simulate a MODIFY operation
    console.log('\n🔄 Test 3: Simulating MODIFY operation...');
    const updatedItem = {
      ...testItem,
      status: 'completed',
      total: 89.99
    };
    
    await updateIndexingForItem('shopify-inkhub-get-orders', updatedItem, 'MODIFY', testItem);
    
    // Test 4: Simulate a REMOVE operation
    console.log('\n🗑️ Test 4: Simulating REMOVE operation...');
    await updateIndexingForItem('shopify-inkhub-get-orders', testItem, 'REMOVE');
    
    console.log('\n✅ All indexing update tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testIndexingUpdate();
}

export { testIndexingUpdate }; 