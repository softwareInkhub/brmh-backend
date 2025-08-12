# 🔄 Indexing Update System Documentation

## Overview

The indexing update system automatically updates Algolia search indices when data changes in DynamoDB tables. This ensures that search results remain synchronized with the latest data without requiring manual re-indexing.

## Architecture

### Components

1. **Lambda Trigger**: DynamoDB Streams trigger Lambda functions when data changes
2. **Cache Update Handler**: Processes cache updates and triggers indexing updates
3. **Indexing Update Handler**: Manages the actual indexing operations
4. **Configuration Management**: Stores indexing configurations in `brmh-indexing` table

### Data Flow

```
DynamoDB Change → Lambda Trigger → Cache Update → Indexing Update → Algolia Index
```

## API Endpoints

### 1. Indexing Update Endpoint

**POST** `/indexing/update`

Updates search indices when data changes in DynamoDB tables.

**Request Body:**
```json
{
  "type": "INSERT|MODIFY|REMOVE",
  "tableName": "your-table-name",
  "newItem": { /* new/updated item data */ },
  "oldItem": { /* old item data (for MODIFY/REMOVE) */ }
}
```

**Response:**
```json
{
  "message": "Indexing update initiated",
  "tableName": "your-table-name",
  "operationType": "INSERT",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 2. Search Update Endpoint

**POST** `/search/update`

Alternative endpoint for indexing updates (same functionality as `/indexing/update`).

## Configuration Management

### Indexing Configuration Table (`brmh-indexing`)

Each row represents an indexing configuration:

```json
{
  "id": "config-uuid",
  "project": "my-project",
  "table": "shopify-inkhub-get-orders",
  "description": "indexing for orders",
  "customFields": ["customerName", "orderNumber"],
  "status": "active",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### Configuration Fields

- **id**: Unique identifier for the configuration
- **project**: Project name for organizing indices
- **table**: DynamoDB table name to monitor
- **description**: Human-readable description
- **customFields**: Array of custom fields to index
- **status**: "active" or "inactive"
- **createdAt/updatedAt**: Timestamps

## Automatic Update Process

### 1. Data Change Detection

When data changes in DynamoDB:

1. Lambda function is triggered via DynamoDB Streams
2. Lambda sends update to `/cache/update` endpoint
3. Cache is updated via Redis
4. Indexing update is triggered automatically

### 2. Active Configuration Lookup

The system:

1. Queries `brmh-indexing` table for active configurations
2. Filters by table name and status = "active"
3. Processes each configuration found

### 3. Index Update Process

For each active configuration:

1. **Find Latest Index**: Locates the most recent Algolia index for the project/table
2. **Prepare Data**: Enriches item data with metadata and custom fields
3. **Execute Operation**:
   - **INSERT**: Adds new item to index
   - **MODIFY**: Updates existing item in index
   - **REMOVE**: Removes item from index

## Functions

### Core Functions

#### `findActiveIndexingConfigs(tableName)`

Finds all active indexing configurations for a specific table.

```javascript
const configs = await findActiveIndexingConfigs('shopify-inkhub-get-orders');
console.log(`Found ${configs.length} active configurations`);
```

#### `updateIndexingForItem(tableName, item, operationType, oldItem)`

Updates search indices for a specific item.

```javascript
await updateIndexingForItem(
  'shopify-inkhub-get-orders',
  newItem,
  'INSERT'
);
```

#### `updateIndexingFromLambdaHandler(req, res)`

Express handler for processing indexing updates from Lambda triggers.

### Configuration Management Functions

#### `createIndexingConfig(configData)`

Creates a new indexing configuration.

```javascript
const config = await createIndexingConfig({
  project: 'my-project',
  table: 'shopify-inkhub-get-orders',
  description: 'Indexing for orders',
  customFields: ['customerName', 'orderNumber'],
  status: 'active'
});
```

#### `getIndexingConfigsByTable(tableName)`

Retrieves all indexing configurations for a table.

```javascript
const configs = await getIndexingConfigsByTable('shopify-inkhub-get-orders');
```

#### `updateIndexingConfig(configId, updates)`

Updates an existing indexing configuration.

```javascript
await updateIndexingConfig(configId, {
  status: 'inactive',
  description: 'Updated description'
});
```

#### `deleteIndexingConfig(configId)`

Deletes an indexing configuration.

```javascript
await deleteIndexingConfig(configId);
```

## Error Handling

### Graceful Degradation

- If indexing fails, cache updates continue normally
- Errors are logged but don't break the main flow
- Missing Algolia credentials are handled gracefully

### Error Types

1. **Missing Configuration**: No active configurations found for table
2. **Missing Index**: No Algolia indices found for project/table
3. **Algolia Errors**: Network or API errors from Algolia
4. **DynamoDB Errors**: Issues accessing configuration table

## Monitoring and Logging

### Log Messages

The system provides detailed logging:

```
🔍 Finding active indexing configurations for table: shopify-inkhub-get-orders
✅ Found 2 active indexing configurations for table: shopify-inkhub-get-orders
🔄 Updating indexing for table: shopify-inkhub-get-orders, operation: INSERT
✅ Indexed item in my-project_shopify-inkhub-get-orders_1704067200000 (INSERT)
✅ Completed indexing update for table: shopify-inkhub-get-orders
```

### Health Checks

Use the existing search health endpoint:

**GET** `/search/health`

Returns Algolia connection status and index count.

## Testing

### Manual Testing

Use the test script to verify functionality:

```bash
node test-indexing-update.js
```

### API Testing

Test the indexing update endpoint:

```bash
curl -X POST http://localhost:5001/indexing/update \
  -H "Content-Type: application/json" \
  -d '{
    "type": "INSERT",
    "tableName": "shopify-inkhub-get-orders",
    "newItem": {
      "id": "test-123",
      "orderNumber": "ORD-001",
      "customerName": "John Doe"
    }
  }'
```

## Best Practices

### 1. Configuration Management

- Keep configurations organized by project
- Use descriptive names and descriptions
- Monitor configuration status regularly

### 2. Performance

- Use custom fields sparingly
- Monitor index size and performance
- Clean up old indices periodically

### 3. Error Handling

- Monitor logs for indexing errors
- Set up alerts for failed operations
- Have fallback mechanisms for critical data

### 4. Security

- Secure Algolia API keys
- Validate input data
- Monitor access patterns

## Troubleshooting

### Common Issues

1. **No Active Configurations**
   - Check `brmh-indexing` table for configurations
   - Verify table name matches exactly
   - Ensure status is "active"

2. **Missing Indices**
   - Run initial indexing for the table
   - Check Algolia credentials
   - Verify project/table naming

3. **Indexing Failures**
   - Check Algolia API limits
   - Verify item data structure
   - Monitor network connectivity

### Debug Steps

1. Check logs for error messages
2. Verify configuration exists and is active
3. Test Algolia connection manually
4. Validate item data structure
5. Check DynamoDB table permissions

## Future Enhancements

### Planned Features

1. **Batch Processing**: Handle multiple items at once
2. **Retry Logic**: Automatic retry for failed operations
3. **Metrics**: Detailed performance metrics
4. **Webhooks**: Notify external systems of updates
5. **Scheduling**: Time-based indexing strategies

### Performance Optimizations

1. **Connection Pooling**: Reuse Algolia connections
2. **Caching**: Cache configuration lookups
3. **Async Processing**: Non-blocking updates
4. **Batching**: Group multiple updates

## Integration Examples

### Lambda Function Integration

```javascript
// In your Lambda function
const axios = require('axios');

exports.handler = async (event) => {
  for (const record of event.Records) {
    const { eventName, dynamodb } = record;
    
    await axios.post('http://your-api/indexing/update', {
      type: eventName === 'INSERT' ? 'INSERT' : 
            eventName === 'MODIFY' ? 'MODIFY' : 'REMOVE',
      tableName: 'your-table-name',
      newItem: dynamodb.NewImage,
      oldItem: dynamodb.OldImage
    });
  }
};
```

### Frontend Integration

```javascript
// Create indexing configuration
const createConfig = async (config) => {
  const response = await fetch('/api/indexing/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });
  return response.json();
};

// Get configurations for a table
const getConfigs = async (tableName) => {
  const response = await fetch(`/api/indexing/configs?table=${tableName}`);
  return response.json();
};
```

This indexing update system ensures that your search functionality remains synchronized with your data changes, providing a seamless user experience with up-to-date search results. 