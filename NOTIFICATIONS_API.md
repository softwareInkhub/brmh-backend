### BRMH Notifications API Guide

This document explains the Notifications subsystem implemented in `utils/notifications.js` and wired in `index.js`. It covers data model, environment, all REST endpoints, example payloads, and how to list and execute triggers (including their callable URLs).

---

## Overview

- **Purpose**: Simple notification and automation system using DynamoDB for storage and the WHAPI service for WhatsApp messaging.
- **Tables** (can be overridden by env):
  - `brmh-notify-connections` — Stores WHAPI connections (base URL, token, test mode).
  - `brmh-notify-triggers` — Stores triggers mapped to events and actions.
  - `brmh-notify-logs` — Stores execution logs of triggers and operations.
- **Integration points**:
  - Generic CRUD flow emits events via `buildCrudEvent` → `notifyEvent`.
  - Unified Namespace API emits namespace events via `buildUnifiedNamespaceEvent` → `notifyEvent`.

---

## Environment Variables

- `NOTIFY_CONNECTIONS_TABLE` (default `brmh-notify-connections`)
- `NOTIFY_TRIGGERS_TABLE` (default `brmh-notify-triggers`)
- `NOTIFY_LOGS_TABLE` (default `brmh-notify-logs`)
- `AWS_REGION` (default `us-east-1`)

Tables are best-effort created at startup if they don't exist (HASH key: `id`), assuming IAM permits it.

---

## Core Concepts

- **Connection**: WHAPI credentials and settings used to send messages.
  - Example shape:
    ```json
    {
      "id": "uuid",
      "name": "My WhatsApp",
      "baseUrl": "https://gate.whapi.cloud",
      "token": "<WHAPI_BEARER_TOKEN>",
      "testMode": false,
      "metadata": {},
      "createdAt": "2025-01-01T00:00:00.000Z"
    }
    ```
- **Trigger**: Defines when and what to send.
  - Fields: `id`, `name`, `eventType`, `filters`, `action`, `connectionId`, `namespaceTags`, `active`, `createdAt`.
  - `eventType`: string indicating the event, e.g., `crud_create`, `namespace_created`, or any custom type you emit.
  - `filters`: optional filter object, supported keys: `tableName`, `method`, `pathContains`, `resource`.
  - `action`:
    - `type`: `whapi_message` | `whapi_community` | `whapi_group` | `whapi` (defaults to message)
    - For `whapi_message`: `{ to: "+911234567890", textTemplate?: "Hello {{event.type}}", text?: "literal" }`
    - For `whapi_group`: `{ groupIds: ["<group-id>"], messageTemplate?: "..." }`
    - For `whapi_community`: `{ communityId: "...", groupIds: ["..."], messageTemplate?: "..." }`
    - Template placeholders support `{{ trigger.* }}` and `{{ event.* }}` paths.
- **Events**:
  - CRUD: built via `buildCrudEvent({ method, tableName, body, result })` → types like `crud_create`, `crud_update`, etc.
  - Unified Namespace: built via `buildUnifiedNamespaceEvent({ method, path, response })` → types like `namespace_created`, `namespace_updated`, etc.

---

## Endpoints (mounted in `index.js`)

Base: same host/port as the backend (default `http://localhost:5001`).

### Connections

- POST `/notify/connection` — Create a WHAPI connection
  - Body:
    ```json
    {
      "name": "Primary WhatsApp",
      "baseUrl": "https://gate.whapi.cloud",
      "token": "<bearer-token>",
      "testMode": true,
      "metadata": {"owner": "ops"}
    }
    ```
  - Response: `{ success: true, connectionId: "..." }`

- GET `/notify/connections` — List connections
  - Response: `{ success: true, items: [ ...connectionItems ] }`

### Triggers

- POST `/notify/trigger` — Create a trigger
  - Body (message example):
    ```json
    {
      "name": "Notify on new order",
      "eventType": "crud_create",
      "filters": { "tableName": "orders" },
      "action": {
        "type": "whapi_message",
        "to": "+911234567890",
        "textTemplate": "New order created: {{event.data.result.id}}"
      },
      "connectionId": "<connection-uuid>",
      "active": true,
      "namespaceTags": ["orders"]
    }
    ```
  - Response: `{ success: true, triggerId: "..." }`

- GET `/notify/triggers` — List triggers
  - Response: `{ success: true, items: [ ...triggerItems ] }`
  - Tip: Each trigger can be executed via the URL `/notify/{idOrName}`. See “Manual trigger execution” below.

### Test firing by event type

- POST `/notify/test`
  - Body:
    ```json
    {
      "eventType": "crud_create",
      "event": {
        "method": "POST",
        "path": "/crud?tableName=orders",
        "resource": "manual",
        "tableName": "orders",
        "data": {"message": "Hello from test"}
      }
    }
    ```
  - Behavior: finds all active triggers with matching `eventType` and filters, executes actions, logs results.

### Logs

- GET `/notify/logs`
  - Optional query: `?namespace=orders` to filter by `namespaceTags`.
  - Response: `{ success: true, items: [ ...logItems ] }`

### Manual trigger execution (by id or name)

- ALL `/notify/:key`
  - `:key` can be the trigger `id` or `name`.
  - Optional overrides in body:
    ```json
    {
      "to": "+911234567890",
      "message": "override message",
      "data": { "foo": "bar" },
      "event": { "type": "custom_type", "method": "MANUAL", "resource": "manual", "data": {"message": "..."} }
    }
    ```
  - If `event` is omitted, a default manual event is synthesized from the trigger’s `eventType`.
  - Response: `{ success: true, log, result }`
  - This is the URL you can use to call a specific trigger directly: `POST http://localhost:5001/notify/<trigger-id-or-name>`

### WHAPI Utility Endpoints (for discovery and testing)

- GET `/notify/test/:connectionId` — Simple GET to `/communities` using the connection
- GET `/notify/communities/:connectionId` — List communities
- GET `/notify/groups/:connectionId` — List groups
- GET `/notify/communities/:connectionId/:communityId/subgroups` — List subgroups of a community
- GET `/notify/contacts/:connectionId` — List contacts

All return:
```json
{
  "success": true,
  "connection": {"id":"...","name":"...","testMode":true},
  "testResult": { "status": <httpStatus>, "data": <providerResponse> }
}
```

---

## How to List Triggers and Find Their URLs

1. List triggers:
   - Request: `GET http://localhost:5001/notify/triggers`
   - Inspect each item’s `id` and `name`.
2. Trigger URL format (manual execution):
   - `http://localhost:5001/notify/{id}` or `http://localhost:5001/notify/{name}`
3. Example:
   - If a trigger has `id = 6b3e...` and `name = order-create-msg`, you can fire it via either:
     - `POST http://localhost:5001/notify/6b3e...`
     - `POST http://localhost:5001/notify/order-create-msg`

---

## End-to-End Examples

### 1) Create a connection

```bash
curl -X POST http://localhost:5001/notify/connection \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Primary WhatsApp",
    "baseUrl": "https://gate.whapi.cloud",
    "token": "REDACTED",
    "testMode": true
  }'
```

### 2) Create a trigger for CRUD create on `orders`

```bash
curl -X POST http://localhost:5001/notify/trigger \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "orders-create-alert",
    "eventType": "crud_create",
    "filters": {"tableName": "orders"},
    "action": {
      "type": "whapi_message",
      "to": "+911234567890",
      "textTemplate": "New order: {{event.data.result.id}}"
    },
    "connectionId": "<connection-uuid>",
    "active": true,
    "namespaceTags": ["orders"]
  }'
```

### 3) List triggers (and get callable URLs)

```bash
curl http://localhost:5001/notify/triggers
```

For each item, the manual execution URL is:

- `http://localhost:5001/notify/{id}`
- `http://localhost:5001/notify/{name}`

### 4) Fire a trigger manually with message override

```bash
curl -X POST http://localhost:5001/notify/orders-create-alert \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "Manual test message",
    "to": "+911234567890"
  }'
```

### 5) Test-fire triggers by event type

```bash
curl -X POST http://localhost:5001/notify/test \
  -H 'Content-Type: application/json' \
  -d '{
    "eventType": "crud_create",
    "event": {
      "method": "POST",
      "path": "/crud?tableName=orders",
      "resource": "manual",
      "tableName": "orders",
      "data": {"message": "Hello from test"}
    }
  }'
```

### 6) View logs (optionally filter by namespace)

```bash
curl "http://localhost:5001/notify/logs?namespace=orders"
```

### 7) Discover WHAPI entities

```bash
curl http://localhost:5001/notify/communities/<connectionId>
curl http://localhost:5001/notify/groups/<connectionId>
curl http://localhost:5001/notify/contacts/<connectionId>
curl http://localhost:5001/notify/communities/<connectionId>/<communityId>/subgroups
```

---

## Message Templating

- Templates can include placeholders like `{{event.type}}`, `{{event.data.result.id}}`, `{{trigger.name}}`.
- If a custom message is provided in the event or manual fire body (`message` or `data.message`), it overrides the template.
- Leading `+` is removed from `to` automatically before sending to WHAPI.

---

## Test Mode

- If a connection has `testMode: true`, all WHAPI requests return a synthetic response without hitting the real API. Useful for dry runs and development.

---

## Automatic Event Emission in the Backend

- CRUD endpoint (`/crud`) builds and emits events using `buildCrudEvent`.
- Unified API routes (`/unified/*`) build and emit namespace events using `buildUnifiedNamespaceEvent`.
- Both ultimately call `notifyEvent(event)` which:
  - Finds matching triggers for `event.type`.
  - Applies `filters`.
  - Executes the configured `action` via the matched connection.
  - Writes an execution log to `brmh-notify-logs`.

---

## Error Handling & Logs

- Any errors during `notifyEvent` are logged as `kind: "notify_error"` in the logs table.
- Manual executions and test fires also create `trigger_execution` log entries with status `ok` or `error`.

---

## Quick Checklist

- Create a connection (get `connectionId`).
- Create one or more triggers referencing that `connectionId`.
- Optionally verify WHAPI via `/notify/test/{connectionId}`.
- Trigger automatically from CRUD/Unified events or manually via `/notify/{idOrName}`.
- Observe results in `/notify/logs` (filter with `?namespace=...`).

---

## Appendix: Minimal Trigger Objects

### whapi_message
```json
{
  "name": "simple-message",
  "eventType": "crud_create",
  "action": {"type": "whapi_message", "to": "+911234567890", "text": "Hello"},
  "connectionId": "..."
}
```

### whapi_group
```json
{
  "name": "group-broadcast",
  "eventType": "namespace_updated",
  "action": {"type": "whapi_group", "groupIds": ["<group-id>"], "messageTemplate": "Update: {{event.type}}"},
  "connectionId": "..."
}
```

### whapi_community
```json
{
  "name": "community-broadcast",
  "eventType": "namespace_created",
  "action": {"type": "whapi_community", "communityId": "<id>", "groupIds": ["<g1>","<g2>"], "messageTemplate": "New namespace!"},
  "connectionId": "..."
}
```


