import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5001';

/**
 * Test all namespaces, accounts, and methods
 * Saves results to a JSON file
 */
export const testAllNamespaces = async () => {
  const results = {
    startTime: new Date().toISOString(),
    endTime: null,
    summary: {
      totalNamespaces: 0,
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0
    },
    results: []
  };

  try {
    // Fetch all namespaces
    console.log('📋 Fetching all namespaces...');
    const namespacesRes = await axios.get(`${BACKEND_URL}/unified/namespaces`);
    const namespaces = Array.isArray(namespacesRes.data) ? namespacesRes.data : [];
    results.summary.totalNamespaces = namespaces.length;
    console.log(`✅ Found ${namespaces.length} namespaces`);

    // Test each namespace
    for (const namespace of namespaces) {
      const namespaceId = namespace['namespace-id'];
      const namespaceName = namespace['namespace-name'];

      console.log(`\n🔍 Testing namespace: ${namespaceName} (${namespaceId})`);

      try {
        // Fetch accounts and methods
        const [accountsRes, methodsRes] = await Promise.all([
          axios.get(`${BACKEND_URL}/unified/namespaces/${namespaceId}/accounts`).catch(() => ({ data: [] })),
          axios.get(`${BACKEND_URL}/unified/namespaces/${namespaceId}/methods`).catch(() => ({ data: [] }))
        ]);

        const accounts = Array.isArray(accountsRes.data) ? accountsRes.data : [];
        const methods = Array.isArray(methodsRes.data) ? methodsRes.data : [];

        console.log(`   📦 Accounts: ${accounts.length}, Methods: ${methods.length}`);

        // If no accounts, skip methods (executeNamespace requires accountId)
        if (accounts.length === 0) {
          for (const method of methods) {
            const testResult = {
              namespaceId,
              namespaceName,
              accountId: null,
              accountName: null,
              methodId: method['namespace-method-id'],
              methodName: method['namespace-method-name'],
              status: 'skipped',
              statusCode: null,
              error: 'No account available - executeNamespace requires accountId',
              responseTime: null,
              timestamp: new Date().toISOString()
            };

            results.results.push(testResult);
            results.summary.totalTests++;
            results.summary.skipped++;
            console.log(`   ⏭️  Skipped: ${method['namespace-method-name']} (no account)`);
          }
        } else {
          // Test each method with each account
          for (const account of accounts) {
            for (const method of methods) {
              const startTime = Date.now();
              const testResult = {
                namespaceId,
                namespaceName,
                accountId: account['namespace-account-id'],
                accountName: account['namespace-account-name'],
                methodId: method['namespace-method-id'],
                methodName: method['namespace-method-name'],
                status: 'pending',
                statusCode: null,
                error: null,
                responseTime: null,
                timestamp: new Date().toISOString()
              };

              try {
                console.log(`   🧪 Testing: ${account['namespace-account-name']} / ${method['namespace-method-name']}`);

                const response = await axios.post(
                  `${BACKEND_URL}/unified/execute`,
                  {
                    executeType: 'namespace',
                    namespaceId,
                    accountId: account['namespace-account-id'],
                    methodId: method['namespace-method-id'],
                    save: false
                  },
                  { validateStatus: () => true }
                );

                const responseTime = Date.now() - startTime;
                const responseData = response.data;

                testResult.status = response.status >= 200 && response.status < 400 ? 'success' : 'error';
                testResult.statusCode = response.status;
                testResult.responseTime = responseTime;

                if (response.status >= 400) {
                  testResult.error = responseData.error || `HTTP ${response.status}`;
                  results.summary.failed++;
                } else {
                  results.summary.passed++;
                }

                console.log(`   ${testResult.status === 'success' ? '✅' : '❌'} ${testResult.statusCode} (${responseTime}ms)`);
              } catch (error) {
                const responseTime = Date.now() - startTime;
                testResult.status = 'error';
                testResult.error = error.message || 'Network error';
                testResult.responseTime = responseTime;
                results.summary.failed++;
                console.log(`   ❌ Error: ${testResult.error}`);
              }

              results.results.push(testResult);
              results.summary.totalTests++;

              // Small delay to prevent overwhelming the server
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
        }
      } catch (error) {
        console.error(`   ❌ Error testing namespace ${namespaceName}:`, error.message);
      }
    }

    results.endTime = new Date().toISOString();

    // Save results to JSON file
    const resultsDir = path.join(__dirname, '../test-results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `namespace-test-results-${timestamp}.json`;
    const filepath = path.join(resultsDir, filename);

    fs.writeFileSync(filepath, JSON.stringify(results, null, 2));

    console.log(`\n📊 Test Summary:`);
    console.log(`   Total Namespaces: ${results.summary.totalNamespaces}`);
    console.log(`   Total Tests: ${results.summary.totalTests}`);
    console.log(`   ✅ Passed: ${results.summary.passed}`);
    console.log(`   ❌ Failed: ${results.summary.failed}`);
    console.log(`   ⏭️  Skipped: ${results.summary.skipped}`);
    console.log(`\n💾 Results saved to: ${filepath}`);

    return results;
  } catch (error) {
    console.error('❌ Error running tests:', error);
    results.endTime = new Date().toISOString();
    results.error = error.message;
    throw error;
  }
};

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testAllNamespaces()
    .then(() => {
      console.log('\n✅ Testing completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Testing failed:', error);
      process.exit(1);
    });
}


