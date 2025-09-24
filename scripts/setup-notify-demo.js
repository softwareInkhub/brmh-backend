// Demo / sanity test for the notifications feature using WHAPI (test mode)
import axios from 'axios';

const BASE = process.env.API_BASE_URL || 'http://localhost:5001';

async function main() {
  console.log('--- Notifications Demo Start ---');

  // 1) Create a test connection (testMode: true so it doesn't hit real WHAPI)
  const connRes = await axios.post(`${BASE}/notify/connection`, {
    name: 'local-test',
    baseUrl: 'https://gate.whapi.cloud',
    token: 'DUMMY_TOKEN_FOR_TESTS',
    testMode: true
  }).then(r => r.data);
  console.log('Connection:', connRes);

  const connectionId = connRes.connectionId;

  // 2) Create a trigger: when a namespace is created, send message to a number
  const trigRes = await axios.post(`${BASE}/notify/trigger`, {
    name: 'Namespace Created Alert',
    eventType: 'namespace_created',
    connectionId,
    filters: {},
    action: {
      type: 'whapi',
      to: '+10000000000',
      textTemplate: 'Namespace created at {{event.data.response.timestamp || event.data.response.id || "unknown"}}'
    },
    active: true
  }).then(r => r.data);
  console.log('Trigger:', trigRes);

  // 3) Fire a test event explicitly
  const testFire = await axios.post(`${BASE}/notify/test`, {
    eventType: 'namespace_created',
    event: {
      method: 'POST',
      path: '/unified/namespaces',
      resource: 'unified_api',
      data: { response: { id: 'ns-123', timestamp: new Date().toISOString() } }
    }
  }).then(r => r.data);
  console.log('Test fire result:', testFire);

  // 4) Simulate CRUD event by calling the generic CRUD endpoint with POST
  // Note: expects a valid DynamoDB table name in local env; if not available, this step may fail.
  try {
    const crudRes = await axios.post(`${BASE}/crud?tableName=brmh-notify-logs`, { item: { id: 'demo-' + Date.now(), note: 'demo' } }).then(r => r.data);
    console.log('CRUD create result (may fail if table missing):', crudRes);
  } catch (e) {
    console.log('CRUD test skipped or failed (expected in some envs):', e.response?.data || e.message);
  }

  // 5) Fetch logs
  const logs = await axios.get(`${BASE}/notify/logs`).then(r => r.data);
  console.log('Recent logs count:', logs.items?.length || 0);

  console.log('--- Notifications Demo End ---');
}

main().catch(err => {
  console.error('Demo error:', err.message);
  process.exit(1);
});


