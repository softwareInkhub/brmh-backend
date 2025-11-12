# BRMH CRUD System - Complete API Guide

## 🎯 Overview

The BRMH CRUD system provides a unified interface for performing Create, Read, Update, and Delete operations on any DynamoDB table. It automatically handles table schema detection, key management, and data validation.

## 🏗️ How It Works

### Core Architecture
```
HTTP Request → CRUD Handler → DynamoDB Operations → Response
     ↓              ↓              ↓              ↓
Method + Body → Schema Detection → Put/Get/Update/Delete → JSON Response
```

### Key Features
- **Automatic Schema Detection**: Dynamically detects partition and sort keys
- **Flexible Data Handling**: Supports strings, numbers, booleans, arrays, and objects
- **Pagination Support**: Built-in pagination for large datasets
- **Metadata Tracking**: Automatic timestamp and request metadata
- **Error Handling**: Comprehensive error responses with context

## 📡 API Endpoints

### Base URL
```
POST/PUT/GET/DELETE /crud?tableName={tableName}
```

### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tableName` | string | ✅ | DynamoDB table name |
| `pagination` | boolean | ❌ | Enable pagination (default: false) |
| `itemPerPage` | number | ❌ | Items per page (default: 50) |
| `maxPage` | number | ❌ | Maximum pages to fetch (default: ∞) |

## 🔧 CRUD Operations

### 1. CREATE (POST)

#### Purpose
Create a new item in the specified DynamoDB table.

#### Request
```http
POST /crud?tableName=my-table
Content-Type: application/json

{
  "item": {
    "id": "user-123",
    "name": "John Doe",
    "email": "john@example.com",
    "age": 30,
    "isActive": true,
    "tags": ["premium", "verified"],
    "profile": {
      "bio": "Software Developer",
      "location": "New York"
    }
  }
}
```

#### Response
```json
{
  "success": true,
  "id": "user-123"
}
```

#### Key Requirements
- **`item` field is required** in request body
- **Partition key must be present** in the item
- **Sort key** (if exists) must be present in the item
- **Data types supported**: string, number, boolean, array, object, null

#### Example with Sort Key
```http
POST /crud?tableName=orders
Content-Type: application/json

{
  "item": {
    "customerId": "user-123",        // Partition Key
    "orderId": "order-456",          // Sort Key
    "total": 99.99,
    "status": "pending",
    "items": [
      {"productId": "prod-1", "quantity": 2},
      {"productId": "prod-2", "quantity": 1}
    ]
  }
}
```

#### Response with Sort Key
```json
{
  "success": true,
  "customerId": "user-123",
  "orderId": "order-456"
}
```

### 2. READ (GET)

#### Purpose
Retrieve items from the specified DynamoDB table.

#### Single Item by Key
```http
GET /crud?tableName=my-table&id=user-123
```

#### Response
```json
{
  "success": true,
  "item": {
    "id": "user-123",
    "name": "John Doe",
    "email": "john@example.com",
    "age": 30,
    "isActive": true,
    "tags": ["premium", "verified"],
    "profile": {
      "bio": "Software Developer",
      "location": "New York"
    }
  }
}
```

#### Single Item with Sort Key
```http
GET /crud?tableName=orders&customerId=user-123&orderId=order-456
```

#### Paginated Scan (All Items)
```http
GET /crud?tableName=my-table&pagination=true&itemPerPage=10&maxPage=5
```

#### Response (Paginated)
```json
{
  "success": true,
  "count": 47,
  "pagesFetched": 5,
  "items": [
    {
      "id": "user-123",
      "name": "John Doe",
      "email": "john@example.com"
    },
    {
      "id": "user-124", 
      "name": "Jane Smith",
      "email": "jane@example.com"
    }
    // ... more items
  ]
}
```

#### Pagination Parameters
- **`pagination=true`**: Enable pagination mode
- **`itemPerPage`**: Number of items per page (default: 50)
- **`maxPage`**: Maximum pages to fetch (default: unlimited)

### 3. UPDATE (PUT)

#### Purpose
Update existing items in the specified DynamoDB table.

#### Request
```http
PUT /crud?tableName=my-table
Content-Type: application/json

{
  "key": {
    "id": "user-123"
  },
  "updates": {
    "name": "John Smith",
    "age": 31,
    "isActive": false,
    "lastUpdated": "2024-01-15T10:00:00Z"
  }
}
```

#### Response
```json
{
  "success": true,
  "updatedItem": {
    "id": "user-123",
    "name": "John Smith",
    "email": "john@example.com",
    "age": 31,
    "isActive": false,
    "lastUpdated": "2024-01-15T10:00:00Z",
    "timestamp": "2024-01-15T10:00:00Z",
    "_metadata": {
      "requestDetails": {},
      "status": 200,
      "itemIndex": 0,
      "totalItems": 1,
      "originalId": "user-123"
    }
  }
}
```

#### Update with Sort Key
```http
PUT /crud?tableName=orders
Content-Type: application/json

{
  "key": {
    "customerId": "user-123",
    "orderId": "order-456"
  },
  "updates": {
    "status": "shipped",
    "shippedAt": "2024-01-15T10:00:00Z"
  }
}
```

#### Automatic Metadata
The system automatically adds:
- **`timestamp`**: Current timestamp
- **`_metadata`**: Request tracking information

### 4. DELETE (DELETE)

#### Purpose
Delete items from the specified DynamoDB table.

#### Request
```http
DELETE /crud?tableName=my-table
Content-Type: application/json

{
  "id": "user-123"
}
```

#### Response
```json
{
  "success": true
}
```

#### Delete with Sort Key
```http
DELETE /crud?tableName=orders
Content-Type: application/json

{
  "customerId": "user-123",
  "orderId": "order-456"
}
```

## 🔍 Schema Detection

### How It Works
The system automatically detects table schema using AWS DynamoDB `DescribeTable` command:

```javascript
// System automatically detects:
const { partitionKey, sortKey } = await describeKeySchema(tableName);

// Example result:
{
  partitionKey: "id",        // HASH key
  sortKey: "timestamp"       // RANGE key (if exists)
}
```

### Supported Key Types
- **Partition Key (HASH)**: Required for all operations
- **Sort Key (RANGE)**: Optional, used for composite keys

## 📊 Data Types & Validation

### Supported Data Types
| Type | Example | Notes |
|------|---------|-------|
| `string` | `"hello"` | UTF-8 strings |
| `number` | `42`, `3.14` | Integers and floats |
| `boolean` | `true`, `false` | Boolean values |
| `array` | `[1, 2, 3]` | Arrays of any type |
| `object` | `{"key": "value"}` | Nested objects |
| `null` | `null` | Null values |

### Data Cleaning
The system automatically:
- **Converts numbers to strings** for key fields
- **Filters out unsupported types** (functions, undefined, etc.)
- **Removes bookmark/url fields** from items
- **Validates required keys** before operations

## 🚨 Error Handling

### Common Error Responses

#### Missing Table Name
```json
{
  "error": "Missing tableName in query parameters"
}
```

#### Missing Required Fields
```json
{
  "error": "Missing partition key: id"
}
```

#### Invalid Request Body
```json
{
  "error": "Item is required"
}
```

#### Method Not Allowed
```json
{
  "error": "Method Not Allowed"
}
```

#### Server Error
```json
{
  "error": "Internal server error message"
}
```

## 💡 Usage Examples

### JavaScript/Node.js
```javascript
// Create item
const createResponse = await fetch('/crud?tableName=users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    item: {
      id: 'user-123',
      name: 'John Doe',
      email: 'john@example.com'
    }
  })
});

// Read item
const readResponse = await fetch('/crud?tableName=users&id=user-123');
const user = await readResponse.json();

// Update item
const updateResponse = await fetch('/crud?tableName=users', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    key: { id: 'user-123' },
    updates: { name: 'John Smith' }
  })
});

// Delete item
const deleteResponse = await fetch('/crud?tableName=users', {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: 'user-123' })
});
```

### Python
```python
import requests
import json

# Create item
create_data = {
    "item": {
        "id": "user-123",
        "name": "John Doe",
        "email": "john@example.com"
    }
}
response = requests.post('/crud?tableName=users', json=create_data)

# Read item
response = requests.get('/crud?tableName=users&id=user-123')
user = response.json()

# Update item
update_data = {
    "key": {"id": "user-123"},
    "updates": {"name": "John Smith"}
}
response = requests.put('/crud?tableName=users', json=update_data)

# Delete item
delete_data = {"id": "user-123"}
response = requests.delete('/crud?tableName=users', json=delete_data)
```

### cURL
```bash
# Create item
curl -X POST "/crud?tableName=users" \
  -H "Content-Type: application/json" \
  -d '{"item": {"id": "user-123", "name": "John Doe"}}'

# Read item
curl "/crud?tableName=users&id=user-123"

# Update item
curl -X PUT "/crud?tableName=users" \
  -H "Content-Type: application/json" \
  -d '{"key": {"id": "user-123"}, "updates": {"name": "John Smith"}}'

# Delete item
curl -X DELETE "/crud?tableName=users" \
  -H "Content-Type: application/json" \
  -d '{"id": "user-123"}'
```

## 🔧 Advanced Features

### Pagination Control
```http
# Get first 10 items from maximum 3 pages
GET /crud?tableName=large-table&pagination=true&itemPerPage=10&maxPage=3
```

### Metadata Tracking
Every update operation automatically includes:
```json
{
  "_metadata": {
    "requestDetails": {},      // Request context
    "status": 200,            // HTTP status
    "itemIndex": 0,           // Item position
    "totalItems": 1,          // Total items processed
    "originalId": "user-123"  // Original item identifier
  }
}
```

### Data Type Conversion
```javascript
// Input data
{
  "id": 123,           // Number
  "name": "John",      // String
  "active": true       // Boolean
}

// After processing (for key fields)
{
  "id": "123",         // Converted to string
  "name": "John",      // String (unchanged)
  "active": true       // Boolean (unchanged)
}
```

## 🚀 Integration with BRMH System

### Used By
- **Unified Handlers**: For namespace/account/method operations
- **Execute System**: For saving fetched API data
- **Cache System**: For storing cached data
- **File Management**: For BRMH Drive metadata

### Table Examples
```javascript
// Namespaces table
POST /crud?tableName=namespaces
{
  "item": {
    "namespace-id": "uuid",
    "namespace-name": "Shopify",
    "namespace-url": "https://api.shopify.com"
  }
}

// Accounts table
POST /crud?tableName=accounts
{
  "item": {
    "account-id": "uuid",
    "namespace-id": "uuid",
    "namespace-account-name": "Production Store"
  }
}

// Methods table
POST /crud?tableName=methods
{
  "item": {
    "method-id": "uuid",
    "namespace-id": "uuid",
    "namespace-method-name": "Get Orders"
  }
}
```

## 📈 Performance Considerations

### Best Practices
1. **Use specific keys** for single item operations (GET, PUT, DELETE)
2. **Use pagination** for large table scans
3. **Limit maxPage** to prevent excessive data fetching
4. **Batch operations** when possible
5. **Monitor DynamoDB capacity** for large operations

### Pagination Limits
- **Default itemPerPage**: 50
- **Maximum recommended**: 1000 per page
- **Use maxPage** to prevent runaway scans

## 🔒 Security Notes

### Access Control
- **Table-level permissions** managed by AWS IAM
- **No built-in authentication** in CRUD handler
- **Input validation** prevents malformed requests
- **Error messages** don't expose sensitive information

### Data Protection
- **Automatic data cleaning** removes potentially harmful fields
- **Type validation** ensures data integrity
- **Key validation** prevents invalid operations

---

## 📞 Support & Resources

- **AWS DynamoDB Documentation**: [Official AWS Docs](https://docs.aws.amazon.com/dynamodb/)
- **BRMH Unified API**: `/unified/` endpoints for higher-level operations
- **Error Logs**: Check CloudWatch for detailed error information
- **Table Schema**: Use AWS Console to verify table structure

**🎯 The BRMH CRUD system provides a simple, powerful interface for all your DynamoDB operations!**

