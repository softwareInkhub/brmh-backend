# BRMH Backend

A comprehensive backend service built with Node.js and Express, featuring AWS services integration, OpenAPI/Swagger documentation, and advanced data handling capabilities.

## Features

### Core Features
- RESTful API with OpenAPI/Swagger documentation
- Mock server support using Prism
- WebSocket support for real-time communication
- CORS enabled for frontend integration
- Environment-based configuration

### AWS Services Integration
- DynamoDB for data storage and management
- S3 for file storage and management
- SNS for notifications
- SQS for message queuing
- AWS SDK integration for all services

### Data Management
- Schema generation and validation
- File browser functionality
- Pagination support for large datasets
- Data transformation utilities
- Webhook handling and management

### Security
- JWT-based authentication
- Environment variable configuration
- CORS protection
- Secure file handling

## Prerequisites

- Node.js (Latest LTS version recommended)
- Docker and Docker Compose (for containerized deployment)
- AWS Account with appropriate credentials
- Access to required AWS services (DynamoDB, S3, SNS, SQS)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/softwareInkhub/brmh-backend.git
cd brmh-backend
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with the following variables:
```env
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=your_region
NODE_ENV=development
```

## Running the Application

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

### Using Docker
```bash
docker-compose up
```

### Mock Server
The application includes a built-in mock server using Prism:
```bash
# Start mock server
POST /api/mock-server/start
{
  "port": 4010,
  "specPath": "./openapi.yaml"
}

# Stop mock server
POST /api/mock-server/stop
```

## Project Structure

```
├── lib/                    # Core library files
│   ├── dynamodb-client.js  # DynamoDB client configuration
│   ├── dynamodb-handlers.js # DynamoDB operation handlers
│   ├── filebrowser-handlers.js # File browser functionality
│   ├── schema-handlers.js  # Schema management handlers
│   └── schema-types.js     # Schema type definitions
├── swagger/               # Swagger/OpenAPI specifications
│   └── aws-dynamodb.yaml  # DynamoDB API specification
├── index.js              # Main application entry point
├── aws-messaging.yaml    # AWS messaging API specification
├── aws-messaging-handlers.js # AWS messaging handlers
├── filebrowser-api.yaml  # File browser API specification
├── openapi.yaml         # Main OpenAPI specification
├── schema-api.yaml      # Schema API specification
├── executionHandler.js  # Execution logging and management
├── pinterest-api.yaml   # Pinterest API integration
├── pinterest-handlers.js # Pinterest API handlers
└── docker-compose.yml   # Docker configuration
```

## API Documentation

The API documentation is available through Swagger UI when the application is running:
- Development: `http://localhost:3000/api-docs`
- Production: `http://your-domain/api-docs`

### Available API Endpoints

1. Schema Management
   - Generate schema
   - Save schema
   - Get schema
   - Update schema
   - Get method schemas

2. File Browser
   - File operations
   - Directory management
   - File upload/download

3. AWS Messaging
   - SNS notifications
   - SQS message handling
   - Message queuing

4. DynamoDB Operations
   - CRUD operations
   - Batch operations
   - Query and scan operations

## Available Scripts

- `npm start`: Start the application in production mode
- `npm run dev`: Start the application in development mode with hot-reload
- `npm run build`: Install production dependencies

## Dependencies

### Core Dependencies
- Express.js - Web framework
- AWS SDK - AWS service integration
- OpenAPI Backend - API routing and validation
- Swagger UI Express - API documentation
- WebSocket - Real-time communication
- JWT - Authentication
- Formidable - File upload handling
- Axios - HTTP client
- CORS - Cross-origin resource sharing
- Dotenv - Environment configuration
- UUID - Unique identifier generation
- Ajv - JSON Schema validator

### Development Dependencies
- Nodemon - Development server with hot-reload

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the ISC License.

## Support

For support, please open an issue in the GitHub repository or contact the maintainers.

## Acknowledgments

- AWS SDK team for their excellent documentation
- OpenAPI community for the specification and tools
- All contributors who have helped shape this project
