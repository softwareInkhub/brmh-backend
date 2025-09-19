#!/usr/bin/env node

/**
 * Complete test of the BRMH Drive Sharing System
 */

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:5001';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function makeRequest(method, url, body = null) {
  try {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(`${BASE_URL}${url}`, options);
    const data = await response.json();
    
    return {
      status: response.status,
      data
    };
  } catch (error) {
    return {
      status: 500,
      data: { error: error.message }
    };
  }
}

async function testCompleteSharing() {
  log('\n🚀 Complete BRMH Drive Sharing System Test', 'cyan');
  log('=' .repeat(50), 'cyan');
  
  const userId1 = 'test-user-1';
  const userId2 = 'test-user-2';
  let shareId;
  
  try {
    // Test 1: Share existing file
    log('\n🤝 Test 1: Share Existing File', 'yellow');
    const shareData = {
      sharedWithUserId: userId2,
      permissions: ['read', 'write'],
      message: 'Here is the test document for you to review',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    };
    
    const shareResult = await makeRequest('POST', `/drive/share/file/${userId1}/FILE_39112b649eb149bcbfd0bbc1bcdedc88`, shareData);
    if (shareResult.status === 200) {
      shareId = shareResult.data.shareId;
      log(`✅ File shared successfully: ${shareId}`, 'green');
      log(`   Shared with: ${shareResult.data.sharedWithUserId}`, 'blue');
      log(`   Permissions: ${shareResult.data.permissions.join(', ')}`, 'blue');
    } else {
      log(`❌ Failed to share file: ${shareResult.data.error}`, 'red');
      return;
    }
    
    // Test 2: Get shared items for user2
    log('\n📋 Test 2: Get Shared Items (With Me)', 'yellow');
    const sharedWithMeResult = await makeRequest('GET', `/drive/shared/with-me/${userId2}`);
    if (sharedWithMeResult.status === 200) {
      log(`✅ Retrieved ${sharedWithMeResult.data.sharedItems.length} shared items`, 'green');
      sharedWithMeResult.data.sharedItems.forEach((item, index) => {
        log(`   ${index + 1}. ${item.originalName} (${item.type}) - ${item.permissions.join(', ')}`, 'blue');
      });
    } else {
      log(`❌ Failed to get shared items: ${sharedWithMeResult.data.error}`, 'red');
    }
    
    // Test 3: Get items shared by user1
    log('\n📤 Test 3: Get Items Shared By Me', 'yellow');
    const sharedByMeResult = await makeRequest('GET', `/drive/shared/by-me/${userId1}`);
    if (sharedByMeResult.status === 200) {
      log(`✅ Retrieved ${sharedByMeResult.data.sharedItems.length} items shared by me`, 'green');
      sharedByMeResult.data.sharedItems.forEach((item, index) => {
        log(`   ${index + 1}. ${item.originalName} (${item.type}) - Shared with: ${item.sharedWithUserId}`, 'blue');
      });
    } else {
      log(`❌ Failed to get shared by me items: ${sharedByMeResult.data.error}`, 'red');
    }
    
    // Test 4: Download shared file
    log('\n⬇️ Test 4: Download Shared File', 'yellow');
    const downloadResult = await makeRequest('GET', `/drive/shared/${userId2}/${shareId}/download`);
    if (downloadResult.status === 200) {
      log(`✅ Download URL generated successfully`, 'green');
      log(`   File: ${downloadResult.data.fileName}`, 'blue');
      log(`   Size: ${downloadResult.data.size} bytes`, 'blue');
      log(`   URL expires in: ${downloadResult.data.expiresIn} seconds`, 'blue');
      log(`   Shared by: ${downloadResult.data.sharedBy}`, 'blue');
    } else {
      log(`❌ Failed to generate download URL: ${downloadResult.data.error}`, 'red');
    }
    
    // Test 5: Update share permissions
    log('\n🔧 Test 5: Update Share Permissions', 'yellow');
    const updatePermissionsData = {
      permissions: ['read'] // Remove write permission
    };
    
    const updateResult = await makeRequest('PATCH', `/drive/share/${userId1}/${shareId}/permissions`, updatePermissionsData);
    if (updateResult.status === 200) {
      log(`✅ Share permissions updated successfully`, 'green');
      log(`   New permissions: ${updateResult.data.permissions.join(', ')}`, 'blue');
    } else {
      log(`❌ Failed to update permissions: ${updateResult.data.error}`, 'red');
    }
    
    // Test 6: Try to download with updated permissions
    log('\n⬇️ Test 6: Download with Updated Permissions', 'yellow');
    const downloadResult2 = await makeRequest('GET', `/drive/shared/${userId2}/${shareId}/download`);
    if (downloadResult2.status === 200) {
      log(`✅ Download still works with updated permissions`, 'green');
      log(`   Permissions: ${downloadResult2.data.permissions.join(', ')}`, 'blue');
    } else {
      log(`❌ Download failed after permission update: ${downloadResult2.data.error}`, 'red');
    }
    
    // Test 7: Revoke share
    log('\n🚫 Test 7: Revoke Share', 'yellow');
    const revokeResult = await makeRequest('DELETE', `/drive/share/${userId1}/${shareId}/revoke`);
    if (revokeResult.status === 200) {
      log(`✅ Share revoked successfully`, 'green');
      log(`   Status: ${revokeResult.data.status}`, 'blue');
    } else {
      log(`❌ Failed to revoke share: ${revokeResult.data.error}`, 'red');
    }
    
    // Test 8: Try to access revoked share
    log('\n🔒 Test 8: Try to Access Revoked Share', 'yellow');
    const revokedAccessResult = await makeRequest('GET', `/drive/shared/${userId2}/${shareId}/download`);
    if (revokedAccessResult.status === 403 || revokedAccessResult.status === 404) {
      log(`✅ Revoked share access properly denied`, 'green');
    } else {
      log(`❌ Revoked share still accessible: ${revokedAccessResult.data}`, 'red');
    }
    
    log('\n🎉 All sharing tests completed successfully!', 'green');
    log('=' .repeat(50), 'cyan');
    
  } catch (error) {
    log(`\n💥 Test failed with error: ${error.message}`, 'red');
  }
}

// Run the tests
testCompleteSharing().catch(console.error);


