# How `executeNamespace` Works

## Overview

`executeNamespace` is a function that executes REST API calls using your namespace system. Instead of manually providing URLs, headers, and credentials, you just provide **IDs** and it automatically fetches all the configuration from your namespace, account, and method definitions.

---

## 🎯 Purpose

**Problem it solves:**
- You have APIs stored in your namespace system (with URLs, headers, auth, etc.)
- You want to execute these APIs without manually copying URLs/headers
- You want to reuse the same API configuration across different workflows

**Solution:**
- Just provide `namespaceId`, `accountId`, and `methodId`
- System automatically fetches all configuration
- Executes the API call with proper authentication
- Optionally saves response to DynamoDB

---

## 📋 Step-by-Step Flow

### Step 1: Receive Request

**Input (POST Request - Create Product):**
```json
{
  "executeType": "namespace",
  "namespaceId": "shopify-namespace-id",
  "accountId": "shopify-account-id",
  "methodId": "create-product-method-id",
  "requestBody": {
    "title": "New Product",
    "price": 99.99
  },
  "save": false,
  "tableName": "optional-table-name"
}
```

**Input (GET Request - Get Products):**
```json
{
  "executeType": "namespace",
  "namespaceId": "shopify-namespace-id",
  "accountId": "shopify-account-id",
  "methodId": "get-products-method-id"
  // No requestBody needed for GET requests
  // Query parameters are defined in method config
}
```

**Required Parameters:**
- `namespaceId` - ID of the namespace
- `accountId` - ID of the account (contains auth credentials)
- `methodId` - ID of the method (contains API endpoint details)

**Optional Parameters:**
- `requestBody` - Override the method's default request body
- `save` - Whether to save response to DynamoDB (default: false)
- `tableName` - DynamoDB table name to save to (auto-generated if not provided)
- `idField` - Field name to use as ID when saving (default: "id")

---

### Step 2: Fetch Namespace Details

```javascript
GET /unified/namespaces/{namespaceId}
```

**What it gets:**
```json
{
  "namespace-id": "shopify-namespace-id",
  "namespace-name": "Shopify",
  "namespace-url": "https://api.shopify.com",
  "tags": ["ecommerce", "api"]
}
```

**Purpose:** Get namespace metadata (name, base URL, etc.)

---

### Step 3: Fetch Account Details

```javascript
GET /unified/accounts/{accountId}
```

**What it gets:**
```json
{
  "namespace-account-id": "shopify-account-id",
  "namespace-account-name": "My Shopify Store",
  "namespace-account-url-override": "https://mystore.myshopify.com",
  "namespace-account-header": [
    {
      "key": "Authorization",
      "value": "Bearer shpat_abc123xyz"
    },
    {
      "key": "X-Shopify-Access-Token",
      "value": "shpat_abc123xyz"
    }
  ]
}
```

**Purpose:** Get authentication credentials and base URL override

---

### Step 4: Fetch Method Details

```javascript
GET /unified/methods/{methodId}
```

**What it gets:**
```json
{
  "namespace-method-id": "create-product-method-id",
  "namespace-method-name": "Create Product",
  "namespace-method-type": "POST",
  "namespace-method-url-override": "/admin/api/2024-01/products.json",
  "namespace-method-header": [
    {
      "key": "Content-Type",
      "value": "application/json"
    }
  ],
  "namespace-method-queryParams": [],
  "sample-request": {
    "product": {
      "title": "Sample Product",
      "price": 100
    }
  }
}
```

**Purpose:** Get API endpoint path, HTTP method, headers, query params, and sample request body

---

### Step 5: Build Full URL

**Logic:**
1. Start with method URL: `/admin/api/2024-01/products.json`
2. If account has `namespace-account-url-override`: `https://mystore.myshopify.com`
3. Combine them:
   - If method URL starts with `/`: `baseUrl + methodUrl`
   - If method URL doesn't start with `/`: `baseUrl + "/" + methodUrl`

**Result:**
```
https://mystore.myshopify.com/admin/api/2024-01/products.json
```

**Example combinations:**
```
Account URL: https://api.example.com
Method URL: /v1/products
Result: https://api.example.com/v1/products

Account URL: https://api.example.com
Method URL: v1/products
Result: https://api.example.com/v1/products

Account URL: https://api.example.com/
Method URL: /v1/products
Result: https://api.example.com/v1/products
```

---

### Step 6: Merge Headers

**Priority Order:**
1. **Account headers** (authentication, API keys)
2. **Method headers** (content-type, custom headers)

**Process:**
```javascript
// Start with method headers
finalHeaders = {
  "Content-Type": "application/json"
}

// Add account headers (authentication)
finalHeaders = {
  "Content-Type": "application/json",
  "Authorization": "Bearer shpat_abc123xyz",
  "X-Shopify-Access-Token": "shpat_abc123xyz"
}
```

**Why this order?**
- Account headers contain authentication (most important)
- Method headers contain content-type and method-specific headers
- Account headers are added last so they can override method headers if needed

---

### Step 7: Build Request Body

**Priority:**
1. `requestBody` from request (if provided) - **highest priority**
2. `namespace-method-body` from method config
3. `sample-request` from method config
4. Empty object `{}` - **fallback**

**Example:**
```javascript
// Request provides:
requestBody: { "title": "New Product", "price": 99.99 }

// Method has:
sample-request: { "product": { "title": "Sample", "price": 100 } }

// Result: Uses requestBody (overrides method's sample)
finalBody = { "title": "New Product", "price": 99.99 }
```

---

### Step 8: Add Query Parameters

**Process:**
```javascript
// Method has queryParams:
queryParams: [
  { "key": "limit", "value": "50" },
  { "key": "status", "value": "active" }
]

// Build URL with query params:
https://api.example.com/products?limit=50&status=active
```

---

### Step 9: Execute API Request

```javascript
const response = await axios({
  method: "POST",
  url: "https://mystore.myshopify.com/admin/api/2024-01/products.json",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer shpat_abc123xyz",
    "X-Shopify-Access-Token": "shpat_abc123xyz"
  },
  data: {
    "title": "New Product",
    "price": 99.99
  },
  validateStatus: () => true  // Don't throw on error status codes
});
```

**Note:** `validateStatus: () => true` means it won't throw errors for 4xx/5xx responses - you get the response object with status code.

---

### Step 10: Optionally Save to DynamoDB

**If `save: true`:**

1. **Determine table name:**
   - If `tableName` provided: use it
   - If not: auto-generate: `{namespaceName}-{accountName}-{methodName}`
   - Example: `shopify-mystore-create-product`

2. **Get table partition key:**
   - Describes the DynamoDB table
   - Finds the partition key (usually "id")

3. **Save items:**
   - If response is array: save each item
   - If response is object with array: find and save array
   - Uses `idField` (default: "id") as the partition key value

**Example:**
```javascript
// Response data:
[
  { "id": "prod_123", "title": "Product 1" },
  { "id": "prod_456", "title": "Product 2" }
]

// Saves to DynamoDB:
Table: shopify-mystore-create-product
Items:
  - { "id": "prod_123", "title": "Product 1" }
  - { "id": "prod_456", "title": "Product 2" }
```

---

### Step 11: Return Response

```json
{
  "statusCode": 201,
  "body": {
    "success": true,
    "status": 201,
    "data": {
      "product": {
        "id": "prod_123",
        "title": "New Product",
        "price": 99.99
      }
    },
    "savedCount": 0,
    "metadata": {
      "namespace": "Shopify",
      "account": "My Shopify Store",
      "method": "Create Product",
      "tableName": null
    }
  }
}
```

---

## 🔄 Complete Flow Diagram

```
Request with IDs
    ↓
┌─────────────────────────────────────┐
│ 1. Fetch Namespace                  │
│    GET /unified/namespaces/{id}     │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│ 2. Fetch Account                    │
│    GET /unified/accounts/{id}       │
│    (Gets auth credentials)          │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│ 3. Fetch Method                     │
│    GET /unified/methods/{id}        │
│    (Gets endpoint, headers, etc.)   │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│ 4. Build Full URL                   │
│    accountUrl + methodUrl           │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│ 5. Merge Headers                    │
│    methodHeaders + accountHeaders   │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│ 6. Build Request Body               │
│    requestBody || methodBody        │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│ 7. Add Query Parameters             │
│    Append to URL                    │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│ 8. Execute API Request              │
│    axios({ method, url, headers,    │
│            data, queryParams })     │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│ 9. Save to DynamoDB?                │
│    If save=true, save response      │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│ 10. Return Response                 │
│     { success, status, data, ... }  │
└─────────────────────────────────────┘
```

---

## 💡 Key Benefits

1. **No Manual Configuration**
   - Don't need to copy/paste URLs, headers, auth tokens
   - Everything stored in namespace system

2. **Centralized Management**
   - Update API config in one place
   - All workflows using it get updated automatically

3. **Security**
   - Auth credentials stored in account (not in workflow)
   - Can rotate credentials without changing workflows

4. **Reusability**
   - Same method can be used in multiple workflows
   - Same account can be used for multiple methods

5. **Flexibility**
   - Can override request body per execution
   - Can optionally save responses to DynamoDB

---

## 📝 Example Usage

### Example 1: GET Request (Get Products)

```javascript
POST /execute
{
  "executeType": "namespace",
  "namespaceId": "shopify-namespace-id",
  "accountId": "shopify-account-id",
  "methodId": "get-products-method-id"
}

// Note: No requestBody needed for GET requests
// Automatically:
// - Fetches namespace, account, method configs
// - Builds URL: https://mystore.myshopify.com/admin/api/2024-01/products.json
// - Adds auth headers from account
// - Executes GET request
// - Returns products list
```

**Key differences for GET requests:**
- ✅ No `requestBody` field (GET requests don't have bodies)
- ✅ Query parameters are defined in the method config (`namespace-method-queryParams`)
- ✅ Still need `namespaceId`, `accountId`, and `methodId`
- ✅ Optional: `save`, `tableName`, `idField` (if you want to save results)

### Example 2: With Request Body Override

```javascript
POST /execute
{
  "executeType": "namespace",
  "namespaceId": "shopify-namespace-id",
  "accountId": "shopify-account-id",
  "methodId": "create-product-method-id",
  "requestBody": {
    "product": {
      "title": "Custom Product",
      "price": 199.99,
      "vendor": "My Brand"
    }
  }
}

// Uses your custom requestBody instead of method's sample-request
```

### Example 3: With Auto-Save to DynamoDB

```javascript
POST /execute
{
  "executeType": "namespace",
  "namespaceId": "shopify-namespace-id",
  "accountId": "shopify-account-id",
  "methodId": "get-products-method-id",
  "save": true
}

// After API call succeeds:
// - Auto-generates table name: shopify-mystore-get-products
// - Saves all products to DynamoDB
// - Returns savedCount in response
```

### Example 4: With Custom Table Name

```javascript
POST /execute
{
  "executeType": "namespace",
  "namespaceId": "shopify-namespace-id",
  "accountId": "shopify-account-id",
  "methodId": "get-products-method-id",
  "save": true,
  "tableName": "my-custom-products-table",
  "idField": "product_id"
}

// Saves to custom table with custom ID field
```

---

## 🔗 How It Relates to Workflows

In your workflow system, when you create an API step:

```json
{
  "id": "createProduct",
  "type": "api",
  "methodId": "shopify-create-product-method-id",
  "accountId": "shopify-account-id",
  "namespaceId": "shopify-namespace-id",
  "input": {
    "title": "{{input.title}}",
    "price": "{{input.price}}"
  }
}
```

The workflow system uses `executeNamespace` logic (via the Lambda function) to:
1. Fetch method/account/namespace configs
2. Build the API request
3. Execute it
4. Return results for next step

**The workflow Lambda essentially calls `executeNamespace` internally!**

---

## 🎯 Summary

`executeNamespace` is a **smart API executor** that:
- ✅ Takes just IDs (namespace, account, method)
- ✅ Fetches all configuration automatically
- ✅ Builds complete API request (URL, headers, body)
- ✅ Executes the request
- ✅ Optionally saves response to DynamoDB
- ✅ Returns formatted response

**No manual URL/header management needed!** 🚀

