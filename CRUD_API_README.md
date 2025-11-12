# CRUD API Documentation

## Overview

This document describes the **Universal CRUD API Handler** for DynamoDB tables. This Lambda function provides a unified interface to perform Create, Read, Update, and Delete operations on any DynamoDB table without writing table-specific code.

## Table of Contents

- [Architecture](#architecture)
- [API Endpoints](#api-endpoints)
- [Authentication](#authentication)
- [Request/Response Formats](#requestresponse-formats)
- [Examples](#examples)
- [Error Handling](#error-handling)

---

## Architecture

### Key Features

✅ **Universal Table Support** - Works with any DynamoDB table  
✅ **Automatic Key Detection** - Automatically detects partition and sort keys  
✅ **Type Conversion** - Handles number-to-string conversions for keys  
✅ **Pagination Support** - Built-in pagination for GET requests  
✅ **Clean Data Storage** - Removes unnecessary fields before saving  

### Technology Stack

- **Runtime**: AWS Lambda (Node.js)
- **Database**: Amazon DynamoDB
- **SDK**: AWS SDK v3 (`@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`)

---

## API Endpoints

All operations use a **single endpoint** with different HTTP methods:

```
Base URL: https://your-api-gateway-url.amazonaws.com/crud
Query Parameter: ?tableName=YOUR_TABLE_NAME
```

### Supported HTTP Methods

| Method | Operation | Description |
|--------|-----------|-------------|
| `POST` | Create | Create a new item in the table |
| `PUT` | Update | Update an existing item |
| `GET` | Read | Retrieve one or multiple items |
| `DELETE` | Delete | Delete an item from the table |

---

## Request/Response Formats

### 1. CREATE (POST)

**Purpose**: Create a new item in the DynamoDB table.

#### Request Format

```http
POST /crud?tableName=YOUR_TABLE_NAME
Content-Type: application/json

{
  "item": {
    "partition_key_field": "value",
    "sort_key_field": "value",  // Optional, if table has sort key
    "field1": "value1",
    "field2": "value2",
    // ... other fields
  },
  "requestDetails": {},  // Optional metadata (ignored during creation)
  "status": 200,         // Optional metadata (ignored during creation)
  "itemIndex": 0,        // Optional metadata (ignored during creation)
  "totalItems": 1,       // Optional metadata (ignored during creation)
  "originalId": ""       // Optional metadata (ignored during creation)
}
```

#### Key Points

- ✅ **Required**: `item` object with partition key
- ✅ **Auto-cleaned**: `bookmark` and `url` fields are removed
- ✅ **Type conversion**: Numeric keys are converted to strings
- ❌ **No timestamps**: The item is saved exactly as provided (see line 39-41)

#### Response Format

**Success (200)**:
```json
{
  "success": true,
  "partition_key_field": "value",
  "sort_key_field": "value"  // Only if sort key exists
}
```

**Error (400)**:
```json
{
  "error": "Item is required"
}
```
or
```json
{
  "error": "Missing partition key: YOUR_KEY_NAME"
}
```

#### Example Request

```bash
curl -X POST "https://api.example.com/crud?tableName=Users" \
  -H "Content-Type: application/json" \
  -d '{
    "item": {
      "userId": "user123",
      "name": "John Doe",
      "email": "john@example.com",
      "age": 30
    }
  }'
```

---

### 2. UPDATE (PUT)

**Purpose**: Update an existing item in the DynamoDB table.

#### Request Format

```http
PUT /crud?tableName=YOUR_TABLE_NAME
Content-Type: application/json

{
  "key": {
    "partition_key_field": "value",
    "sort_key_field": "value"  // Optional, if table has sort key
  },
  "updates": {
    "field1": "new_value1",
    "field2": "new_value2",
    // ... other fields to update
  },
  "requestDetails": {},  // Optional metadata
  "status": 200,         // Optional metadata
  "itemIndex": 0,        // Optional metadata
  "totalItems": 1,       // Optional metadata
  "originalId": ""       // Optional metadata
}
```

#### Key Points

- ✅ **Required**: Both `key` and `updates` objects
- ✅ **Auto-added**: `timestamp` field (current ISO timestamp)
- ✅ **Auto-added**: `_metadata` object with request details
- ✅ **Partial updates**: Only specified fields are updated
- ✅ **Returns**: Complete updated item

#### Metadata Structure

The `_metadata` object automatically added contains:
```json
{
  "_metadata": {
    "requestDetails": {},
    "status": 200,
    "itemIndex": 0,
    "totalItems": 1,
    "originalId": "partition#sort"
  }
}
```

#### Response Format

**Success (200)**:
```json
{
  "success": true,
  "updatedItem": {
    "partition_key_field": "value",
    "sort_key_field": "value",
    "field1": "new_value1",
    "field2": "new_value2",
    "timestamp": "2025-01-18T12:34:56.789Z",
    "_metadata": {
      "requestDetails": {},
      "status": 200,
      "itemIndex": 0,
      "totalItems": 1,
      "originalId": "user123"
    }
  }
}
```

**Error (400)**:
```json
{
  "error": "Both key and updates are required"
}
```
or
```json
{
  "error": "Missing partition key: YOUR_KEY_NAME"
}
```

#### Example Request

```bash
curl -X PUT "https://api.example.com/crud?tableName=Users" \
  -H "Content-Type: application/json" \
  -d '{
    "key": {
      "userId": "user123"
    },
    "updates": {
      "email": "newemail@example.com",
      "age": 31
    },
    "requestDetails": {
      "source": "admin-panel",
      "updatedBy": "admin@example.com"
    }
  }'
```

---

### 3. READ (GET)

**Purpose**: Retrieve one or multiple items from the DynamoDB table.

#### Request Formats

##### **3.1 Get Single Item**

```http
GET /crud?tableName=YOUR_TABLE_NAME&partition_key_field=value&sort_key_field=value
```

Query Parameters:
- `tableName` (required): Name of the DynamoDB table
- `partition_key_field` (required): Partition key value
- `sort_key_field` (optional): Sort key value (if table has one)
- `pagination` (must be omitted or not "true")

##### **3.2 Get Multiple Items (Paginated Scan)**

```http
GET /crud?tableName=YOUR_TABLE_NAME&pagination=true&itemPerPage=50&maxPage=5
```

Query Parameters:
- `tableName` (required): Name of the DynamoDB table
- `pagination` (required): Must be "true"
- `itemPerPage` (optional): Items per page (default: 50, minimum: 1)
- `maxPage` (optional): Maximum pages to fetch (default: unlimited)

#### Key Points

- ✅ **Single item**: Requires partition key in query params
- ✅ **Multiple items**: Requires `pagination=true`
- ✅ **Efficient**: Uses DynamoDB's native pagination
- ✅ **Configurable**: Control page size and max pages

#### Response Formats

**Single Item Success (200)**:
```json
{
  "success": true,
  "item": {
    "userId": "user123",
    "name": "John Doe",
    "email": "john@example.com",
    "age": 30
  }
}
```

**Single Item Not Found (200)**:
```json
{
  "success": true,
  "item": null
}
```

**Multiple Items Success (200)**:
```json
{
  "success": true,
  "count": 150,
  "pagesFetched": 3,
  "items": [
    {
      "userId": "user123",
      "name": "John Doe"
    },
    {
      "userId": "user456",
      "name": "Jane Smith"
    }
    // ... more items
  ]
}
```

#### Example Requests

**Get Single Item**:
```bash
curl -X GET "https://api.example.com/crud?tableName=Users&userId=user123"
```

**Get Multiple Items (First 100 items)**:
```bash
curl -X GET "https://api.example.com/crud?tableName=Users&pagination=true&itemPerPage=50&maxPage=2"
```

**Get All Items**:
```bash
curl -X GET "https://api.example.com/crud?tableName=Users&pagination=true"
```

---

### 4. DELETE

**Purpose**: Delete an item from the DynamoDB table.

#### Request Format

```http
DELETE /crud?tableName=YOUR_TABLE_NAME
Content-Type: application/json

{
  "partition_key_field": "value",
  "sort_key_field": "value"  // Optional, if table has sort key
}
```

#### Key Points

- ✅ **Required**: Partition key in request body
- ✅ **Optional**: Sort key (if table has one)
- ✅ **Permanent**: Cannot be undone
- ✅ **Idempotent**: Safe to call multiple times

#### Response Format

**Success (200)**:
```json
{
  "success": true
}
```

**Error (400)**:
```json
{
  "error": "Missing body field: YOUR_KEY_NAME"
}
```

#### Example Request

```bash
curl -X DELETE "https://api.example.com/crud?tableName=Users" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123"
  }'
```

---

## Authentication

### AWS IAM Permissions Required

The Lambda function requires the following IAM permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:DescribeTable",
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Scan"
      ],
      "Resource": "arn:aws:dynamodb:REGION:ACCOUNT_ID:table/*"
    }
  ]
}
```

---

## Error Handling

### HTTP Status Codes

| Status Code | Meaning | Common Causes |
|-------------|---------|---------------|
| `200` | Success | Operation completed successfully |
| `400` | Bad Request | Missing required fields, invalid parameters |
| `405` | Method Not Allowed | Unsupported HTTP method |
| `500` | Internal Server Error | DynamoDB errors, Lambda errors |

### Error Response Format

All errors return this format:

```json
{
  "error": "Description of what went wrong"
}
```

### Common Errors

#### 1. Missing Table Name
```json
{
  "error": "Missing tableName in query parameters"
}
```

**Solution**: Add `?tableName=YOUR_TABLE_NAME` to the URL

#### 2. Missing Partition Key (CREATE)
```json
{
  "error": "Missing partition key: userId"
}
```

**Solution**: Ensure the partition key field is included in the `item` object

#### 3. Missing Key or Updates (UPDATE)
```json
{
  "error": "Both key and updates are required"
}
```

**Solution**: Include both `key` and `updates` objects in the request body

#### 4. Missing Item (CREATE)
```json
{
  "error": "Item is required"
}
```

**Solution**: Include an `item` object in the request body

---

## Advanced Features

### 1. Automatic Key Schema Detection

The API automatically detects the partition key and sort key of any table using:

```javascript
const { partitionKey, sortKey } = await describeKeySchema(tableName);
```

This means you **don't need to configure** keys per table!

### 2. Type Conversion

Numeric keys are automatically converted to strings:

```javascript
// Before: { userId: 123 }
// After:  { userId: "123" }
```

### 3. Data Cleaning (CREATE)

The following fields are automatically removed during creation:
- `bookmark`
- `url`
- Complex nested objects (only primitives, arrays, and simple objects are kept)

### 4. Pagination Control

Control how much data is fetched:

```javascript
// Fetch 1000 items (20 pages × 50 items)
GET /crud?tableName=Users&pagination=true&itemPerPage=50&maxPage=20

// Fetch all items (no limit)
GET /crud?tableName=Users&pagination=true
```

---

## Complete Examples

### Example 1: User Management System

#### Create a User
```bash
curl -X POST "https://api.example.com/crud?tableName=Users" \
  -H "Content-Type: application/json" \
  -d '{
    "item": {
      "userId": "usr_001",
      "username": "johndoe",
      "email": "john@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "admin",
      "isActive": true,
      "createdDate": "2025-01-18"
    }
  }'
```

#### Update User Email
```bash
curl -X PUT "https://api.example.com/crud?tableName=Users" \
  -H "Content-Type: application/json" \
  -d '{
    "key": {
      "userId": "usr_001"
    },
    "updates": {
      "email": "john.doe@newdomain.com"
    }
  }'
```

#### Get User Details
```bash
curl -X GET "https://api.example.com/crud?tableName=Users&userId=usr_001"
```

#### Delete User
```bash
curl -X DELETE "https://api.example.com/crud?tableName=Users" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "usr_001"
  }'
```

---

### Example 2: E-Commerce Orders

Table Structure: `Orders`
- Partition Key: `orderId`
- Sort Key: `timestamp`

#### Create an Order
```bash
curl -X POST "https://api.example.com/crud?tableName=Orders" \
  -H "Content-Type: application/json" \
  -d '{
    "item": {
      "orderId": "ORD-2025-001",
      "timestamp": "2025-01-18T12:00:00Z",
      "customerId": "usr_001",
      "totalAmount": 299.99,
      "status": "pending",
      "items": [
        {
          "productId": "prod_123",
          "quantity": 2,
          "price": 149.99
        }
      ]
    }
  }'
```

#### Update Order Status
```bash
curl -X PUT "https://api.example.com/crud?tableName=Orders" \
  -H "Content-Type: application/json" \
  -d '{
    "key": {
      "orderId": "ORD-2025-001",
      "timestamp": "2025-01-18T12:00:00Z"
    },
    "updates": {
      "status": "shipped",
      "trackingNumber": "TRK123456789"
    },
    "requestDetails": {
      "updatedBy": "warehouse-system",
      "reason": "Order shipped"
    }
  }'
```

#### Get Specific Order
```bash
curl -X GET "https://api.example.com/crud?tableName=Orders&orderId=ORD-2025-001&timestamp=2025-01-18T12:00:00Z"
```

#### Get All Orders (Paginated)
```bash
curl -X GET "https://api.example.com/crud?tableName=Orders&pagination=true&itemPerPage=100"
```

---

## Testing

### Local Testing with AWS SAM

```bash
sam local invoke CRUDFunction --event test-event.json
```

**test-event.json** (CREATE):
```json
{
  "httpMethod": "POST",
  "queryStringParameters": {
    "tableName": "TestTable"
  },
  "body": "{\"item\":{\"id\":\"test123\",\"name\":\"Test Item\"}}"
}
```

### Integration Testing

```javascript
// Node.js example using axios
const axios = require('axios');

const API_URL = 'https://your-api.com/crud';

async function testCRUD() {
  // CREATE
  const createResponse = await axios.post(`${API_URL}?tableName=Users`, {
    item: {
      userId: 'test123',
      name: 'Test User'
    }
  });
  console.log('Created:', createResponse.data);

  // READ
  const getResponse = await axios.get(`${API_URL}?tableName=Users&userId=test123`);
  console.log('Retrieved:', getResponse.data);

  // UPDATE
  const updateResponse = await axios.put(`${API_URL}?tableName=Users`, {
    key: { userId: 'test123' },
    updates: { name: 'Updated Name' }
  });
  console.log('Updated:', updateResponse.data);

  // DELETE
  const deleteResponse = await axios.delete(`${API_URL}?tableName=Users`, {
    data: { userId: 'test123' }
  });
  console.log('Deleted:', deleteResponse.data);
}

testCRUD();
```

---

## Best Practices

### 1. Always Include Required Fields
- `tableName` in query parameters for all requests
- Partition key in all operations
- Sort key (if table has one)

### 2. Use Pagination for Large Datasets
```javascript
// ❌ Bad: Fetching too many items at once
GET /crud?tableName=Users&pagination=true&itemPerPage=10000

// ✅ Good: Reasonable page size
GET /crud?tableName=Users&pagination=true&itemPerPage=100&maxPage=10
```

### 3. Include Metadata in Updates
```json
{
  "key": { "userId": "usr_001" },
  "updates": { "email": "new@example.com" },
  "requestDetails": {
    "updatedBy": "admin@example.com",
    "source": "admin-dashboard",
    "reason": "User requested email change"
  }
}
```

### 4. Handle Errors Gracefully
```javascript
try {
  const response = await fetch(apiUrl, options);
  const data = await response.json();
  
  if (!response.ok) {
    console.error('API Error:', data.error);
    // Handle error appropriately
  }
} catch (error) {
  console.error('Network Error:', error);
}
```

---

## Troubleshooting

### Issue: "Missing partition key" error

**Problem**: The partition key field name doesn't match the table schema.

**Solution**:
1. Check your table's key schema in DynamoDB console
2. Use the exact field name in your request

### Issue: Items not returned in GET request

**Problem**: Using wrong query parameters for single item retrieval.

**Solution**:
```bash
# ❌ Wrong
GET /crud?tableName=Users

# ✅ Correct (single item)
GET /crud?tableName=Users&userId=user123

# ✅ Correct (multiple items)
GET /crud?tableName=Users&pagination=true
```

### Issue: UPDATE not working

**Problem**: Missing `key` or `updates` in request body.

**Solution**:
```json
{
  "key": { "userId": "user123" },  // ← Must include
  "updates": { "name": "New Name" } // ← Must include
}
```

---

## API Rate Limits

### DynamoDB Limits
- **Read Capacity**: Based on your table's provisioned capacity
- **Write Capacity**: Based on your table's provisioned capacity
- **Item Size**: Maximum 400 KB per item
- **Batch Size**: Pagination recommended for large datasets

### Best Practices
- Use pagination for large reads
- Implement exponential backoff for retries
- Monitor CloudWatch metrics for throttling

---

## Support & Contact

For issues, questions, or feature requests:
- **GitHub Issues**: [Your Repository URL]
- **Email**: support@example.com
- **Documentation**: [Your Docs URL]

---

## License

[Your License Information]

---

## Changelog

### Version 1.0.0 (Current)
- ✅ Universal CRUD operations
- ✅ Automatic key detection
- ✅ Pagination support
- ✅ Metadata tracking on updates
- ✅ Clean data storage on create

---

**Last Updated**: January 18, 2025  
**API Version**: 1.0.0  
**Maintained by**: [Your Team Name]


