# 🚀 BRMH Execute Utility - Complete Guide

## 📋 Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Execution Types](#execution-types)
4. [API Reference](#api-reference)
5. [Examples](#examples)
6. [Advanced Features](#advanced-features)
7. [Error Handling](#error-handling)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)

---

## 🎯 Overview

The BRMH Execute Utility is a powerful, multi-purpose tool that provides:

- **Data Synchronization** - Sync data between APIs and DynamoDB
- **Pagination Handling** - Automatically handle paginated APIs
- **CRUD Operations** - Perform database operations
- **Cache Management** - Manage Redis cache operations
- **Search Indexing** - Handle Algolia search operations
- **Namespace Execution** - Execute pre-configured API methods

### 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   External API  │───▶│  Execute Utility │───▶│   DynamoDB      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │   Redis Cache    │
                       └──────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │  Algolia Search  │
                       └──────────────────┘
```

---

## 🚀 Quick Start

### Basic Single Request

```bash
curl -X POST https://your-api.com/execute \
  -H "Content-Type: application/json" \
  -d '{
    "executeType": "single",
    "method": "GET",
    "url": "https://api.example.com/users",
    "headers": {
      "Authorization": "Bearer your-token"
    }
  }'
```

### Basic Data Sync

```bash
curl -X POST https://your-api.com/execute \
  -H "Content-Type: application/json" \
  -d '{
    "executeType": "sync",
    "tableName": "users",
    "url": "https://api.example.com/users",
    "idField": "id",
    "stopOnExisting": true
  }'
```

---

## 🔧 Execution Types

### 1. **Single Execution** (`executeType: "single"`)

**Purpose**: Make a single API request

**Use Cases**:
- Testing API endpoints
- One-time data retrieval
- Health checks

**Example**:
```json
{
  "executeType": "single",
  "method": "GET",
  "url": "https://api.example.com/status",
  "headers": {
    "Authorization": "Bearer token"
  }
}
```

### 2. **Sync Execution** (`executeType: "sync"`)

**Purpose**: Synchronize data with duplicate detection

**Use Cases**:
- Incremental data updates
- Avoiding duplicate records
- Smart data synchronization

**Example**:
```json
{
  "executeType": "sync",
  "tableName": "products",
  "url": "https://api.example.com/products",
  "idField": "id",
  "stopOnExisting": true,
  "maxPages": 10
}
```

### 3. **Get-All Execution** (`executeType: "get-all"`)

**Purpose**: Fetch all data without duplicate checking

**Use Cases**:
- Initial data import
- Full data refresh
- Complete dataset migration

**Example**:
```json
{
  "executeType": "get-all",
  "tableName": "orders",
  "url": "https://api.example.com/orders",
  "idField": "order_id",
  "maxPages": 50
}
```

### 4. **Namespace Execution** (`executeType: "namespace"`)

**Purpose**: Execute pre-configured API methods

**Use Cases**:
- Using saved API configurations
- Consistent API execution
- Team collaboration

**Example**:
```json
{
  "executeType": "namespace",
  "namespaceId": "ns-123",
  "accountId": "acc-456",
  "methodId": "meth-789",
  "save": true,
  "tableName": "shopify-orders"
}
```

### 5. **CRUD Execution** (`executeType: "crud"`)

**Purpose**: Perform database operations

**Use Cases**:
- Direct database manipulation
- Data cleanup
- Batch operations

**Example**:
```json
{
  "executeType": "crud",
  "crudOperation": "POST",
  "tableName": "users",
  "item": {
    "id": "user-123",
    "name": "John Doe",
    "email": "john@example.com"
  }
}
```

### 6. **Cache Execution** (`executeType: "cache"`)

**Purpose**: Manage Redis cache operations

**Use Cases**:
- Cache data for performance
- Clear expired cache
- Cache health monitoring

**Example**:
```json
{
  "executeType": "cache",
  "cacheOperation": "POST",
  "project": "my-app",
  "table": "products",
  "recordsPerKey": 100,
  "ttl": 3600
}
```

### 7. **Indexing Execution** (`executeType: "indexing"`)

**Purpose**: Manage Algolia search indices

**Use Cases**:
- Create search indices
- Update search data
- Search operations

**Example**:
```json
{
  "executeType": "indexing",
  "indexingOperation": "index-table",
  "tableName": "products",
  "indexName": "products-search"
}
```

---

## 📚 API Reference

### Common Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `executeType` | string | Yes | "single" | Execution mode |
| `method` | string | No | "GET" | HTTP method |
| `url` | string | Yes* | - | API endpoint URL |
| `headers` | object | No | {} | HTTP headers |
| `queryParams` | object | No | {} | Query parameters |
| `body` | object | No | {} | Request body |

*Required for single, sync, and get-all executions

### Sync/Get-All Specific Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tableName` | string | Yes | - | DynamoDB table name |
| `idField` | string | No | "id" | Unique identifier field |
| `stopOnExisting` | boolean | No | true | Stop on first existing item |
| `nextPageField` | string | No | "nextPageToken" | Pagination field name |
| `nextPageIn` | string | No | "body" | Pagination location |
| `tokenParam` | string | No | "pageToken" | Query parameter name |
| `isAbsoluteUrl` | boolean | No | false | Absolute pagination URLs |
| `maxPages` | number | No | null | Maximum pages to process |

### Namespace Specific Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `namespaceId` | string | Yes | - | Namespace identifier |
| `accountId` | string | Yes | - | Account identifier |
| `methodId` | string | Yes | - | Method identifier |
| `save` | boolean | No | false | Save results to database |
| `tableName` | string | No | - | Target table name |
| `requestBody` | object | No | - | Override request body |

---

## 💡 Examples

### 1. Shopify Orders Sync

```json
{
  "executeType": "sync",
  "tableName": "shopify-orders",
  "url": "https://your-store.myshopify.com/admin/api/2023-10/orders.json",
  "headers": {
    "X-Shopify-Access-Token": "shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "Content-Type": "application/json"
  },
  "idField": "id",
  "nextPageField": "link",
  "nextPageIn": "header",
  "isAbsoluteUrl": true,
  "stopOnExisting": true,
  "maxPages": 100
}
```

**Response**:
```json
{
  "success": true,
  "message": "Sync completed",
  "pagesScanned": 5,
  "savedCount": 250,
  "skippedCount": 50,
  "saved": ["order1", "order2", "order3"],
  "skipped": ["existing_order1", "existing_order2"]
}
```

### 2. WooCommerce Products Import

```json
{
  "executeType": "get-all",
  "tableName": "woocommerce-products",
  "url": "https://your-store.com/wp-json/wc/v3/products",
  "headers": {
    "Authorization": "Basic " + btoa("consumer_key:consumer_secret")
  },
  "idField": "id",
  "nextPageField": "nextPage",
  "nextPageIn": "body",
  "tokenParam": "page",
  "maxPages": 50
}
```

### 3. Custom API with Nested Pagination

```json
{
  "executeType": "sync",
  "tableName": "custom-orders",
  "url": "https://api.customstore.com/v1/orders",
  "headers": {
    "API-Key": "your-api-key",
    "Accept": "application/json"
  },
  "idField": "order_id",
  "nextPageField": "pagination.next_page_url",
  "nextPageIn": "body",
  "isAbsoluteUrl": true,
  "stopOnExisting": false,
  "maxPages": 25
}
```

### 4. Namespace Execution

```json
{
  "executeType": "namespace",
  "namespaceId": "shopify-namespace",
  "accountId": "inkhub-account",
  "methodId": "get-orders-method",
  "save": true,
  "tableName": "shopify-inkhub-orders"
}
```

### 5. CRUD Operations

#### Create Item
```json
{
  "executeType": "crud",
  "crudOperation": "POST",
  "tableName": "users",
  "item": {
    "id": "user-123",
    "name": "John Doe",
    "email": "john@example.com",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

#### Update Item
```json
{
  "executeType": "crud",
  "crudOperation": "PUT",
  "tableName": "users",
  "item": {
    "id": "user-123",
    "name": "John Smith",
    "email": "johnsmith@example.com"
  }
}
```

#### Get Item
```json
{
  "executeType": "crud",
  "crudOperation": "GET",
  "tableName": "users",
  "item": {
    "id": "user-123"
  }
}
```

#### Delete Item
```json
{
  "executeType": "crud",
  "crudOperation": "DELETE",
  "tableName": "users",
  "item": {
    "id": "user-123"
  }
}
```

### 6. Cache Operations

#### Cache Table Data
```json
{
  "executeType": "cache",
  "cacheOperation": "POST",
  "project": "my-app",
  "table": "products",
  "recordsPerKey": 100,
  "ttl": 3600
}
```

#### Get Cached Data
```json
{
  "executeType": "cache",
  "cacheOperation": "GET",
  "project": "my-app",
  "table": "products"
}
```

#### Clear Cache
```json
{
  "executeType": "cache",
  "cacheOperation": "DELETE",
  "project": "my-app",
  "table": "products"
}
```

### 7. Search Indexing Operations

#### Index Table
```json
{
  "executeType": "indexing",
  "indexingOperation": "index-table",
  "tableName": "products",
  "indexName": "products-search",
  "fields": ["name", "description", "category"]
}
```

#### Search Index
```json
{
  "executeType": "indexing",
  "indexingOperation": "search-index",
  "indexName": "products-search",
  "query": "laptop",
  "filters": {
    "price": { "min": 0, "max": 1000 }
  }
}
```

---

## 🔧 Advanced Features

### 1. **Pagination Strategies**

#### Header-Based Pagination (Shopify)
```json
{
  "nextPageField": "link",
  "nextPageIn": "header",
  "isAbsoluteUrl": true
}
```

#### Body-Based Pagination
```json
{
  "nextPageField": "pagination.nextPage",
  "nextPageIn": "body",
  "tokenParam": "page"
}
```

#### Nested Field Pagination
```json
{
  "nextPageField": "meta.pagination.next_url",
  "nextPageIn": "body",
  "isAbsoluteUrl": true
}
```

### 2. **Smart Duplicate Detection**

#### Stop on First Existing
```json
{
  "executeType": "sync",
  "stopOnExisting": true
}
```

#### Continue with Skipping
```json
{
  "executeType": "sync",
  "stopOnExisting": false
}
```

#### Auto-Stop After 2000 Existing
The system automatically stops after finding 2000 existing items to prevent infinite loops.

### 3. **Performance Optimization**

#### Limited Pages
```json
{
  "maxPages": 50
}
```

#### Infinite Pagination
```json
{
  // No maxPages = fetch ALL pages
}
```

### 4. **Error Recovery**

#### Retry Logic
```json
{
  "retryAttempts": 3,
  "retryDelay": 1000
}
```

#### Graceful Degradation
The system continues processing even if individual items fail.

---

## ⚠️ Error Handling

### Common Error Responses

#### Missing Required Fields
```json
{
  "statusCode": 400,
  "body": "{\"error\": \"tableName and url are required\"}"
}
```

#### Invalid Table
```json
{
  "statusCode": 400,
  "body": "{\"error\": \"Partition key not found in table\"}"
}
```

#### API Response Issues
```json
{
  "statusCode": 400,
  "body": "{\"error\": \"API did not return an array of items\"}"
}
```

#### Server Errors
```json
{
  "statusCode": 500,
  "body": "{\"error\": \"Connection timeout\"}"
}
```

### Error Recovery Strategies

1. **Implement retry logic** for failed requests
2. **Use smaller `maxPages`** for unstable APIs
3. **Monitor skipped vs saved ratios**
4. **Set up alerts** for high error rates

---

## 🎯 Best Practices

### 1. **Pagination Strategy**

- **Use `stopOnExisting: true`** for incremental syncs
- **Set reasonable `maxPages`** limits (50-100)
- **Monitor response times** for large datasets
- **Test pagination logic** with small datasets first

### 2. **Performance Optimization**

```json
{
  "executeType": "sync",
  "tableName": "large-dataset",
  "url": "https://api.example.com/data",
  "maxPages": 25,
  "stopOnExisting": true,
  "idField": "id"
}
```

### 3. **Data Validation**

```json
{
  "executeType": "get-all",
  "tableName": "validated-data",
  "url": "https://api.example.com/data",
  "idField": "unique_id",
  "headers": {
    "Accept": "application/json",
    "User-Agent": "BRMH-Sync/1.0"
  }
}
```

### 4. **Security**

- **Use environment variables** for sensitive data
- **Implement proper authentication**
- **Validate input parameters**
- **Monitor API usage**

---

## 🔍 Troubleshooting

### Common Issues

#### 1. **Pagination Not Working**

**Symptoms**: Only 1 page processed despite setting `maxPages: 50`

**Causes**:
- Incorrect `nextPageField` configuration
- Wrong `nextPageIn` setting
- Missing `isAbsoluteUrl` flag

**Solutions**:
```json
{
  "nextPageIn": "header",
  "nextPageField": "link",
  "isAbsoluteUrl": true
}
```

#### 2. **High Skip Rates**

**Symptoms**: Most items are skipped during sync

**Causes**:
- Using `stopOnExisting: true` with existing data
- Incorrect `idField` configuration
- Data already exists in database

**Solutions**:
- Use `stopOnExisting: false` for full sync
- Verify `idField` matches your data structure
- Check for existing data in database

#### 3. **Timeout Issues**

**Symptoms**: Requests timeout or fail

**Causes**:
- Large datasets without pagination limits
- Slow API responses
- Network connectivity issues

**Solutions**:
- Reduce `maxPages` limit
- Check API response times
- Implement retry logic

#### 4. **Memory Issues**

**Symptoms**: Out of memory errors

**Causes**:
- Processing too many items at once
- Large response payloads
- Insufficient server resources

**Solutions**:
- Process smaller batches
- Use streaming for large datasets
- Monitor server resources

### Shopify-Specific Issues

**Problem**: Only 1 page scanned despite setting `maxPages: 50`

**Root Cause**: Shopify uses Link headers for pagination, not JSON response fields

**Solution**: Use these exact settings for Shopify APIs:

```json
{
  "executeType": "get-all",
  "tableName": "shopify-inkhub-get-products",
  "url": "https://ink7.myshopify.com/admin/api/2024-01/products.json",
  "headers": {
    "X-Shopify-Access-Token": "your-token"
  },
  "idField": "id",
  "nextPageIn": "header",
  "nextPageField": "link",
  "isAbsoluteUrl": true
}
```

**Key Settings**:
- `nextPageIn: "header"` - Look for pagination in response headers
- `nextPageField: "link"` - Shopify uses "Link" header
- `isAbsoluteUrl: true` - Shopify provides absolute URLs in Link headers

---

## 📊 Monitoring and Logging

### Execution Logs

The system provides detailed logging for monitoring:

```
🚀 [STARTING] SYNC operation
📋 [Config] Table: shopify-orders, URL: https://api.example.com/orders
⚙️  [Settings] Max Pages: 100, Stop on Existing: true
🔍 [Pagination] Next Page In: header, Field: link, Absolute URL: true

🔄 [Page 1] Fetching data from: https://api.example.com/orders
📊 [Page 1] Found 50 items in this page
✅ [Page 1] Completed: 45 saved, 5 skipped
📈 [Running Total] Total Saved: 45, Total Skipped: 5
🔗 [Page 1] Next page URL found: https://api.example.com/orders?page=2

🔄 [Page 2] Fetching data from: https://api.example.com/orders?page=2
📊 [Page 2] Found 50 items in this page
✅ [Page 2] Completed: 50 saved, 0 skipped
📈 [Running Total] Total Saved: 95, Total Skipped: 5
🏁 [Page 2] No more pages available - pagination complete

🎉 [COMPLETED] All pages processed successfully!
📊 [Final Stats] Pages Scanned: 2, Total Saved: 95, Total Skipped: 5
```

### Success Metrics

- **Pages Scanned**: Number of API pages processed
- **Saved Count**: Items successfully saved to DynamoDB
- **Skipped Count**: Items that already existed (sync mode)
- **Execution Time**: Total time for the operation

---

## 🔗 Integration Examples

### Node.js Integration

```javascript
const axios = require('axios');

async function syncShopifyOrders() {
  try {
    const response = await axios.post('https://your-api.com/execute', {
      executeType: 'sync',
      tableName: 'shopify-orders',
      url: 'https://your-store.myshopify.com/admin/api/2023-10/orders.json',
      headers: {
        'X-Shopify-Access-Token': 'your-token'
      },
      idField: 'id',
      nextPageIn: 'header',
      nextPageField: 'link',
      isAbsoluteUrl: true,
      stopOnExisting: true
    });
    
    console.log('Sync completed:', response.data);
  } catch (error) {
    console.error('Sync failed:', error.response.data);
  }
}
```

### Python Integration

```python
import requests
import json

def sync_shopify_orders():
    url = "https://your-api.com/execute"
    payload = {
        "executeType": "sync",
        "tableName": "shopify-orders",
        "url": "https://your-store.myshopify.com/admin/api/2023-10/orders.json",
        "headers": {
            "X-Shopify-Access-Token": "your-token"
        },
        "idField": "id",
        "nextPageIn": "header",
        "nextPageField": "link",
        "isAbsoluteUrl": True,
        "stopOnExisting": True
    }
    
    response = requests.post(url, json=payload)
    if response.status_code == 200:
        print("Sync completed:", response.json())
    else:
        print("Sync failed:", response.json())
```

### cURL Examples

#### Basic Sync
```bash
curl -X POST https://your-api.com/execute \
  -H "Content-Type: application/json" \
  -d '{
    "executeType": "sync",
    "tableName": "users",
    "url": "https://api.example.com/users",
    "idField": "id",
    "stopOnExisting": true
  }'
```

#### Advanced Sync with Pagination
```bash
curl -X POST https://your-api.com/execute \
  -H "Content-Type: application/json" \
  -d '{
    "executeType": "sync",
    "tableName": "products",
    "url": "https://api.example.com/products",
    "headers": {
      "Authorization": "Bearer your-token"
    },
    "idField": "id",
    "nextPageField": "pagination.nextPage",
    "nextPageIn": "body",
    "tokenParam": "page",
    "maxPages": 50,
    "stopOnExisting": true
  }'
```

---

## 🎉 Conclusion

The BRMH Execute Utility is a powerful, flexible tool that simplifies data synchronization, API management, and database operations. With its comprehensive feature set and easy-to-use interface, it's perfect for:

- **Data Engineers** - Building ETL pipelines
- **API Developers** - Managing external integrations
- **DevOps Teams** - Automating data operations
- **Business Users** - Syncing data between systems

### Key Benefits

- ✅ **Easy to Use** - Simple JSON configuration
- ✅ **Powerful** - Handles complex pagination and data sync
- ✅ **Reliable** - Built-in error handling and retry logic
- ✅ **Scalable** - Handles large datasets efficiently
- ✅ **Flexible** - Supports multiple execution types
- ✅ **Monitored** - Comprehensive logging and metrics

### Next Steps

1. **Start Simple** - Begin with basic single requests
2. **Add Pagination** - Implement paginated data sync
3. **Use Namespaces** - Leverage pre-configured methods
4. **Monitor Performance** - Track execution metrics
5. **Scale Up** - Handle larger datasets and more complex scenarios

---

## 📞 Support

For additional help or questions about the BRMH Execute Utility:

- 📖 Check the logs for detailed error messages
- 🔐 Verify your API credentials and permissions
- 🧪 Test with small datasets first
- 🔍 Review the pagination configuration for your specific API
- 💬 Contact the development team for complex issues

**Happy Executing! 🚀**

