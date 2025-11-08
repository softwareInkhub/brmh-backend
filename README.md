# BRMH Project - Comprehensive Architecture Guide

## 🎯 Project Overview

BRMH (Business Resource Management Hub) is a comprehensive API integration and data management platform that provides:

- **Unified API Management**: Organize external APIs into namespaces with accounts and methods
- **Data Synchronization**: Fetch, cache, and sync data from external APIs with pagination support
- **File Management**: Google Drive-like file storage system with S3 integration
- **AI Agent System**: Automated data processing, web scraping, and mock data generation
- **Real-time Caching**: Redis/Valkey-based caching with DynamoDB integration
- **Search & Indexing**: Algolia-powered search across all data
- **Notification System**: Multi-channel notifications (WhatsApp, Email, Push)

## 🏗️ Core Architecture

### 1. Namespace Structure

The BRMH system is organized around a hierarchical **Namespace → Account → Method** structure:

```
Namespace (e.g., "Shopify")
├── Account (e.g., "Production Store", "Test Store")
│   ├── Method (e.g., "Get Orders", "Create Product")
│   ├── Method (e.g., "Update Customer", "Delete Order")
│   └── Method (e.g., "Get Analytics")
└── Account (e.g., "Development Store")
    ├── Method (e.g., "Get Orders", "Create Product")
    └── Method (e.g., "Test Webhook")
```

#### Namespace
- **Purpose**: Groups related APIs (e.g., Shopify, Stripe, Google APIs)
- **Properties**: `namespace-id`, `namespace-name`, `namespace-url`, `tags`
- **Example**: `{ "namespace-name": "Shopify", "namespace-url": "https://api.shopify.com" }`

#### Account
- **Purpose**: Represents different instances/credentials within a namespace
- **Properties**: `namespace-account-name`, `namespace-account-url-override`, `namespace-account-header`, `variables`, `tags`
- **Example**: `{ "namespace-account-name": "Production Store", "namespace-account-header": [{"key": "Authorization", "value": "Bearer token123"}] }`

#### Method
- **Purpose**: Defines specific API endpoints and operations
- **Properties**: `namespace-method-name`, `namespace-method-type`, `namespace-method-url-override`, `namespace-method-header`, `namespace-method-queryParams`, `namespace-method-body`
- **Example**: `{ "namespace-method-name": "Get Orders", "namespace-method-type": "GET", "namespace-method-url-override": "/admin/api/2023-10/orders.json" }`

### 2. Data Flow Architecture

```
External API → Namespace Method → Account Credentials → Unified Handler → DynamoDB/S3/Cache
```

## 📡 API Endpoints Structure

### Core API Routes

#### Namespace Management
```bash
GET    /unified/namespaces                    # List all namespaces
POST   /unified/namespaces                    # Create namespace
GET    /unified/namespaces/{namespaceId}      # Get namespace details
PUT    /unified/namespaces/{namespaceId}      # Update namespace
DELETE /unified/namespaces/{namespaceId}      # Delete namespace
```

#### Account Management
```bash
GET    /unified/namespaces/{namespaceId}/accounts     # List namespace accounts
POST   /unified/namespaces/{namespaceId}/accounts     # Create account
GET    /unified/accounts/{accountId}                  # Get account details
PUT    /unified/accounts/{accountId}                  # Update account
DELETE /unified/accounts/{accountId}                  # Delete account
```

#### Method Management
```bash
GET    /unified/namespaces/{namespaceId}/methods      # List namespace methods
POST   /unified/namespaces/{namespaceId}/methods      # Create method
GET    /unified/methods/{methodId}                    # Get method details
PUT    /unified/methods/{methodId}                    # Update method
DELETE /unified/methods/{methodId}                    # Delete method
```

#### Execution & Data Operations
```bash
POST   /unified/execute                           # Execute namespace request
POST   /unified/execute/paginated                 # Execute with pagination
POST   /execute                                   # Legacy execute endpoint
```

#### Caching System
```bash
GET    /cache/data                               # Get cached data
POST   /cache/table                              # Cache table data
DELETE /cache/clear                              # Clear cache
GET    /cache/stats                              # Cache statistics
```

#### File Management (BRMH Drive)
```bash
POST   /drive/upload                             # Upload file
GET    /drive/files/{userId}                     # List user files
GET    /drive/download/{userId}/{fileId}         # Download file
POST   /drive/folder                             # Create folder
DELETE /drive/file/{userId}/{fileId}             # Delete file
```

#### Schema Management
```bash
GET    /unified/schema                           # List schemas
POST   /unified/schema                           # Save schema
GET    /unified/schema/{schemaId}                # Get schema
PUT    /unified/schema/{schemaId}                # Update schema
DELETE /unified/schema/{schemaId}                # Delete schema
```

## 🔧 Technical Implementation

### Backend Stack
- **Runtime**: Node.js with Express.js
- **Database**: AWS DynamoDB (primary data store)
- **File Storage**: AWS S3 (file management)
- **Caching**: Redis/Valkey (ElastiCache)
- **Search**: Algolia (indexing and search)
- **Authentication**: AWS Cognito SSO
- **Deployment**: EC2 with PM2 process manager

### Frontend Stack
- **Framework**: Next.js 14 with React 18
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: Radix UI
- **State Management**: Zustand
- **Data Fetching**: React Query
- **Authentication**: NextAuth.js

### Key Files Structure

#### Backend (`brmh-backend/`)
```
├── index.js                          # Main Express server
├── lib/
│   ├── unified-handlers.js           # Core namespace/account/method handlers
│   ├── ai-agent-handlers.js          # AI agent system
│   ├── dynamodb-handlers.js          # DynamoDB operations
│   └── llm-agent-system.js           # LLM integration
├── utils/
│   ├── execute.js                    # Data execution and pagination
│   ├── cache.js                      # Caching system
│   ├── crud.js                       # CRUD operations
│   ├── brmh-drive.js                 # File management system
│   └── search-indexing.js            # Search indexing
├── swagger/                          # OpenAPI specifications
└── middleware/                       # Express middleware
```

#### Frontend (`brmh-frontend-v2/`)
```
├── app/
│   ├── namespace/                    # Namespace management UI
│   ├── aws/                          # AWS services management
│   ├── components/                   # Reusable components
│   ├── lib/                          # Utility functions
│   └── types/                        # TypeScript definitions
└── hooks/                            # Custom React hooks
```

## 🚀 Key Features

### 1. Unified API Management
- **Namespace Organization**: Group related APIs logically
- **Account Management**: Handle multiple credentials per namespace
- **Method Definition**: Define API endpoints with full configuration
- **Dynamic Execution**: Execute API calls with runtime parameter injection

### 2. Data Synchronization
- **Pagination Support**: Handle paginated APIs (Shopify, Stripe, etc.)
- **Execution Modes**: 
  - `get-all`: Fetch all data (overwrites existing)
  - `sync`: Incremental sync (skips existing items)
- **Live Progress**: Real-time console logging of sync progress
- **Auto-stop Logic**: Stop on first existing item or after 2000 matches

### 3. Caching System
- **Redis/Valkey Integration**: High-performance caching
- **Chunked Storage**: Handle large datasets efficiently
- **TTL Management**: Automatic cache expiration
- **Metadata Tracking**: Data length, size, and type information

### 4. File Management (BRMH Drive)
- **S3 Integration**: Secure file storage
- **User Isolation**: Separate storage per user
- **Folder Structure**: Hierarchical organization
- **Presigned URLs**: Secure file access

### 5. AI Agent System
- **Web Scraping**: Automated data extraction
- **Mock Data Generation**: Generate test data
- **Lambda Code Generation**: Create serverless functions
- **Intent Detection**: Understand user requests

### 6. Search & Indexing
- **Algolia Integration**: Full-text search
- **Automatic Sync**: DynamoDB stream integration
- **Configurable Indexing**: Per-table indexing control

## 📊 Data Models

### DynamoDB Tables

#### Namespaces Table
```json
{
  "namespace-id": "uuid",
  "namespace-name": "Shopify",
  "namespace-url": "https://api.shopify.com",
  "tags": ["ecommerce", "api"],
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

#### Accounts Table
```json
{
  "account-id": "uuid",
  "namespace-id": "uuid",
  "namespace-account-name": "Production Store",
  "namespace-account-url-override": "https://mystore.myshopify.com",
  "namespace-account-header": [
    {"key": "Authorization", "value": "Bearer token123"}
  ],
  "variables": [
    {"key": "store_id", "value": "12345"}
  ],
  "tags": ["production"],
  "createdAt": "timestamp"
}
```

#### Methods Table
```json
{
  "method-id": "uuid",
  "namespace-id": "uuid",
  "namespace-method-name": "Get Orders",
  "namespace-method-type": "GET",
  "namespace-method-url-override": "/admin/api/2023-10/orders.json",
  "namespace-method-header": [
    {"key": "Content-Type", "value": "application/json"}
  ],
  "namespace-method-queryParams": {
    "limit": "50",
    "status": "any"
  },
  "namespace-method-body": {},
  "tags": ["orders", "read"],
  "createdAt": "timestamp"
}
```

## 🔄 Execution Flow

### 1. Namespace Request Execution
```javascript
// Example: Execute a Shopify order fetch
POST /unified/execute
{
  "namespaceId": "shopify-namespace-id",
  "accountId": "production-store-account-id", 
  "methodId": "get-orders-method-id",
  "save": true,
  "tableName": "shopify-orders"
}
```

### 2. Pagination Configuration
```javascript
// Shopify pagination example
{
  "nextPageIn": "header",           // Pagination info in response headers
  "nextPageField": "link",          // Header field containing next page URL
  "isAbsoluteUrl": true,            // Next page URLs are absolute
  "maxPages": null                  // Infinite pagination (default)
}
```

### 3. Caching Flow
```
API Request → Check Cache → If Miss: Fetch from API → Store in Cache → Return Data
```

## 🛠️ Development Setup

### Backend Setup
```bash
cd brmh-backend
npm install
npm start
```

### Frontend Setup
```bash
cd brmh-frontend-v2
npm install
npm run dev
```

### Environment Variables
```bash
# Backend
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1
REDIS_URL=your_redis_url
ALGOLIA_APP_ID=your_algolia_id
ALGOLIA_API_KEY=your_algolia_key

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:5001
NEXTAUTH_SECRET=your_auth_secret
```

## 📈 Monitoring & Logging

### Console Logging
- **Execution Progress**: Real-time page-by-page sync progress
- **Cache Operations**: Cache hits, misses, and storage operations
- **Error Tracking**: Comprehensive error logging with context
- **Performance Metrics**: Response times and data sizes

### CloudWatch Integration
- **Centralized Logging**: All operations logged to CloudWatch
- **Error Monitoring**: Automatic error detection and alerting
- **Performance Tracking**: API response times and throughput

## 🔒 Security Features

### Authentication
- **AWS Cognito SSO**: Enterprise-grade authentication
- **JWT Tokens**: Secure session management
- **Role-based Access**: Granular permissions

### Data Security
- **User Isolation**: Separate data spaces per user
- **Encrypted Storage**: S3 server-side encryption
- **Secure APIs**: Presigned URLs and token-based access
- **Input Validation**: Comprehensive request validation

## 🚀 Deployment

### EC2 Deployment
- **GitHub Actions**: Automated CI/CD pipeline
- **PM2 Process Manager**: Application lifecycle management
- **Nginx Reverse Proxy**: Load balancing and SSL termination
- **Auto-scaling**: Dynamic resource allocation

### Infrastructure
- **AWS Services**: DynamoDB, S3, ElastiCache, Lambda, API Gateway
- **Monitoring**: CloudWatch, X-Ray tracing
- **Backup**: Automated DynamoDB backups
- **Security**: VPC, Security Groups, IAM roles

## 📚 API Documentation

### Interactive Documentation
- **Swagger UI**: Available at `/api-docs`
- **OpenAPI Specs**: Complete API specifications in `swagger/` directory
- **Postman Collection**: Import-ready API collection

### Key Documentation Files
- `BRMH-DRIVE-README.md`: File management system guide
- `EXECUTE.md`: Data execution and pagination guide
- `UnifiedNamespaceSchema.md`: Complete API schema reference
- `MOCK_DATA_AGENT.md`: AI agent system documentation

## 🎯 Use Cases

### 1. E-commerce Integration
- **Shopify**: Orders, products, customers, analytics
- **Stripe**: Payments, subscriptions, webhooks
- **Inventory Management**: Real-time stock synchronization

### 2. Marketing Automation
- **Email Campaigns**: Customer segmentation and targeting
- **Social Media**: Content scheduling and analytics
- **CRM Integration**: Lead management and tracking

### 3. Data Analytics
- **Business Intelligence**: Cross-platform data aggregation
- **Reporting**: Automated report generation
- **Real-time Dashboards**: Live data visualization

### 4. File Management
- **Document Storage**: Secure file organization
- **Collaboration**: Team file sharing
- **Backup**: Automated file backup and versioning

## 🔮 Future Enhancements

### Planned Features
- **Real-time Webhooks**: Event-driven data synchronization
- **Advanced Analytics**: Machine learning insights
- **Multi-tenant Architecture**: Enterprise-grade isolation
- **API Marketplace**: Third-party integrations
- **Mobile Apps**: iOS and Android applications

### Technical Improvements
- **GraphQL API**: Flexible data querying
- **Microservices**: Service-oriented architecture
- **Kubernetes**: Container orchestration
- **Event Sourcing**: Audit trail and replay capabilities

---

## 📞 Support & Resources

- **API Documentation**: `/api-docs` (Swagger UI)
- **GitHub Repository**: Source code and issue tracking
- **CloudWatch Logs**: Application monitoring and debugging
- **AWS Console**: Infrastructure management

**🎯 BRMH is a production-ready platform for API integration, data management, and business automation!**

