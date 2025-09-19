# BRMH Execute API - Comprehensive Guide

## Overview

The BRMH Execute API provides powerful data synchronization and retrieval capabilities with support for pagination, caching, and various execution modes. This guide covers the `get-all` and `sync` operations for fetching data with pagination.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Execution Types](#execution-types)
3. [Get-All Operation](#get-all-operation)
4. [Sync Operation](#sync-operation)
5. [Pagination Configuration](#pagination-configuration)
6. [Advanced Examples](#advanced-examples)
7. [Error Handling](#error-handling)
8. [Best Practices](#best-practices)

## Quick Start

### Basic Get-All Request

```bash
curl -X POST https://your-api.com/execute \
  -H "Content-Type: application/json" \
  -d '{
    "executeType": "get-all",
    "tableName": "your-dynamodb-table",
    "url": "https://api.example.com/orders",
    "headers": {
      "Authorization": "Bearer your-token"
    },
    "idField": "id",
    "nextPageIn": "header",
    "nextPageField": "link",
    "isAbsoluteUrl": true
  }'
```

### Basic Sync Request

```bash
curl -X POST https://your-api.com/execute \
  -H "Content-Type: application/json" \
  -d '{
    "executeType": "sync",
    "tableName": "your-dynamodb-table",
    "url": "https://api.example.com/orders",
    "stopOnExisting": true
  }'
```

## Execution Types

### 1. Get-All (`executeType: "get-all"`)
- **Purpose**: Fetch all data from an API and save to DynamoDB
- **Behavior**: Saves all items regardless of existing data
- **Use Case**: Initial data import, full refresh

### 2. Sync (`executeType: "sync"`)
- **Purpose**: Synchronize data, skipping existing items
- **Behavior**: Checks for existing items before saving
- **Use Case**: Incremental updates, avoiding duplicates

## Get-All Operation

### Basic Configuration

```json
{
  "executeType": "get-all",
  "tableName": "shopify-orders",
  "url": "https://your-store.myshopify.com/admin/api/2023-10/orders.json",
  "headers": {
    "X-Shopify-Access-Token": "your-access-token"
  },
  "idField": "id",
  "nextPageIn": "header",
  "nextPageField": "link",
  "isAbsoluteUrl": true
}
```

### Advanced Get-All with Pagination

```json
{
  "executeType": "get-all",
  "tableName": "shopify-orders",
  "url": "https://your-store.myshopify.com/admin/api/2023-10/orders.json",
  "headers": {
    "X-Shopify-Access-Token": "your-access-token"
  },
  "idField": "id",
  "nextPageField": "link",
  "nextPageIn": "header",
  "isAbsoluteUrl": true,
  "maxPages": 100
}
```

### Response Format

```json
{
  "success": true,
  "message": "Sync completed",
  "pagesScanned": 5,
  "savedCount": 250,
  "skippedCount": 0,
  "saved": ["order1", "order2", "order3"],
  "skipped": []
}
```

## Pagination Limits

### Infinite Pagination (Default)

**When `maxPages` is not specified**, the system will fetch **ALL pages** until there are no more pages available:

```json
{
  "executeType": "get-all",
  "tableName": "shopify-products",
  "url": "https://store.myshopify.com/admin/api/2024-01/products.json"
  // No maxPages = fetch ALL pages
}
```

**Benefits:**
- ✅ Fetches complete dataset
- ✅ No data loss
- ✅ Automatic stop when no more pages

**Considerations:**
- ⚠️ May take longer for large datasets
- ⚠️ Higher API usage
- ⚠️ More DynamoDB writes

### Limited Pagination

**When `maxPages` is specified**, the system will stop after the specified number of pages:

```json
{
  "executeType": "get-all",
  "tableName": "shopify-products",
  "url": "https://store.myshopify.com/admin/api/2024-01/products.json",
  "maxPages": 10
  // Will stop after 10 pages
}
```

**Benefits:**
- ✅ Faster execution
- ✅ Controlled API usage
- ✅ Predictable resource consumption

**Use Cases:**
- Testing with small datasets
- Incremental data fetching
- API rate limit management

## Sync Operation

### Basic Sync Configuration

```json
{
  "executeType": "sync",
  "tableName": "shopify-orders",
  "url": "https://your-store.myshopify.com/admin/api/2023-10/orders.json",
  "headers": {
    "X-Shopify-Access-Token": "your-access-token"
  },
  "idField": "id",
  "stopOnExisting": true
}
```

### Advanced Sync with Auto-Stop

```json
{
  "executeType": "sync",
  "tableName": "shopify-orders",
  "url": "https://your-store.myshopify.com/admin/api/2023-10/orders.json",
  "headers": {
    "X-Shopify-Access-Token": "your-access-token"
  },
  "idField": "id",
  "stopOnExisting": false,
  "maxPages": 50
}
```

### Sync Response Examples

#### Normal Completion
```json
{
  "success": true,
  "message": "Sync completed",
  "pagesScanned": 3,
  "savedCount": 150,
  "skippedCount": 50,
  "saved": ["new_order1", "new_order2"],
  "skipped": ["existing_order1", "existing_order2"]
}
```

#### Early Stop (stopOnExisting: true)
```json
{
  "success": true,
  "message": "Stopped sync: item with id 12345 already exists",
  "reason": "stopOnExisting",
  "savedCount": 10,
  "skippedCount": 1,
  "saved": ["order1", "order2"],
  "skipped": ["12345"]
}
```

#### Auto-Stop (2000+ existing items)
```json
{
  "success": true,
  "message": "Stopped sync: 200 existing items matched in DynamoDB",
  "reason": "auto-stop-after-200",
  "savedCount": 0,
  "skippedCount": 2000,
  "saved": [],
  "skipped": ["order1", "order2", "..."]
}
```

## Pagination Configuration

### Shopify-Style Pagination (Link Headers)

```json
{
  "executeType": "get-all",
  "tableName": "shopify-orders",
  "url": "https://your-store.myshopify.com/admin/api/2023-10/orders.json",
  "nextPageField": "link",
  "nextPageIn": "header",
  "tokenParam": "page_info"
}
```

### JSON Response Pagination

```json
{
  "executeType": "get-all",
  "tableName": "api-orders",
  "url": "https://api.example.com/orders",
  "nextPageField": "pagination.nextPage",
  "nextPageIn": "body",
  "tokenParam": "page"
}
```

### Nested Field Pagination

```json
{
  "executeType": "get-all",
  "tableName": "nested-orders",
  "url": "https://api.example.com/orders",
  "nextPageField": "meta.pagination.next_url",
  "nextPageIn": "body",
  "isAbsoluteUrl": true
}
```

## Advanced Examples

### 1. Shopify Orders with Full Pagination

```json
{
  "executeType": "sync",
  "tableName": "shopify-inkhub-get-orders",
  "url": "https://inkhub.myshopify.com/admin/api/2023-10/orders.json",
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

### 2. WooCommerce Products with Query Parameters

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

## Error Handling

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

## Best Practices

### 1. Pagination Strategy

- **Use `stopOnExisting: true`** for incremental syncs
- **Set reasonable `maxPages`** limits (50-100)
- **Monitor response times** for large datasets
- **Test pagination logic** with small datasets first

### 2. Performance Optimization

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

### 3. Error Recovery

- **Implement retry logic** for failed requests
- **Use smaller `maxPages`** for unstable APIs
- **Monitor skipped vs saved ratios**
- **Set up alerts** for high error rates

### 4. Data Validation

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

## Configuration Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `executeType` | string | Yes | "single" | Execution mode: "get-all" or "sync" |
| `tableName` | string | Yes | - | DynamoDB table name |
| `url` | string | Yes | - | API endpoint URL |
| `headers` | object | No | {} | HTTP headers |
| `idField` | string | No | "id" | Field to use as unique identifier |
| `stopOnExisting` | boolean | No | true | Stop on first existing item (sync only) |
| `nextPageField` | string | No | "nextPageToken" | Field containing next page token |
| `nextPageIn` | string | No | "body" | Location of pagination: "body" or "header" |
| `tokenParam` | string | No | "pageToken" | Query parameter name for pagination |
| `isAbsoluteUrl` | boolean | No | false | Whether pagination URLs are absolute |
| `maxPages` | number | No | 50 | Maximum pages to process |

## Monitoring and Logging

### Execution Logs

The system provides detailed logging for monitoring:

```
[Namespace Execute] Fetching details for namespace: ns-123, account: acc-456, method: meth-789
[Namespace Execute] Found namespace: shopify, account: inkhub, method: get-orders
[Namespace Execute] Executing GET request to: https://inkhub.myshopify.com/admin/api/2023-10/orders.json
```

### Success Metrics

- **Pages Scanned**: Number of API pages processed
- **Saved Count**: Items successfully saved to DynamoDB
- **Skipped Count**: Items that already existed (sync mode)
- **Execution Time**: Total time for the operation

## Troubleshooting

### Common Issues

1. **Pagination Not Working**
   - Check `nextPageField` configuration
   - Verify `nextPageIn` is correct ("body" vs "header")
   - Test with `isAbsoluteUrl: true` if needed

2. **High Skip Rates**
   - Use `stopOnExisting: true` for incremental syncs
   - Check if `idField` is correctly configured
   - Verify data uniqueness in source API

3. **Timeout Issues**
   - Reduce `maxPages` limit
   - Check API response times
   - Implement retry logic

4. **Memory Issues**
   - Process smaller batches
   - Use streaming for large datasets
   - Monitor DynamoDB write capacity

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

**Note**: No `maxPages` field = infinite pagination (fetches ALL pages)

**Key Settings**:
- `nextPageIn: "header"` - Look for pagination in response headers
- `nextPageField: "link"` - Shopify uses "Link" header
- `isAbsoluteUrl: true` - Shopify provides absolute URLs in Link headers

## Integration Examples

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

---

## Support

For additional help or questions about the BRMH Execute API:

- Check the logs for detailed error messages
- Verify your API credentials and permissions
- Test with small datasets first
- Review the pagination configuration for your specific API

**Happy Syncing! 🚀**
