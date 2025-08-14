# Mock Data Agent Documentation

## Overview
The Mock Data Agent is an AI-powered system that generates realistic mock data for your CRUD engine. It integrates with your existing DynamoDB tables and can generate data based on JSON schemas or existing table structures.

## Features

### 🎯 **Smart Data Generation**
- Generates realistic, business-appropriate mock data
- Respects JSON schema constraints and data types
- Creates varied data sets with realistic values
- Supports custom context for domain-specific data

### 🔗 **CRUD Integration**
- Seamlessly integrates with your existing CRUD endpoints
- Uses the `/crud` endpoint for data insertion
- Supports batch operations for large datasets
- Handles errors gracefully with detailed reporting

### 📊 **Schema Awareness**
- Automatically detects table schemas from `brmh-schemas` table
- Falls back to schema inference from existing data
- Supports custom schema definitions
- Validates data against schema requirements

### 🏢 **Namespace Support**
- Generate data for entire namespaces
- Multi-table data generation
- Context-aware data relationships
- Bulk operations across related tables

## API Endpoints

### 1. Generate Mock Data for Table
```http
POST /mock-data/generate
Content-Type: application/json

{
  "tableName": "users",
  "count": 10,
  "context": "E-commerce user management"
}
```

**Response:**
```json
{
  "success": true,
  "result": "Generated 10 realistic user records and inserted them into the users table..."
}
```

### 2. Generate Mock Data for Schema
```http
POST /mock-data/generate-for-schema
Content-Type: application/json

{
  "schema": {
    "type": "object",
    "properties": {
      "id": { "type": "string" },
      "name": { "type": "string" },
      "email": { "type": "string" },
      "age": { "type": "number" }
    },
    "required": ["id", "name", "email"]
  },
  "tableName": "customers",
  "count": 5,
  "context": "Customer relationship management"
}
```

### 3. Generate Mock Data for Namespace
```http
POST /mock-data/generate-for-namespace
Content-Type: application/json

{
  "namespaceId": "ns-12345",
  "count": 20,
  "context": "Inventory management system"
}
```

### 4. List Available Tables
```http
GET /mock-data/tables
```

**Response:**
```json
{
  "success": true,
  "result": "Available tables: users, products, orders, customers..."
}
```

## Usage Examples

### Example 1: Generate User Data
```javascript
// Generate 50 realistic user records
const response = await fetch('http://localhost:5001/mock-data/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tableName: 'users',
    count: 50,
    context: 'Social media platform users'
  })
});

const result = await response.json();
console.log(result);
```

### Example 2: Generate Product Data
```javascript
// Generate product data with custom schema
const productSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    price: { type: "number" },
    category: { type: "string" },
    inStock: { type: "boolean" },
    description: { type: "string" }
  },
  required: ["id", "name", "price"]
};

const response = await fetch('http://localhost:5001/mock-data/generate-for-schema', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    schema: productSchema,
    tableName: 'products',
    count: 100,
    context: 'E-commerce product catalog'
  })
});
```

### Example 3: Generate Data for Entire Namespace
```javascript
// Generate data for all tables in a namespace
const response = await fetch('http://localhost:5001/mock-data/generate-for-namespace', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    namespaceId: 'ns-ecommerce',
    count: 25,
    context: 'Complete e-commerce system with users, products, orders, and payments'
  })
});
```

## Data Generation Capabilities

### 🔤 **Text Data**
- Realistic names (first names, last names, full names)
- Email addresses with proper formatting
- Phone numbers with country codes
- Addresses with street, city, state, zip
- Company names and job titles
- Product names and descriptions

### 📅 **Date & Time**
- Current dates and historical dates
- Timestamps with proper formatting
- Age calculations based on birth dates
- Expiration dates and renewal dates

### 🔢 **Numeric Data**
- Realistic prices and currency values
- Age ranges appropriate for context
- Quantities and inventory numbers
- Ratings and scores (1-5, 1-10, etc.)
- Percentages and probabilities

### ✅ **Boolean Data**
- Active/inactive status
- In stock/out of stock
- Verified/unverified accounts
- Premium/standard memberships

### 🆔 **ID Generation**
- UUID generation for unique identifiers
- Sequential IDs when appropriate
- Custom ID formats based on context
- Foreign key relationships

## Integration with Your CRUD Engine

### How It Works
1. **Schema Detection**: Agent reads schema from `brmh-schemas` table
2. **Data Generation**: AI generates realistic data based on schema
3. **CRUD Insertion**: Uses your existing `/crud` endpoint to insert data
4. **Batch Processing**: Handles large datasets efficiently
5. **Error Handling**: Reports success/failure for each operation

### CRUD Endpoint Usage
The agent uses your existing CRUD endpoint:
```http
POST /crud?tableName=users
Content-Type: application/json

{
  "item": {
    "id": "uuid-123",
    "name": "John Doe",
    "email": "john.doe@example.com",
    "age": 32,
    "isActive": true
  }
}
```

## Error Handling

### Common Errors
- **Table Not Found**: Returns 404 if table doesn't exist
- **Schema Not Found**: Falls back to data inference
- **Invalid Schema**: Returns validation errors
- **Insertion Failed**: Reports which items failed and why

### Error Response Format
```json
{
  "success": false,
  "error": "Table 'nonexistent-table' not found",
  "details": "ResourceNotFoundException: Table does not exist"
}
```

## Testing

### Run the Test Script
```bash
cd brmh-backend
node test-mock-agent.js
```

### Manual Testing
```bash
# Test table listing
curl http://localhost:5001/mock-data/tables

# Test data generation
curl -X POST http://localhost:5001/mock-data/generate \
  -H "Content-Type: application/json" \
  -d '{"tableName": "users", "count": 5}'
```

## Configuration

### Environment Variables
- `ANTHROPIC_API_KEY`: Required for AI data generation
- `AWS_REGION`: DynamoDB region (default: us-east-1)
- `AWS_ACCESS_KEY_ID`: AWS credentials
- `AWS_SECRET_ACCESS_KEY`: AWS credentials

### Batch Size Configuration
- Default batch size: 10 items per batch
- Configurable via `batchSize` parameter
- Optimized for DynamoDB write capacity

## Best Practices

### 1. **Context Matters**
- Provide detailed context for better data generation
- Include domain-specific information
- Specify business rules and constraints

### 2. **Schema Design**
- Use clear, descriptive field names
- Include appropriate data types
- Mark required fields properly

### 3. **Batch Operations**
- Use appropriate batch sizes for your use case
- Monitor DynamoDB write capacity
- Handle errors gracefully

### 4. **Data Validation**
- Validate generated data against schemas
- Check for data consistency
- Verify business rules are followed

## Troubleshooting

### Common Issues

1. **"Table not found"**
   - Ensure table exists in DynamoDB
   - Check table name spelling
   - Verify AWS credentials

2. **"Schema not found"**
   - Check `brmh-schemas` table
   - Ensure schema is properly saved
   - Use custom schema if needed

3. **"AI generation failed"**
   - Check `ANTHROPIC_API_KEY`
   - Verify internet connection
   - Check API rate limits

4. **"CRUD insertion failed"**
   - Check DynamoDB permissions
   - Verify table key schema
   - Check for required fields

### Debug Mode
Enable verbose logging by setting:
```javascript
// In mock-data-agent.js
verbose: true
```

## Future Enhancements

### Planned Features
- **Data Relationships**: Generate related data across tables
- **Custom Data Types**: Support for complex data structures
- **Data Export**: Export generated data to various formats
- **Template System**: Save and reuse data generation templates
- **Real-time Monitoring**: Track data generation progress
- **Data Quality Metrics**: Measure realism and variety of generated data

### Integration Opportunities
- **Frontend UI**: Web interface for data generation
- **Scheduled Jobs**: Automated data generation
- **Data Validation**: Real-time schema validation
- **Performance Metrics**: Monitor generation speed and quality 