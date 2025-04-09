# Namespace Account & Method Documentation

## Namespace Accounts

### Update Namespace Account
Updates an existing account with new configuration.

#### Endpoint
```
PUT /api/accounts/{accountId}
```

#### Path Parameters
- `accountId` (string, required): The unique identifier of the account to update

#### Request Body
```json
{
  "namespace-account-name": "updated-store",
  "namespace-account-url-override": "https://updated-store.myshopify.com",
  "namespace-account-header": [
    {
      "key": "X-API-Key",
      "value": "updated-api-key"
    }
  ],
  "variables": [
    {
      "key": "store_id",
      "value": "54321"
    }
  ],
  "tags": ["production"]
}
```

#### Request Body Parameters
- `namespace-account-name` (string, required): Display name for the account
- `namespace-account-url-override` (string, optional): Custom URL to override the namespace base URL
- `namespace-account-header` (array, optional): Custom headers for API authentication
  - `key` (string): Header name
  - `value` (string): Header value
- `variables` (array, optional): Custom variables for this account
  - `key` (string): Variable name
  - `value` (string): Variable value
- `tags` (array, optional): Tags for filtering and organizing accounts

#### Response (200 OK)
```json
{
  "namespace-id": "abc123",
  "namespace-account-id": "def456",
  "namespace-account-name": "updated-store",
  "namespace-account-url-override": "https://updated-store.myshopify.com",
  "namespace-account-header": [
    {
      "key": "X-API-Key",
      "value": "updated-api-key"
    }
  ],
  "variables": [
    {
      "key": "store_id",
      "value": "54321"
    }
  ],
  "tags": ["production"]
}
```

#### Error Responses
- 400 Bad Request: Invalid request body
- 404 Not Found: Account ID does not exist
- 500 Internal Server Error: Server-side error

## Namespace Methods

### Update Namespace Method
Updates an existing method with new configuration.

#### Endpoint
```
PUT /api/methods/{methodId}
```

#### Path Parameters
- `methodId` (string, required): The unique identifier of the method to update

#### Request Body
```json
{
  "namespace-method-name": "updateProduct",
  "namespace-method-type": "PUT",
  "namespace-method-url-override": "/admin/api/products/{id}.json",
  "namespace-method-queryParams": [
    {
      "key": "fields",
      "value": "id,title,variants"
    }
  ],
  "namespace-method-header": [
    {
      "key": "Content-Type",
      "value": "application/json"
    }
  ],
  "save-data": true,
  "isInitialized": true,
  "tags": ["products", "update"],
  "sample-request": {
    "product": {
      "title": "Updated Product"
    }
  },
  "sample-response": {
    "product": {
      "id": 123,
      "title": "Updated Product"
    }
  },
  "request-schema": {},
  "response-schema": {}
}
```

#### Request Body Parameters
- `namespace-method-name` (string, required): Display name for the method
- `namespace-method-type` (string, required): HTTP method (GET, POST, PUT, DELETE, etc.)
- `namespace-method-url-override` (string, optional): Path to append to the base URL
- `namespace-method-queryParams` (array, optional): Default query parameters
  - `key` (string): Parameter name
  - `value` (string): Parameter value
- `namespace-method-header` (array, optional): Default headers
  - `key` (string): Header name
  - `value` (string): Header value
- `save-data` (boolean, optional): Whether to save response data
- `isInitialized` (boolean, optional): Whether this method has been initialized
- `tags` (array, optional): Tags for filtering and organizing methods
- `sample-request` (object, optional): Example request payload
- `sample-response` (object, optional): Example response payload
- `request-schema` (object, optional): JSON schema for request validation
- `response-schema` (object, optional): JSON schema for response validation

#### Response (200 OK)
```json
{
  "namespace-id": "abc123",
  "namespace-method-id": "mth789",
  "namespace-method-name": "updateProduct",
  "namespace-method-type": "PUT",
  "namespace-method-url-override": "/admin/api/products/{id}.json",
  "namespace-method-queryParams": [
    {
      "key": "fields",
      "value": "id,title,variants"
    }
  ],
  "namespace-method-header": [
    {
      "key": "Content-Type",
      "value": "application/json"
    }
  ],
  "save-data": true,
  "isInitialized": true,
  "tags": ["products", "update"],
  "sample-request": {
    "product": {
      "title": "Updated Product"
    }
  },
  "sample-response": {
    "product": {
      "id": 123,
      "title": "Updated Product"
    }
  },
  "request-schema": {},
  "response-schema": {}
}
```

#### Error Responses
- 400 Bad Request: Invalid request body
- 404 Not Found: Method ID does not exist
- 500 Internal Server Error: Server-side error

## Implementation Examples

### Update Account Example
```javascript
// Example using fetch API
const updateAccount = async (accountId, accountData) => {
  try {
    const response = await fetch(`/api/accounts/${accountId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(accountData)
    });
    
    if (!response.ok) {
      throw new Error(`Error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Failed to update account:', error);
    throw error;
  }
};

// Example usage
updateAccount('def456', {
  "namespace-account-name": "updated-store",
  "namespace-account-url-override": "https://updated-store.myshopify.com",
  "namespace-account-header": [
    {
      "key": "X-API-Key",
      "value": "updated-api-key"
    }
  ],
  "variables": [
    {
      "key": "store_id",
      "value": "54321"
    }
  ],
  "tags": ["production"]
}).then(updatedAccount => {
  console.log('Account updated:', updatedAccount);
});
```

### Update Method Example
```javascript
// Example using fetch API
const updateMethod = async (methodId, methodData) => {
  try {
    const response = await fetch(`/api/methods/${methodId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(methodData)
    });
    
    if (!response.ok) {
      throw new Error(`Error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Failed to update method:', error);
    throw error;
  }
};

// Example usage
updateMethod('mth789', {
  "namespace-method-name": "updateProduct",
  "namespace-method-type": "PUT",
  "namespace-method-url-override": "/admin/api/products/{id}.json",
  "namespace-method-queryParams": [
    {
      "key": "fields",
      "value": "id,title,variants"
    }
  ],
  "namespace-method-header": [
    {
      "key": "Content-Type",
      "value": "application/json"
    }
  ],
  "save-data": true,
  "isInitialized": true,
  "tags": ["products", "update"],
  "sample-request": {
    "product": {
      "title": "Updated Product"
    }
  },
  "sample-response": {
    "product": {
      "id": 123,
      "title": "Updated Product"
    }
  }
}).then(updatedMethod => {
  console.log('Method updated:', updatedMethod);
});
```

## Best Practices

### Updating Accounts
1. **Preserve Existing Configuration**: Only include fields you want to change
2. **Maintain Security**: Be careful when updating authentication headers
3. **Test After Updates**: Verify the account still works correctly after changes
4. **Use Descriptive Names**: Choose clear names that reflect the account's purpose
5. **Consider Variables**: Use variables for values that might change between environments

### Updating Methods
1. **Test Method Changes**: Always validate method changes with a test request
2. **Update Sample Data**: Keep sample request/response payloads up to date
3. **Version Control**: Consider adding version information in tags
4. **Path Parameters**: Use consistent syntax for path parameters (e.g., `{id}`)
5. **Documentation**: Update sample requests when changing the method signature
