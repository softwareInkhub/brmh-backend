#!/usr/bin/env node

/**
 * Test script for BRMH Drive Move Operations
 * 
 * This script tests the new move functionality:
 * - Move files between folders
 * - Move folders between parent folders
 */

const BASE_URL = 'http://localhost:5001';
const TEST_USER_ID = 'test-user-move';

async function makeRequest(method, endpoint, data = null) {
  const url = `${BASE_URL}${endpoint}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json'
    }
  };
  
  if (data) {
    options.body = JSON.stringify(data);
  }
  
  try {
    const response = await fetch(url, options);
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${result.error || 'Unknown error'}`);
    }
    
    return result;
  } catch (error) {
    console.error(`❌ Request failed: ${error.message}`);
    throw error;
  }
}

async function testMoveOperations() {
  console.log('🚀 Testing BRMH Drive Move Operations\n');
  
  try {
    // Step 1: Create test folders
    console.log('📁 Step 1: Creating test folders...');
    
    const folder1 = await makeRequest('POST', '/drive/folder', {
      userId: TEST_USER_ID,
      folderData: { name: 'Test Folder 1', description: 'First test folder' }
    });
    console.log(`✅ Created folder 1: ${folder1.folderId}`);
    
    const folder2 = await makeRequest('POST', '/drive/folder', {
      userId: TEST_USER_ID,
      folderData: { name: 'Test Folder 2', description: 'Second test folder' }
    });
    console.log(`✅ Created folder 2: ${folder2.folderId}`);
    
    // Step 2: Create a test file
    console.log('\n📄 Step 2: Creating test file...');
    
    const testFile = await makeRequest('POST', '/drive/upload', {
      userId: TEST_USER_ID,
      fileData: {
        name: 'test-move-file.txt',
        mimeType: 'text/plain',
        size: 12,
        content: Buffer.from('Hello World!').toString('base64')
      },
      parentId: 'ROOT'
    });
    console.log(`✅ Created test file: ${testFile.fileId}`);
    
    // Step 3: Test moving file to folder 1
    console.log('\n🔄 Step 3: Moving file to folder 1...');
    
    const moveFileResult = await makeRequest('PATCH', `/drive/move/file/${TEST_USER_ID}/${testFile.fileId}`, {
      newParentId: folder1.folderId
    });
    console.log(`✅ File moved successfully:`);
    console.log(`   Old path: ${moveFileResult.oldPath}`);
    console.log(`   New path: ${moveFileResult.newPath}`);
    
    // Step 4: Test moving file to folder 2
    console.log('\n🔄 Step 4: Moving file to folder 2...');
    
    const moveFileResult2 = await makeRequest('PATCH', `/drive/move/file/${TEST_USER_ID}/${testFile.fileId}`, {
      newParentId: folder2.folderId
    });
    console.log(`✅ File moved successfully:`);
    console.log(`   Old path: ${moveFileResult2.oldPath}`);
    console.log(`   New path: ${moveFileResult2.newPath}`);
    
    // Step 5: Test moving file back to root
    console.log('\n🔄 Step 5: Moving file back to root...');
    
    const moveFileResult3 = await makeRequest('PATCH', `/drive/move/file/${TEST_USER_ID}/${testFile.fileId}`, {
      newParentId: 'ROOT'
    });
    console.log(`✅ File moved successfully:`);
    console.log(`   Old path: ${moveFileResult3.oldPath}`);
    console.log(`   New path: ${moveFileResult3.newPath}`);
    
    // Step 6: Test moving folder 1 into folder 2
    console.log('\n🔄 Step 6: Moving folder 1 into folder 2...');
    
    const moveFolderResult = await makeRequest('PATCH', `/drive/move/folder/${TEST_USER_ID}/${folder1.folderId}`, {
      newParentId: folder2.folderId
    });
    console.log(`✅ Folder moved successfully:`);
    console.log(`   Old path: ${moveFolderResult.oldPath}`);
    console.log(`   New path: ${moveFolderResult.newPath}`);
    
    // Step 7: Test moving folder back to root
    console.log('\n🔄 Step 7: Moving folder back to root...');
    
    const moveFolderResult2 = await makeRequest('PATCH', `/drive/move/folder/${TEST_USER_ID}/${folder1.folderId}`, {
      newParentId: 'ROOT'
    });
    console.log(`✅ Folder moved successfully:`);
    console.log(`   Old path: ${moveFolderResult2.oldPath}`);
    console.log(`   New path: ${moveFolderResult2.newPath}`);
    
    // Step 8: Test error handling - try to move folder into itself
    console.log('\n❌ Step 8: Testing error handling (move folder into itself)...');
    
    try {
      await makeRequest('PATCH', `/drive/move/folder/${TEST_USER_ID}/${folder1.folderId}`, {
        newParentId: folder1.folderId
      });
      console.log('❌ Error: Should have failed but didn\'t');
    } catch (error) {
      console.log(`✅ Correctly caught error: ${error.message}`);
    }
    
    // Step 9: Cleanup
    console.log('\n🧹 Step 9: Cleaning up test data...');
    
    await makeRequest('DELETE', `/drive/file/${TEST_USER_ID}/${testFile.fileId}`);
    console.log('✅ Deleted test file');
    
    await makeRequest('DELETE', `/drive/folder/${TEST_USER_ID}/${folder1.folderId}`);
    console.log('✅ Deleted test folder 1');
    
    await makeRequest('DELETE', `/drive/folder/${TEST_USER_ID}/${folder2.folderId}`);
    console.log('✅ Deleted test folder 2');
    
    console.log('\n🎉 All move operation tests completed successfully!');
    console.log('\n✅ Move operations implemented and working:');
    console.log('   - Move files between folders');
    console.log('   - Move folders between parent folders');
    console.log('   - Move items to/from root level');
    console.log('   - Error handling for invalid moves');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the tests
testMoveOperations().catch(console.error);

export { testMoveOperations };
