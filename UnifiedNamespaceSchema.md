# Unified API Route Schemas

This document describes the request, response, and error schemas for all unified routes as defined in the OpenAPI spec.

---

## Schema Operations

### POST /unified/schema/generate
- **Summary:** Generate schema from data
- **Request:**
```json
{
  "data": { /* object to generate schema from */ }
}
```
- **Response 200:**
```json
{
  "schema": { /* generated schema object */ },
  "isArray": true,
  "originalType": "array"
}
```
- **Error:**
```json
{ "error": "Error message" }
```

### POST /unified/schema/validate
- **Summary:** Validate data against schema
- **Request:**
```json
{
  "schema": { /* JSON schema */ },
  "data": { /* data to validate */ }
}
```
- **Response 200:**
```json
{
  "valid": true,
  "errors": []
}
```
- **Error:**
```json
{ "error": "Error message" }
```

### POST /unified/schema
- **Summary:** Save schema
- **Request:**
```json
{
  "methodId": "string",
  "schemaName": "string",
  "methodName": "string",
  "namespaceId": "string",
  "schemaType": "string",
  "schema": { /* schema object */ },
  "isArray": true,
  "originalType": "string",
  "url": "string"
}
```
- **Response 200:**
```json
{ "schemaId": "string" }
```
- **Error:**
```json
{ "error": "Error message" }
```

### GET /unified/schema
- **Summary:** List all schemas
- **Response 200:**
```json
[ { /* schema object */ }, ... ]
```
- **Error:**
```json
{ "error": "Error message" }
```

### GET /unified/schema/{schemaId}
- **Summary:** Get schema by ID
- **Response 200:**
```json
{ /* schema object */ }
```
- **Error 404:**
```json
{ "error": "Schema not found" }
```

### PUT /unified/schema/{schemaId}
- **Summary:** Update schema
- **Request:**
```json
{ /* fields to update */ }
```
- **Response 200:**
```json
{ /* updated schema object */ }
```
- **Error:**
```json
{ "error": "Error message" }
```

### DELETE /unified/schema/{schemaId}
- **Summary:** Delete schema
- **Response 204:** No content
- **Error 404:**
```json
{ "error": "Schema not found" }
```

---

## Table Operations

### POST /unified/schema/table
- **Summary:** Create schema table
- **Request:**
```json
{ "schemaId": "string", "tableName": "string" }
```
- **Response 200:**
```json
{ "message": "Table created successfully", "tableName": "string", "schemaId": "string", "metaId": "string" }
```
- **Error:**
```json
{ "error": "Error message" }
```

### GET /unified/schema/table-meta
- **Summary:** List schema table metadata
- **Response 200:**
```json
[ { /* table meta object */ }, ... ]
```
- **Error:**
```json
{ "error": "Error message" }
```

### GET /unified/schema/table-meta/{metaId}
- **Summary:** Get schema table metadata
- **Response 200:**
```json
{ /* table meta object */ }
```
- **Error 404:**
```json
{ "error": "Not found" }
```

### POST /unified/schema/table-meta/check/{metaId}
- **Summary:** Check and update table status
- **Response 200:**
```json
{ "id": "string", "tableName": "string", "status": "string" }
```
- **Error:**
```json
{ "error": "Error message" }
```

### GET /unified/schema/table/{tableName}/items
- **Summary:** Get table items
- **Response 200:**
```json
[ { /* item object */ }, ... ]
```
- **Error 404:**
```json
{ "error": "Not found" }
```

---

## API Execution

### POST /unified/execute
- **Summary:** Execute namespace request
- **Request:**
```json
{
  "method": "string",
  "url": "string",
  "queryParams": { /* object */ },
  "headers": { /* object */ },
  "body": { /* object */ }
}
```
- **Response 200:**
```json
{ /* response object */ }
```
- **Error:**
```json
{ "error": "Error message" }
```

### POST /unified/execute/paginated
- **Summary:** Execute paginated namespace request
- **Request:**
```json
{
  "method": "string",
  "url": "string",
  "maxIterations": 10,
  "paginationType": "string",
  "queryParams": { /* object */ },
  "headers": { /* object */ },
  "body": { /* object */ }
}
```
- **Response 200:**
```json
{
  "status": 200,
  "metadata": { /* object */ },
  "data": [ /* array */ ]
}
```
- **Error:**
```json
{ "error": "Error message" }
```

---

## Namespace Operations

### GET /unified/namespaces
- **Summary:** Get all namespaces
- **Response 200:**
```json
[ { /* namespace object */ }, ... ]
```
- **Error:**
```json
{ "error": "Error message" }
```

### POST /unified/namespaces
- **Summary:** Create namespace
- **Request:**
```json
{
  "namespace-name": "string",
  "namespace-url": "string",
  "tags": ["string"]
}
```
- **Response 201:**
```json
{ /* created namespace object */ }
```
- **Error:**
```json
{ "error": "Error message" }
```

### GET /unified/namespaces/{namespaceId}
- **Summary:** Get namespace by ID
- **Response 200:**
```json
{ /* namespace object */ }
```
- **Error 404:**
```json
{ "error": "Namespace not found" }
```

### PUT /unified/namespaces/{namespaceId}
- **Summary:** Update namespace
- **Request:**
```json
{
  "namespace-name": "string",
  "namespace-url": "string",
  "tags": ["string"]
}
```
- **Response 200:**
```json
{ /* updated namespace object */ }
```
- **Error:**
```json
{ "error": "Error message" }
```

### DELETE /unified/namespaces/{namespaceId}
- **Summary:** Delete namespace
- **Response 204:** No content
- **Error 404:**
```json
{ "error": "Namespace not found" }
```

---

## Namespace Account Operations

### GET /unified/namespaces/{namespaceId}/accounts
- **Summary:** Get namespace accounts
- **Response 200:**
```json
[ { /* account object */ }, ... ]
```
- **Error:**
```json
{ "error": "Error message" }
```

### POST /unified/namespaces/{namespaceId}/accounts
- **Summary:** Create namespace account
- **Request:**
```json
{
  "namespace-account-name": "string",
  "namespace-account-url-override": "string",
  "namespace-account-header": [ { "key": "string", "value": "string" } ],
  "variables": [ { "key": "string", "value": "string" } ],
  "tags": ["string"]
}
```
- **Response 201:**
```json
{ /* created account object */ }
```
- **Error:**
```json
{ "error": "Error message" }
```

### PUT /unified/accounts/{accountId}
- **Summary:** Update namespace account
- **Request:**
```json
{
  "namespace-account-name": "string",
  "namespace-account-url-override": "string",
  "namespace-account-header": [ { "key": "string", "value": "string" } ],
  "variables": [ { "key": "string", "value": "string" } ],
  "tags": ["string"]
}
```
- **Response 200:**
```json
{ /* updated account object */ }
```
- **Error:**
```json
{ "error": "Error message" }
```

### DELETE /unified/accounts/{accountId}
- **Summary:** Delete namespace account
- **Response 204:** No content
- **Error 404:**
```json
{ "error": "Account not found" }
```

---

## Namespace Method Operations

### GET /unified/namespaces/{namespaceId}/methods
- **Summary:** Get namespace methods
- **Response 200:**
```json
[ { /* method object */ }, ... ]
```
- **Error:**
```json
{ "error": "Error message" }
```

### POST /unified/namespaces/{namespaceId}/methods
- **Summary:** Create namespace method
- **Request:**
```json
{
  "namespace-method-name": "string",
  "namespace-method-type": "string",
  "namespace-method-url-override": "string",
  "namespace-method-queryParams": [ { "key": "string", "value": "string" } ],
  "namespace-method-header": [ { "key": "string", "value": "string" } ],
  "save-data": true,
  "isInitialized": true,
  "tags": ["string"],
  "sample-request": { /* object */ },
  "sample-response": { /* object */ },
  "request-schema": { /* object */ },
  "response-schema": { /* object */ }
}
```
- **Response 201:**
```json
{ /* created method object */ }
```
- **Error:**
```json
{ "error": "Error message" }
```

### PUT /unified/methods/{methodId}
- **Summary:** Update namespace method
- **Request:**
```json
{
  "namespace-method-name": "string",
  "namespace-method-type": "string",
  "namespace-method-url-override": "string",
  "namespace-method-queryParams": [ { "key": "string", "value": "string" } ],
  "namespace-method-header": [ { "key": "string", "value": "string" } ],
  "save-data": true,
  "isInitialized": true,
  "tags": ["string"],
  "sample-request": { /* object */ },
  "sample-response": { /* object */ },
  "request-schema": { /* object */ },
  "response-schema": { /* object */ }
}
```
- **Response 200:**
```json
{ /* updated method object */ }
```
- **Error:**
```json
{ "error": "Error message" }
```

### DELETE /unified/methods/{methodId}
- **Summary:** Delete namespace method
- **Response 204:** No content
- **Error 404:**
```json
{ "error": "Method not found" }
```
