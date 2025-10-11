# BRMH Backend - Complete System Documentation

## Overview

The BRMH (Backend Resource Management Hub) is a comprehensive backend system that provides a unified platform for managing APIs, schemas, namespaces, and data operations. The system integrates multiple AWS services, AI-powered agents, caching mechanisms, and file management capabilities to create a powerful development and data management platform.

## System Architecture

### Core Components
- **Express.js API Server**: Main application server with multiple API endpoints
- **AWS DynamoDB**: Primary database for storing namespaces, schemas, and metadata
- **AWS ElastiCache (Valkey)**: High-performance Redis-compatible caching layer
- **AWS Lambda**: Serverless function deployment and execution
- **AWS S3**: File storage for BRMH Drive system and Lambda deployments
- **AWS Cognito**: Authentication and user management
- **AI/LLM Integration**: Anthropic Claude and LangChain for intelligent automation
- **Web Scraping**: Automated API documentation extraction
- **Search Indexing**: Algolia integration for fast data search

### Key Features
- **Unified Namespace Management**: Organize APIs, schemas, and data by project
- **AI-Powered Code Generation**: Generate Lambda functions from natural language
- **Intelligent Caching**: High-performance data caching with duplicate detection
- **File Management System**: Complete drive-like file storage and sharing
- **Authentication System**: OAuth2, phone, and traditional login methods
- **Real-time Notifications**: WebSocket-based event system
- **Mock Data Generation**: AI-generated test data for development
- **API Testing**: Built-in OpenAPI testing and validation

## API Documentation

The system provides comprehensive API documentation through Swagger UI interfaces:

- **AWS DynamoDB API**: `/api/dynamodb` - Direct DynamoDB operations
- **Unified API**: `/unified-api-docs` - Namespace, schema, and method management
- **AI Agent API**: `/ai-agent-docs` - AI-powered code generation and assistance
- **BRMH Drive API**: `/drive-api-docs` - File management and sharing system
- **LLM Service API**: `/llm-api-docs` - Language model integration

## Core Services

### 1. Unified Namespace System
The unified namespace system provides a structured way to organize and manage APIs, schemas, and data:

**Key Components:**
- **Namespaces**: Project containers for organizing related APIs and schemas
- **Schemas**: JSON schema definitions for data validation and generation
- **Methods**: API endpoint definitions with request/response schemas
- **Accounts**: Authentication credentials for external API access
- **Webhooks**: Event-driven integrations and notifications

**API Endpoints:**
```
GET    /unified/namespaces              # List all namespaces
POST   /unified/namespaces              # Create new namespace
GET    /unified/namespaces/{id}         # Get namespace details
PUT    /unified/namespaces/{id}         # Update namespace
DELETE /unified/namespaces/{id}         # Delete namespace

GET    /unified/schemas                 # List schemas
POST   /unified/schemas                 # Create schema
GET    /unified/schemas/{id}            # Get schema details
PUT    /unified/schemas/{id}            # Update schema
DELETE /unified/schemas/{id}            # Delete schema

GET    /unified/namespaces/{id}/methods # Get namespace methods
POST   /unified/namespaces/{id}/methods # Create method
PUT    /unified/methods/{id}            # Update method
DELETE /unified/methods/{id}            # Delete method
```

### 2. AI Agent System
The AI agent system provides intelligent assistance for code generation, schema creation, and development tasks:

**Features:**
- **Natural Language Processing**: Convert user requests into executable code
- **Lambda Code Generation**: Generate AWS Lambda functions from descriptions
- **Schema Analysis**: Intelligent schema generation and validation
- **Workspace Guidance**: Context-aware development assistance
- **Streaming Responses**: Real-time AI interaction with streaming support

**API Endpoints:**
```
POST   /ai-agent                        # Non-streaming AI agent
POST   /ai-agent/stream                 # Streaming AI agent
POST   /ai-agent/lambda-codegen         # Generate Lambda functions
POST   /ai-agent/schema-lambda-generation # Generate from schemas
POST   /ai-agent/workspace-guidance     # Get development guidance
POST   /ai-agent/get-workspace-state    # Get workspace state
POST   /ai-agent/save-workspace-state   # Save workspace state
```

### 3. Lambda Deployment System
Automated AWS Lambda function deployment with comprehensive management:

**Features:**
- **Code Deployment**: Deploy Lambda functions from code
- **Dependency Management**: Automatic package.json handling
- **API Gateway Integration**: Automatic API Gateway creation
- **Environment Configuration**: Environment variable management
- **Metadata Tracking**: Deployment history and versioning

**API Endpoints:**
```
POST   /lambda/deploy                   # Deploy Lambda function
POST   /lambda/deploy-stream            # Streaming deployment
POST   /lambda/invoke                   # Invoke Lambda function
POST   /lambda/cleanup                  # Cleanup temp files
POST   /lambda/create-api-gateway       # Create API Gateway
GET    /lambda/deployments              # List deployments
GET    /lambda/deployments/{id}         # Get deployment details
```

### 4. BRMH Drive System
Complete file management system with sharing capabilities:

**Features:**
- **File Upload/Download**: Support for multiple file types
- **Folder Management**: Hierarchical folder structure
- **Sharing System**: File and folder sharing with permissions
- **S3 Integration**: Scalable cloud storage
- **Namespace Integration**: Project-specific file organization

**API Endpoints:**
```
POST   /drive/upload                    # Upload files
POST   /drive/folder                    # Create folders
GET    /drive/files/{userId}            # List files
GET    /drive/folders/{userId}          # List folders
GET    /drive/contents/{userId}/{folderId} # List folder contents
PATCH  /drive/rename/{userId}/{fileId}  # Rename files
DELETE /drive/file/{userId}/{fileId}    # Delete files
GET    /drive/download/{userId}/{fileId} # Download files
POST   /drive/share/file/{userId}/{fileId} # Share files
GET    /drive/shared/with-me/{userId}   # Get shared files
```

### 5. Authentication System
Comprehensive authentication with multiple methods:

**Features:**
- **OAuth2 Integration**: AWS Cognito OAuth2 with PKCE
- **Phone Authentication**: SMS-based verification
- **Traditional Login**: Email/password authentication
- **Token Management**: JWT token handling and refresh
- **Session Management**: Secure session handling

**API Endpoints:**
```
POST   /auth/login                      # Traditional login
POST   /auth/signup                     # User registration
POST   /auth/phone/signup               # Phone registration
POST   /auth/phone/login                # Phone login
POST   /auth/phone/verify               # Verify phone number
GET    /auth/oauth-url                  # Get OAuth URL
POST   /auth/token                      # Exchange OAuth token
POST   /auth/refresh                    # Refresh token
POST   /auth/validate                   # Validate token
POST   /auth/logout                     # Logout user
```

### 6. Web Scraping System
Automated API documentation extraction and integration:

**Features:**
- **Service Discovery**: Automatic API documentation detection
- **Schema Extraction**: Extract schemas from API docs
- **Namespace Creation**: Automatic namespace setup
- **Data Integration**: Import APIs and schemas into system

**API Endpoints:**
```
GET    /web-scraping/supported-services # Get supported services
POST   /web-scraping/scrape-and-save    # Scrape and save to namespace
POST   /web-scraping/scrape-auto-namespace # Auto-namespace scraping
POST   /web-scraping/scrape-preview     # Preview scraping results
POST   /web-scraping/migrate-existing-namespaces # Migrate existing data
```

### 7. Mock Data Generation
AI-powered mock data generation for development and testing:

**Features:**
- **Schema-based Generation**: Generate data from JSON schemas
- **Context-aware Generation**: Intelligent data based on context
- **Namespace Integration**: Generate data for entire namespaces
- **Customizable Counts**: Control amount of generated data

**API Endpoints:**
```
POST   /mock-data/generate              # Generate mock data
POST   /mock-data/generate-for-schema   # Generate from schema
POST   /mock-data/generate-for-namespace # Generate for namespace
GET    /mock-data/tables                # List available tables
```

### 8. Search and Indexing
Fast search capabilities with Algolia integration:

**Features:**
- **Full-text Search**: Search across all data
- **Index Management**: Automatic index creation and updates
- **Real-time Updates**: Live index updates from data changes
- **Performance Optimization**: Fast search responses

**API Endpoints:**
```
POST   /search/index                    # Index data
POST   /search/query                    # Search data
POST   /search/indices                  # List indices
POST   /search/delete                   # Delete indices
POST   /search/update                   # Update indices
GET    /search/health                   # Search health check
```

## Cache System

The BRMH backend includes a sophisticated caching system built on AWS ElastiCache (Valkey) with Redis-compatible operations.

### Cache Architecture
- **AWS ElastiCache (Valkey)**: Redis-compatible managed caching service
- **DynamoDB**: Primary data source for caching
- **ioredis**: Redis client for Node.js
- **Queue System**: In-memory queue for pending cache updates
- **Non-blocking Operations**: Background processing prevents API blocking

### Cache Key Structure
```
{project}:{tableName}:{identifier}
```

**Examples:**
- Individual items: `my-app:shopify-inkhub-get-products:12345`
- Chunked data: `my-app:shopify-inkhub-get-products:chunk:0`
- Individual items with ID: `my-app:shopify-inkhub-get-products:0000`

### Cache Strategies

#### 1. Individual Item Caching (`recordsPerKey = 1`)
- Each DynamoDB item is cached separately
- Key format: `{project}:{tableName}:{itemId}`
- **Benefits:**
  - Granular access to individual items
  - Better cache hit rates
  - Easy item-level updates/deletes
- **Use case:** When you need frequent access to specific items

#### 2. Chunked Data Caching (`recordsPerKey > 1`)
- Multiple items grouped into chunks
- Key format: `{project}:{tableName}:chunk:{chunkIndex}`
- **Benefits:**
  - Efficient bulk operations
  - Reduced key overhead
  - Better for large datasets
- **Use case:** When you need bulk data retrieval

### Performance Optimizations
- **Non-blocking cache updates**: Background processing prevents API blocking
- **Parallel cache configuration processing**: Multiple configs processed simultaneously
- **Optimized logging**: Reduced verbosity with one-liner status messages
- **Queue system**: Prevents data loss during concurrent bulk operations
- **Enhanced pagination**: Better handling of large datasets with improved limits

## Cache API Endpoints

### Cache Table Data
**POST** `/cache/table`

Caches entire DynamoDB table data with duplicate detection.

**Request Body:**
```json
{
  "project": "my-app",
  "table": "shopify-inkhub-get-products",
  "recordsPerKey": 100,
  "ttl": 3600
}
```

**Response:**
```json
{
  "message": "Caching complete (bounded buffer)",
  "project": "my-app",
  "table": "shopify-inkhub-get-products",
  "totalRecords": 1000,
  "successfulWrites": 850,
  "failedWrites": 0,
  "attemptedKeys": 850,
  "skippedDuplicates": 150,
  "fillRate": "100.00%",
  "durationMs": 5000,
  "cacheKeys": ["key1", "key2"],
  "totalCacheKeys": 850
}
```

### Get Cache Keys
**GET** `/cache/data?project={project}&table={table}`

Retrieves all cache keys for a specific project and table (keys only, no data).

**Response:**
```json
{
  "message": "Cache keys retrieved in sequence (keys only)",
  "keysFound": 132,
  "keys": [
    "my-app:shopify-inkhub-get-products:chunk:0",
    "my-app:shopify-inkhub-get-products:chunk:1"
  ],
  "note": "Use ?key=specific_key to get actual data for a specific key"
}
```

### Get Cache Data in Sequence (Paginated)
**GET** `/cache/data-in-sequence?project={project}&table={table}&page={page}&limit={limit}&includeData={true|false}`

Retrieves cached data with pagination support. By default, returns keys only unless `includeData=true` is specified.

**Parameters:**
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 1000)
- `includeData`: Whether to include actual data (default: false)

**Response (Keys Only - Default):**
```json
{
  "message": "Cache keys retrieved in sequence with pagination (keys only)",
  "keysFound": 100,
  "totalKeys": 132,
  "keys": ["chunk:0", "chunk:1", "chunk:2"],
  "note": "Use ?includeData=true to get actual data for these keys",
  "pagination": {
    "currentPage": 1,
    "totalPages": 2,
    "hasMore": true,
    "totalItems": 132
  }
}
```

**Response (With Data):**
```json
{
  "message": "Cached data retrieved in sequence with pagination",
  "keysFound": 100,
  "totalItems": 10000,
  "keys": ["chunk:0", "chunk:1"],
  "data": [...],
  "pagination": {
    "currentPage": 1,
    "totalPages": 10,
    "hasMore": true,
    "totalItems": 10000
  }
}
```



### Update Cache from Lambda
**POST** `/cache-data`

Updates cache when DynamoDB data changes (triggered by Lambda). This endpoint is non-blocking and processes updates in parallel.

**Request Body:**
```json
{
  "type": "INSERT|MODIFY|REMOVE",
  "newItem": {...},
  "oldItem": {...},
  "extractedTableName": "shopify-inkhub-get-products"
}
```

**Response (Success):**
```json
{
  "message": "Cache update processed",
  "tableName": "shopify-inkhub-get-products",
  "type": "INSERT",
  "totalConfigs": 2,
  "successfulUpdates": 2,
  "failedUpdates": 0,
  "results": [...],
  "durationMs": 150
}
```

**Response (Queued - During Bulk Operation):**
```json
{
  "message": "Cache update queued for later processing",
  "reason": "Bulk cache operation in progress",
  "tableName": "shopify-inkhub-get-products",
  "type": "INSERT",
  "operationKey": "my-app:shopify-inkhub-get-products",
  "queuedUpdates": 3,
  "estimatedWaitTime": "Until bulk cache completes"
}
```

### Queue Management Endpoints

**GET** `/cache/bulk-operations`
Returns currently active bulk cache operations.

**DELETE** `/cache/bulk-operations`
Clears all active bulk cache operation locks (emergency reset).

**GET** `/cache/pending-updates`
Returns the current state of pending updates queue.

**DELETE** `/cache/pending-updates?operationKey={key}`
Clears pending updates for a specific operation key or all pending updates.

## Duplicate Detection & Management

### How It Works
The cache system automatically detects and handles duplicates during insert operations:

1. **Individual Items**: Checks if item ID already exists in cache
2. **Chunked Items**: Scans chunk for duplicate items and filters them out

### Duplicate Handling Strategies

| Scenario | Action | Result |
|----------|--------|---------|
| Individual duplicate item | Skip entirely | Item not cached |
| Chunk with some duplicates | Filter duplicates, cache unique items | Partial chunk cached |
| Chunk with all duplicates | Skip entire chunk | Chunk not cached |
| No duplicates | Cache normally | Full data cached |

### Console Output Examples
```
🔄 Cache INSERT: shopify-inkhub-get-products
✅ Cache INSERT complete: 2/2 success (150ms)
📦 Queued INSERT for my-app:shopify-inkhub-get-products (3 pending)
```

## Configuration

### Environment Variables
```env
REDIS_HOST=your-valkey-endpoint.amazonaws.com
REDIS_PORT=6379
REDIS_TLS=true
REDIS_PASSWORD=your-password
```

### Redis Client Configuration
```javascript
{
  port: parseInt(process.env.REDIS_PORT),
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
  lazyConnect: true,
  connectTimeout: 15000,
  commandTimeout: 15000,
  enableOfflineQueue: true,
  maxRetriesPerRequest: 5
}
```

## Performance Optimizations

### 1. Non-Blocking Operations
- **Background processing**: Cleanup operations run in background using `setImmediate()`
- **Parallel processing**: Multiple cache configurations processed simultaneously
- **Immediate response**: API responds immediately while processing continues
- **No API blocking**: Other endpoints remain responsive during cache updates

### 2. Queue System
- **Concurrency control**: Prevents data loss during concurrent bulk operations
- **In-memory queue**: Pending updates queued when bulk operations are active
- **Automatic processing**: Queued updates processed after bulk operation completes
- **Race condition protection**: Ensures data integrity during high concurrency

### 3. Optimized Logging
- **One-liner messages**: Reduced verbosity with concise status updates
- **No repetitive logs**: Eliminated duplicate and verbose logging
- **Performance tracking**: Duration and success rate logging
- **Clean PM2 logs**: Minimal noise in production logs

### 4. Enhanced Pagination
- **Improved limits**: Default limit increased from 10 to 1000
- **Keys-only default**: Returns keys by default to prevent timeouts
- **Explicit data retrieval**: Data only fetched when `includeData=true`
- **Better pagination info**: Enhanced pagination metadata

### 5. Bounded Buffer
- Processes data in chunks to manage memory usage
- Writes chunks as soon as buffer is full
- Prevents memory overflow with large datasets

### 6. SCAN vs KEYS
- Uses `SCAN` command for Valkey compatibility
- Avoids blocking operations on large datasets
- Supports pattern matching for key retrieval

### 7. Sequential Chunking
- Chunks are numbered sequentially (chunk:0, chunk:1, etc.)
- Enables efficient data retrieval in order
- Supports pagination for large datasets

## Error Handling

### Common Errors & Solutions

1. **Connection Timeout**
   ```
   Error: connect ETIMEDOUT
   ```
   **Solution:** Check security groups and network ACLs

2. **Unknown Command**
   ```
   ReplyError: ERR unknown command 'keys'
   ```
   **Solution:** Use `SCAN` instead of `KEYS` for Valkey

3. **Stream Not Writable**
   ```
   Error: Stream isn't writeable and enableOfflineQueue options is false
   ```
   **Solution:** Enable offline queue in Redis configuration

4. **Cache Update Queued**
   ```
   Status: 202 Accepted
   Message: "Cache update queued for later processing"
   ```
   **Solution:** This is normal during bulk operations. Updates will be processed automatically.

5. **Gateway Timeout (504)**
   ```
   Error: 504 Gateway Timeout
   ```
   **Solution:** Use pagination or set `includeData=false` for large datasets

## Monitoring & Debugging

### Cache Health Check
**GET** `/test-valkey-connection`

Tests connectivity to Valkey cache.

### Cache Cleanup
**POST** `/cache/cleanup-timestamp-chunks`

Converts timestamp-based chunks to sequential numbering.

**POST** `/cache/clear-unwanted-order-data`

Removes non-cache-config data from cache table.

### Queue Management
**GET** `/cache/bulk-operations`

Check currently active bulk cache operations.

**GET** `/cache/pending-updates`

View pending cache updates in queue.

## Best Practices

### 1. Cache Strategy Selection
- Use individual caching for frequently accessed specific items
- Use chunked caching for bulk data operations
- Consider data access patterns when choosing strategy

### 2. TTL Management
- Set appropriate TTL based on data freshness requirements
- Monitor cache hit rates and adjust TTL accordingly
- Use longer TTL for stable data, shorter for frequently changing data

### 3. Memory Management
- Monitor cache size and memory usage
- Implement cache eviction policies if needed
- Use bounded buffer for large dataset processing

### 4. Performance Optimization
- Use `includeData=false` for key-only operations to prevent timeouts
- Leverage pagination for large datasets
- Monitor queue status during high concurrency periods
- Use parallel processing for multiple cache configurations

### 5. Error Recovery
- Implement retry logic for failed cache operations
- Log cache errors for debugging
- Have fallback mechanisms for cache failures
- Monitor queue system for stuck operations

## Example Usage

### Frontend Integration
```javascript
// Cache a table
const cacheTable = async (tableName) => {
  const response = await fetch('/cache/table', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project: 'my-app',
      table: tableName,
      recordsPerKey: 100,
      ttl: 3600
    })
  });
  return response.json();
};

// Get cache keys only (fast, no data)
const getCacheKeys = async (tableName) => {
  const response = await fetch(
    `/cache/data-in-sequence?project=my-app&table=${tableName}&page=1&limit=1000`
  );
  return response.json();
};

// Get cached data with pagination
const getCachedData = async (tableName, page = 1, limit = 100) => {
  const response = await fetch(
    `/cache/data-in-sequence?project=my-app&table=${tableName}&page=${page}&limit=${limit}&includeData=true`
  );
  return response.json();
};

// Get specific cache key data
const getSpecificCacheData = async (tableName, key) => {
  const response = await fetch(
    `/cache/data?project=my-app&table=${tableName}&key=${key}`
  );
  return response.json();
};
```

### Monitoring Cache Performance
```javascript
// Check cache keys and counts
const getCacheKeys = async (tableName) => {
  const response = await fetch(
    `/cache/data?project=my-app&table=${tableName}`
  );
  return response.json();
};

// Monitor queue status
const getQueueStatus = async () => {
  const [bulkOps, pendingUpdates] = await Promise.all([
    fetch('/cache/bulk-operations').then(r => r.json()),
    fetch('/cache/pending-updates').then(r => r.json())
  ]);
  return { bulkOps, pendingUpdates };
};
```

## Troubleshooting

### Cache Not Updating
1. Check Lambda trigger configuration
2. Verify DynamoDB stream settings
3. Ensure cache update endpoint is accessible
4. Check queue status for stuck operations

### Performance Issues
1. Monitor cache hit rates
2. Check for memory pressure
3. Optimize chunk sizes based on data patterns
4. Use `includeData=false` for key-only operations
5. Monitor queue system during high concurrency

### Data Inconsistency
1. Verify TTL settings
2. Check for cache invalidation logic
3. Monitor duplicate detection logs
4. Check for queued updates that haven't been processed

### Timeout Issues
1. Use pagination for large datasets
2. Set `includeData=false` for key-only operations
3. Increase API Gateway timeout limits
4. Monitor cache update queue status

## Installation and Setup

### Prerequisites
- Node.js 18.x or higher
- AWS CLI configured with appropriate permissions
- AWS DynamoDB, ElastiCache, S3, Lambda, and Cognito services
- Redis/Valkey instance for caching

### Environment Variables
```env
# AWS Configuration
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1

# Database Configuration
DYNAMODB_TABLE_NAME=your-table-name
S3_BUCKET_NAME=your-bucket-name

# Cache Configuration
REDIS_HOST=your-valkey-endpoint.amazonaws.com
REDIS_PORT=6379
REDIS_TLS=true
REDIS_PASSWORD=your-password

# Authentication Configuration
AWS_COGNITO_DOMAIN=your-cognito-domain
AWS_COGNITO_CLIENT_ID=your-client-id
AUTH_REDIRECT_URI=http://localhost:3000/auth/callback
AUTH_LOGOUT_REDIRECT_URI=http://localhost:3000

# AI/LLM Configuration
ANTHROPIC_API_KEY=your-anthropic-key
ALGOLIA_APP_ID=your-algolia-app-id
ALGOLIA_API_KEY=your-algolia-key

# Application Configuration
NODE_ENV=production
PORT=5001
CRUD_API_BASE_URL=http://localhost:5001
```

### Installation Steps
1. **Clone the repository:**
   ```bash
   git clone https://github.com/softwareInkhub/brmh-backend.git
   cd brmh-backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start the application:**
   ```bash
   # Development
   npm run dev
   
   # Production
   npm start
   ```

5. **Using PM2 (Production):**
   ```bash
   npm install -g pm2
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup
   ```

## Project Structure

```
brmh-backend/
├── lib/                          # Core library modules
│   ├── ai-agent-handlers.js      # AI agent request handlers
│   ├── dynamodb-client.js        # DynamoDB client configuration
│   ├── dynamodb-handlers.js      # DynamoDB operation handlers
│   ├── file-operations.js        # File operation utilities
│   ├── lambda-deployment.js      # Lambda deployment manager
│   ├── llm-agent-system.js       # LLM integration system
│   ├── mock-data-agent.js        # Mock data generation
│   ├── unified-handlers.js       # Unified API handlers
│   ├── unified-types.js          # Type definitions
│   └── web-scraping-agent.js     # Web scraping functionality
├── utils/                        # Utility modules
│   ├── brmh-auth.js              # Authentication utilities
│   ├── brmh-drive.js             # File management system
│   ├── cache.js                  # Cache management
│   ├── crud.js                   # CRUD operations
│   ├── execute.js                # Execution handlers
│   ├── fetchOrder.js             # Order fetching utilities
│   ├── notifications.js          # Notification system
│   └── search-indexing.js        # Search and indexing
├── swagger/                      # API documentation
│   ├── ai-agent-api.yaml         # AI agent API spec
│   ├── aws-dynamodb.yaml         # DynamoDB API spec
│   ├── brmh-drive-api.yaml       # Drive API spec
│   ├── brmh-llm-service.yaml     # LLM service API spec
│   ├── llm-memory-api.yaml       # Memory API spec
│   └── unified-api.yaml          # Unified API spec
├── scripts/                      # Utility scripts
│   ├── cleanup-logs.sh           # Log cleanup
│   ├── manage-logs.sh            # Log management
│   ├── setup-aws-resources.js    # AWS resource setup
│   ├── setup-notify-demo.js      # Notification demo
│   └── test-notify.js            # Notification testing
├── middleware/                   # Express middleware
│   └── errorHandler.js           # Error handling middleware
├── workspaces/                   # Workspace configurations
├── temp/                         # Temporary files
├── index.js                      # Main application entry point
├── executionHandler.js           # Execution logging
├── ecosystem.config.js           # PM2 configuration
└── package.json                  # Dependencies and scripts
```

## Development

### Available Scripts
```bash
npm start              # Start production server
npm run dev            # Start development server with nodemon
npm run build          # Install production dependencies
npm run setup-memory   # Setup memory table
npm run check-namespaces # Check namespace configurations
```

### Code Style and Standards
- Use ES6+ modules (import/export)
- Follow async/await patterns
- Implement proper error handling
- Use TypeScript-style JSDoc comments
- Follow RESTful API conventions

### Testing
```bash
# Run tests (when available)
npm test

# Test specific endpoints
curl -X GET http://localhost:5001/test
curl -X GET http://localhost:5001/test-valkey-connection
```

## Deployment

### AWS Resources Required
- **DynamoDB Tables**: For storing application data
- **ElastiCache Cluster**: For caching (Valkey/Redis)
- **S3 Buckets**: For file storage and Lambda deployments
- **Lambda Functions**: For serverless execution
- **Cognito User Pool**: For authentication
- **API Gateway**: For API management (optional)

### Production Considerations
- Use environment-specific configurations
- Implement proper logging and monitoring
- Set up health checks and alerts
- Configure auto-scaling for high availability
- Implement backup and disaster recovery
- Use AWS CloudFormation or Terraform for infrastructure

## Monitoring and Logging

### Health Checks
- **Application Health**: `GET /test`
- **Cache Health**: `GET /cache/health`
- **Search Health**: `GET /search/health`
- **Valkey Connection**: `GET /test-valkey-connection`

### Logging
- Application logs are managed through PM2
- Log files are located in `/home/ubuntu/.pm2/logs/`
- Use log management scripts for cleanup and rotation

### Performance Monitoring
- Monitor cache hit rates and performance
- Track API response times
- Monitor Lambda function execution
- Set up CloudWatch alarms for critical metrics

## Troubleshooting

### Common Issues

1. **Cache Connection Issues**
   - Check Redis/Valkey endpoint configuration
   - Verify security groups and network ACLs
   - Test connection with `/test-valkey-connection`

2. **Authentication Problems**
   - Verify Cognito configuration
   - Check OAuth redirect URIs
   - Validate JWT tokens

3. **Lambda Deployment Failures**
   - Check IAM permissions
   - Verify S3 bucket access
   - Review function code and dependencies

4. **Database Connection Issues**
   - Verify DynamoDB table permissions
   - Check AWS credentials
   - Validate table names and regions

### Debug Endpoints
- **Cache Debug**: `GET /cache/debug/{project}/{table}/{key}`
- **Orders Debug**: `GET /orders/debug`
- **PKCE Debug**: `GET /auth/debug-pkce`

## Support

For issues and support:
1. Check console logs for detailed error messages
2. Review this documentation for common solutions
3. Test with debug endpoints
4. Monitor system health and performance
5. Contact the development team for complex issues

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the ISC License - see the package.json file for details.
