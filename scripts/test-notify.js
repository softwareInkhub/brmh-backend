// End-to-end tests for notifications feature
import assert from 'assert';
import axios from 'axios';

const BASE = process.env.API_BASE_URL || 'http://localhost:5001';

async function run() {
  // Create connection (test mode)
  const conn = await axios.post(`${BASE}/notify/connection`, {
    name: 'e2e-test',
    token: 'DUMMY',
    testMode: true
  }).then(r => r.data);
  assert(conn.success === true && conn.connectionId, 'connection should be created');

  // Create trigger for CRUD create
  const trig = await axios.post(`${BASE}/notify/trigger`, {
    name: 'CRUD Create Notifier',
    eventType: 'crud_create',
    connectionId: conn.connectionId,
    action: { type: 'whapi', to: '+10000000000', textTemplate: 'Created in {{event.tableName}}' },
    filters: { tableName: 'brmh-notify-logs' },
    active: true
  }).then(r => r.data);
  assert(trig.success === true && trig.triggerId, 'trigger should be created');

  // Fire a direct test event
  const fire = await axios.post(`${BASE}/notify/test`, {
    eventType: 'crud_create',
    event: { tableName: 'brmh-notify-logs', method: 'POST', resource: 'dynamodb', data: { body: { id: 't1' } } }
  }).then(r => r.data);
  assert(fire.success === true, 'test fire should succeed');

  // Fetch logs and ensure at least one trigger_execution exists
  const logs = await axios.get(`${BASE}/notify/logs`).then(r => r.data);
  assert(Array.isArray(logs.items), 'logs should be list');
  const hasExecution = logs.items.some(l => l.kind === 'trigger_execution');
  assert(hasExecution, 'should contain at least one trigger_execution log');

  console.log('All notify tests passed.');
}

run().catch((e) => {
  console.error('Notify tests failed:', e.message);
  process.exit(1);
});


