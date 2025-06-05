# Schema Management API Documentation

## Overview
The Schema Management API provides endpoints to generate, save, retrieve, update, delete, and list JSON schemas in a DynamoDB table. It is designed to help manage dynamic data structures for various application needs.

---

## Table of Contents
- [Endpoints](#endpoints)
- [Request & Response Payloads](#request--response-payloads)
- [Handler Functions](#handler-functions)
- [Types & Interfaces](#types--interfaces)
- [DynamoDB Table Structure](#dynamodb-table-structure)
- [Error Handling](#error-handling)
- [Implementation Notes](#implementation-notes)

---

## Endpoints

### 1. Generate Schema
- **POST** `/schema/generate`
- **Description:** Generate a JSON schema from provided data.
- **Request Body:**
  ```json
    {
        "responseData": { "name": "John", "age": 30 }
    }
  ```
- **Response:**
  ```json
  {
    "schema": { "type": "object", "properties": { "name": {"type": "string"}, "age": {"type": "number"} }, "required": ["name", "age"] },
    "isArray": false,
    "originalType": "object"
  }
  ```

### 2. Validate Schema
- **POST** `/schema/validate`
- **Description:** Validate data against a JSON schema.
- **Request Body:**
  ```json
  {
    "schema": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "age": { "type": "number" }
      },
      "required": ["name", "age"]
    },
    "data": {
      "name": "John",
      "age": 30
    }
  }
  ```
- **Response:**
  ```json
  {
    "valid": true,
    "errors": []
  }
  ```
  If validation fails:
  ```json
  {
    "valid": false,
    "errors": ["/age must be number"]
  }
  ```

### 3. Save Schema
- **POST** `/schema/save`
- **Description:** Save a generated schema to DynamoDB.
- **Request Body:**
  ```json
  {
    "schemaName": "UserSchema",
    "schema": { ... },
    "isArray": false,
    "originalType": "object"
  }
  ```
- **Response:**
  ```json
  { "schemaId": "uuid-string" }
  ```

### 4. Update Schema
- **PUT** `/schema/{schemaId}`
- **Description:** Update an existing schema by its ID.
- **Request Body:**
  ```json
  {
    "schemaName": "UpdatedName",
    "schema": { ... },
    "isArray": false,
    "originalType": "object"
  }
  ```
- **Response:**
  ```json
  {
    "id": "uuid-string",
    "schema": { ... },
    "isArray": false,
    "originalType": "object"
  }
  ```

### 5. Get Schema by ID
- **GET** `/schema/{schemaId}`
- **Description:** Retrieve a schema by its ID.
- **Response:**
  ```json
  {
    "id": "uuid-string",
    "schema": { ... },
    "isArray": false,
    "originalType": "object"
  }
  ```

### 6. Delete Schema
- **DELETE** `/schema/{schemaId}`
- **Description:** Delete a schema by its ID.
- **Response:**
  - `204 No Content` on success
  - `404 Not Found` with error object if not found

### 7. List All Schemas
- **GET** `/schema/list`
- **Description:** Retrieve all schemas from the `schemas` table.
- **Response:**
  ```json
  [
    {
      "id": "uuid-string",
      "schema": { ... },
      "isArray": false,
      "originalType": "object"
    },
    ...
  ]
  ```

### 8. Create Schemas Table
- **POST** `/schema/table`
- **Description:** Create a DynamoDB table for schemas.
- **Request Body:**
  ```json
  { "tableName": "schemas" }
  ```
- **Response:**
  ```json
  { "message": "Table created successfully", "tableName": "schemas" }
  ```

### 9. Delete Schemas Table
- **DELETE** `/schema/table`
- **Description:** Delete a DynamoDB table for schemas.
- **Request Body:**
  ```json
  { "tableName": "schemas" }
  ```
- **Response:**
  ```json
  { "message": "Table deleted successfully", "tableName": "schemas" }
  ```

---

## Request & Response Payloads
- All endpoints use JSON for request and response bodies.
- Schema objects follow the [JSON Schema](https://json-schema.org/) structure.

---

## Handler Functions (lib/schema-handlers.js)
- **generateSchema(data):** Generates a schema from JSON data.
- **validateSchema(schema, data):** Validates data against a schema.
- **saveSchema(schemaData):** Saves a schema object to DynamoDB.
- **getSchema(schemaId):** Retrieves a schema by its ID.
- **updateSchema(schemaId, updates):** Updates a schema by its ID.
- **deleteSchema(schemaId):** Deletes a schema by its ID.
- **listSchemas():** Returns all schemas from the `schemas` table.
- **createSchemasTable(tableName):** Creates a DynamoDB table for schemas.
- **deleteSchemasTable(tableName):** Deletes a DynamoDB table for schemas.

---

## Types & Interfaces (lib/schema-types.js)
- **SchemaType:** Enum for schema types (`string`, `number`, `object`, `array`, `null`).
- **SchemaProperty:** Structure for schema properties (type, properties, items, required).
- **Schema:** Main schema object (id, methodId, schemaName, etc.).
- **SchemaGenerationRequest:** `{ responseData: Object }`
- **SchemaValidationRequest:** `{ schema: Object, data: Object }`
- **SchemaSaveRequest:** `{ schemaName, schema, ... }`
- **SchemaUpdateRequest:** `{ schemaName, schema, ... }`
- **SchemaResponse:** `{ schema, isArray, originalType }`
- **SchemaListResponse:** `{ schemas: [Schema] }`
- **ErrorResponse:** `{ error, details }`

---

## DynamoDB Table Structure
- **Table Name:** `schemas`
- **Primary Key:** `id` (string, UUID)
- **Attributes:**
  - `id`, `methodId`, `schemaName`, `methodName`, `namespaceId`, `schemaType`, `schema`, `isArray`, `originalType`, `url`, `createdAt`, `updatedAt`

---

## Error Handling
- All errors return a JSON object with `error` and `details` fields.
- 404 errors for not found resources.
- 400 errors for invalid requests (e.g., missing required fields).
- 500 errors for server or DynamoDB issues.

---

## Implementation Notes
- All schema routes are defined at the top of `index.js` to avoid Express route shadowing.
- The `/schema/list` route must be defined before `/schema/:schemaId` to avoid conflicts.
- All DynamoDB operations are performed using the AWS SDK v3.
- Table creation and deletion require a `tableName` in the request body.
- The API is documented and testable via Swagger UI (see `/schema-api-docs`).

---

## Example Usage

### Generate and Save a Schema
1. **Generate:**
   ```json
   POST /schema/generate
   {
     "responseData": { "name": "Alice", "age": 25 }
   }
   ```
2. **Save:**
   ```json
   POST /schema/save
   {
     "schemaName": "UserSchema",
     "schema": { ... },
     "isArray": false,
     "originalType": "object"
   }
   ```

### Validate Data Against a Schema
```json
POST /schema/validate
{
  "schema": {
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "age": { "type": "number" }
    },
    "required": ["name", "age"]
  },
  "data": {
    "name": "John",
    "age": 30
  }
}
```

### Update a Schema
```json
PUT /schema/{schemaId}
{
  "schemaName": "UpdatedName",
  "schema": { ... },
  "isArray": false,
  "originalType": "object"
}
```

### Retrieve All Schemas
```json
GET /schema/list
```

### Delete a Schema
```json
DELETE /schema/{schemaId}
```

---

For further details, see the OpenAPI YAML (`schema-api.yaml`), handler implementation (`lib/schema-handlers.js`), types (`lib/schema-types.js`), and route setup (`index.js`).
