import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

// Simple Notifications Service using DynamoDB and WHAPI
// Tables used (must exist or will be created on demand if permitted by IAM):
// - brmh-notify-connections
// - brmh-notify-triggers
// - brmh-notify-logs

const CONNECTIONS_TABLE = process.env.NOTIFY_CONNECTIONS_TABLE || 'brmh-notify-connections';
const TRIGGERS_TABLE = process.env.NOTIFY_TRIGGERS_TABLE || 'brmh-notify-triggers';
const LOGS_TABLE = process.env.NOTIFY_LOGS_TABLE || 'brmh-notify-logs';

let documentClientRef = null;
let lowClientRef = null;

function assertDocClient() {
  if (!documentClientRef) throw new Error('Notifications service not initialized');
}

async function putItem(tableName, item) {
  assertDocClient();
  const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
  await documentClientRef.send(new PutCommand({ TableName: tableName, Item: item }));
  return item;
}

async function queryByGsi(tableName, indexName, keyConditionExpression, expressionAttributeValues, expressionAttributeNames) {
  assertDocClient();
  const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
  const res = await documentClientRef.send(new QueryCommand({
    TableName: tableName,
    IndexName: indexName,
    KeyConditionExpression: keyConditionExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ExpressionAttributeNames: expressionAttributeNames
  }));
  return res.Items || [];
}

async function scanTable(tableName, limit = 100) {
  assertDocClient();
  const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
  const res = await documentClientRef.send(new ScanCommand({ TableName: tableName, Limit: limit }));
  return res.Items || [];
}

async function createLogEntry(entry) {
  const logItem = {
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    ...entry
  };
  await putItem(LOGS_TABLE, logItem);
  return logItem;
}

async function getConnection(connectionId) {
  assertDocClient();
  const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
  const res = await documentClientRef.send(new GetCommand({
    TableName: CONNECTIONS_TABLE,
    Key: { id: connectionId }
  }));
  return res.Item || null;
}

async function listConnections() {
  return await scanTable(CONNECTIONS_TABLE, 500);
}

async function listTriggersByEvent(eventType) {
  // Use a scan to keep things simple if GSI is not present
  const items = await scanTable(TRIGGERS_TABLE, 1000);
  return items.filter(t => t.eventType === eventType && t.active !== false);
}

async function getTriggerById(id) {
  assertDocClient();
  const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
  const res = await documentClientRef.send(new GetCommand({ TableName: TRIGGERS_TABLE, Key: { id } }));
  return res.Item || null;
}

async function getTriggerByName(name) {
  const items = await scanTable(TRIGGERS_TABLE, 1000);
  return items.find(t => t.name === name) || null;
}

async function sendWhapiMessage(connection, payload) {
  const baseUrl = connection.baseUrl || 'https://gate.whapi.cloud';
  const token = connection.token;
  const endpoint = `${baseUrl.replace(/\/$/, '')}/messages/text`; // default text endpoint

  // Remove + from phone number if present
  if (payload.to && payload.to.startsWith('+')) {
    payload.to = payload.to.substring(1);
  }

  if (connection.testMode) {
    return { testMode: true, endpoint, payload };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
  const res = await axios.post(endpoint, payload, { headers, validateStatus: () => true });
  return { status: res.status, data: res.data };
}

function matchFilters(filters, event) {
  if (!filters) return true;
  try {
    // simple deep checks for a small subset (tableName, method, path, resource)
    if (filters.tableName && filters.tableName !== event.tableName) return false;
    if (filters.method && String(filters.method).toUpperCase() !== String(event.method || '').toUpperCase()) return false;
    if (filters.pathContains && !(event.path || '').includes(filters.pathContains)) return false;
    if (filters.resource && filters.resource !== event.resource) return false;
    return true;
  } catch {
    return false;
  }
}

async function executeAction(trigger, event) {
  const { action, connectionId } = trigger;
  console.log(`[Backend] executeAction for trigger ${trigger.name}:`, { action, connectionId });
  if (!action || action.type !== 'whapi') return { skipped: true, reason: 'unsupported_action' };

  const connection = await getConnection(connectionId);
  console.log(`[Backend] Connection found:`, connection ? { id: connection.id, name: connection.name, testMode: connection.testMode } : 'null');
  if (!connection) return { error: 'connection_not_found' };

  const to = action.to || (event?.recipient || null);
  const text = action.textTemplate ? interpolate(action.textTemplate, { trigger, event }) : (action.text || JSON.stringify({ eventType: event.type, at: new Date().toISOString() }));

  console.log(`[Backend] Message details:`, { to, text: text.substring(0, 100) + (text.length > 100 ? '...' : '') });

  if (!to || !text) return { error: 'invalid_action_config' };

  const payload = { to, body: text };
  console.log(`[Backend] Sending WHAPI message:`, { to, bodyLength: text.length, testMode: connection.testMode });
  const response = await sendWhapiMessage(connection, payload);
  console.log(`[Backend] WHAPI response:`, response);
  return response;
}

function interpolate(template, context) {
  return String(template).replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, path) => {
    const parts = path.split('.');
    let cur = context;
    for (const p of parts) {
      if (cur && Object.prototype.hasOwnProperty.call(cur, p)) cur = cur[p];
      else return '';
    }
    return cur == null ? '' : String(cur);
  });
}

export async function notifyEvent(event) {
  try {
    console.log('[Backend] notifyEvent called with:', event);
    // event: { type, method, path, resource, tableName, data, actor }
    const triggers = await listTriggersByEvent(event.type);
    console.log(`[Backend] Found ${triggers.length} triggers for event type: ${event.type}`);
    for (const trig of triggers) {
      console.log(`[Backend] Processing trigger: ${trig.name} (${trig.id})`);
      if (!matchFilters(trig.filters, event)) {
        console.log(`[Backend] Trigger ${trig.name} filtered out`);
        continue;
      }
      console.log(`[Backend] Executing action for trigger: ${trig.name}`);
      const result = await executeAction(trig, event);
      console.log(`[Backend] Action result for ${trig.name}:`, result);
      await createLogEntry({
        kind: 'trigger_execution',
        triggerId: trig.id,
        eventType: event.type,
        status: result?.error ? 'error' : 'ok',
        result,
        eventSummary: {
          method: event.method,
          path: event.path,
          tableName: event.tableName,
          resource: event.resource
        }
      });
    }
  } catch (err) {
    console.error('[Backend] notifyEvent error:', err);
    await createLogEntry({ kind: 'notify_error', error: err.message, stack: err.stack, event });
  }
}

export function registerNotificationRoutes(app, docClient) {
  documentClientRef = docClient;

  // Also keep a low-level client for table management
  (async () => {
    try {
      const { DynamoDBClient, DescribeTableCommand, CreateTableCommand } = await import('@aws-sdk/client-dynamodb');
      lowClientRef = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });

      async function ensureTable(tableName) {
        try {
          await lowClientRef.send(new DescribeTableCommand({ TableName: tableName }));
        } catch (e) {
          if (e.name === 'ResourceNotFoundException') {
            await lowClientRef.send(new CreateTableCommand({
              TableName: tableName,
              BillingMode: 'PAY_PER_REQUEST',
              AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
              KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }]
            }));
          }
        }
      }

      // Best-effort ensure tables exist (non-blocking)
      ensureTable(CONNECTIONS_TABLE).catch(() => {});
      ensureTable(TRIGGERS_TABLE).catch(() => {});
      ensureTable(LOGS_TABLE).catch(() => {});
    } catch {}
  })();

  // Create or update a WHAPI connection
  app.post('/notify/connection', async (req, res) => {
    try {
      const { name, baseUrl, token, testMode = false, metadata = {} } = req.body || {};
      if (!name || !token) {
        return res.status(400).json({ success: false, error: 'name and token are required' });
      }
      const item = {
        id: uuidv4(),
        name,
        baseUrl: baseUrl || 'https://gate.whapi.cloud',
        token,
        testMode: !!testMode,
        metadata,
        createdAt: new Date().toISOString()
      };
      await putItem(CONNECTIONS_TABLE, item);
      await createLogEntry({ kind: 'connection_saved', connectionId: item.id, name: item.name });
      res.json({ success: true, connectionId: item.id });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // List connections
  app.get('/notify/connections', async (_req, res) => {
    try {
      const items = await listConnections();
      res.json({ success: true, items });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Create a trigger
  app.post('/notify/trigger', async (req, res) => {
    try {
      const { name, eventType, filters = {}, action, connectionId, active = true } = req.body || {};
      if (!name || !eventType || !action || !connectionId) {
        return res.status(400).json({ success: false, error: 'name, eventType, action, connectionId are required' });
      }
      const item = {
        id: uuidv4(),
        name,
        eventType,
        filters,
        action,
        connectionId,
        active,
        createdAt: new Date().toISOString()
      };
      await putItem(TRIGGERS_TABLE, item);
      await createLogEntry({ kind: 'trigger_saved', triggerId: item.id, name: item.name, eventType: item.eventType });
      res.json({ success: true, triggerId: item.id });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // List triggers
  app.get('/notify/triggers', async (_req, res) => {
    try {
      const items = await scanTable(TRIGGERS_TABLE, 1000);
      res.json({ success: true, items });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Test fire triggers by eventType
  app.post('/notify/test', async (req, res) => {
    try {
      const { eventType, event = {} } = req.body || {};
      console.log('[Backend] Test fire request:', { eventType, event });
      if (!eventType) return res.status(400).json({ success: false, error: 'eventType is required' });
      const payload = { type: eventType, ...event };
      console.log('[Backend] Calling notifyEvent with payload:', payload);
      await notifyEvent(payload);
      console.log('[Backend] Test fire completed successfully');
      res.json({ success: true });
    } catch (error) {
      console.error('[Backend] Test fire error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Logs
  app.get('/notify/logs', async (_req, res) => {
    try {
      const items = await scanTable(LOGS_TABLE, 200);
      res.json({ success: true, items });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Fire a specific WHAPI trigger by id or name
  app.all('/notify/whapi/:key', async (req, res) => {
    try {
      const { key } = req.params;
      let trigger = await getTriggerById(key);
      if (!trigger) trigger = await getTriggerByName(key);
      if (!trigger) return res.status(404).json({ success: false, error: 'Trigger not found' });

      // Optional overrides via body
      const overrides = typeof req.body === 'object' ? req.body : {};
      const overrideTo = overrides.to;
      const event = overrides.event || {
        type: trigger.eventType,
        method: 'MANUAL',
        resource: 'manual',
        data: { body: overrides.data || {} }
      };

      const trigToUse = overrideTo ? { ...trigger, action: { ...trigger.action, to: overrideTo } } : trigger;
      const result = await executeAction(trigToUse, event);

      const log = await createLogEntry({
        kind: 'trigger_execution',
        triggerId: trigger.id,
        eventType: event.type,
        status: result?.error ? 'error' : 'ok',
        result,
        eventSummary: {
          method: event.method,
          path: event.path,
          tableName: event.tableName,
          resource: event.resource
        }
      });

      res.json({ success: !result?.error, log, result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

// Helper to derive and emit events for known flows
export function buildCrudEvent({ method, tableName, body, result }) {
  const typeMap = { POST: 'crud_create', PUT: 'crud_update', DELETE: 'crud_delete', GET: 'crud_read' };
  const type = typeMap[String(method).toUpperCase()] || 'crud_operation';
  const event = {
    type,
    method,
    tableName,
    resource: 'dynamodb',
    data: { body, result }
  };
  console.log('[Backend] buildCrudEvent:', event);
  return event;
}

export function buildUnifiedNamespaceEvent({ method, path, response }) {
  const up = String(method).toUpperCase();
  let type = null;
  console.log('[Backend] buildUnifiedNamespaceEvent called with:', { method: up, path });
  if (path.includes('/namespaces')) {
    if (up === 'POST') type = 'namespace_created';
    else if (up === 'PUT' || up === 'PATCH') type = 'namespace_updated';
    else if (up === 'DELETE') type = 'namespace_deleted';
  }
  console.log('[Backend] Detected event type:', type);
  if (!type) return null;
  const event = {
    type,
    method,
    path,
    resource: 'unified_api',
    data: { response }
  };
  console.log('[Backend] Built event:', event);
  return event;
}


