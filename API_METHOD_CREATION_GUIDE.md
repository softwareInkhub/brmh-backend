# API Method Creation Agent Guide

## Overview

The API Method Creation Agent is a powerful feature in the AI Agent Workspace that allows you to transform API Gateway URLs into reusable methods with OpenAPI specifications. This feature enables you to create methods that can be overridden with different URLs and saved to your namespace for future use.

## Features

### 🚀 Core Functionality
- **URL to Method Conversion**: Transform any API Gateway URL into a structured method
- **OpenAPI Specification Generation**: Automatically generate OpenAPI 3.0 specs from URLs
- **Method Override**: Use different URLs for the same method definition
- **Namespace Integration**: Save generated methods directly to your namespace
- **Quick Deploy Integration**: Auto-populate from deployed Lambda endpoints

### 🛠️ Advanced Features
- **Custom Parameters**: Add query parameters with type validation
- **Custom Headers**: Define custom headers for API calls
- **Method Testing**: Test generated methods with real API calls
- **OpenAPI Export**: Copy OpenAPI specifications for external use

## How to Use

### 1. Access the API Method Creation Agent

1. Open the AI Agent Workspace
2. Navigate to the **API** tab
3. The API Method Creation Agent will be displayed at the top

### 2. Quick Start with Deployed Endpoints

If you have deployed Lambda functions, you'll see a "Quick Select" section:

1. Click on any deployed endpoint to auto-populate the form
2. The URL and method name will be automatically filled
3. Customize the description and other settings as needed
4. Click "Generate Method" to create the method

### 3. Manual Method Creation

1. **Enter API Gateway URL**: Provide the full URL of your API endpoint
2. **Set Method Name**: Give your method a descriptive name
3. **Select HTTP Method**: Choose GET, POST, PUT, DELETE, or PATCH
4. **Add Description**: Describe what the method does
5. **Override URL (Optional)**: Use a different URL for this method
6. **Configure Advanced Options**:
   - Add custom query parameters
   - Define custom headers
   - Set parameter types and requirements

### 4. Generate and Save Methods

1. Click "Generate Method" to create the OpenAPI specification
2. Review the generated method in the "Generated Methods" section
3. Use the action buttons:
   - **Test**: Test the method with a real API call
   - **Copy OpenAPI**: Copy the OpenAPI specification
   - **Save to Namespace**: Save the method to your current namespace

## Method Structure

### Generated Method Properties

```typescript
interface GeneratedMethod {
  id: string;                    // Unique identifier
  name: string;                  // Method name
  method: string;                // HTTP method (GET, POST, etc.)
  path: string;                  // API path
  originalUrl: string;           // Original API Gateway URL
  overrideUrl?: string;          // Optional override URL
  openApiSpec: any;              // Complete OpenAPI 3.0 specification
  description: string;           // Method description
  parameters: any[];             // Custom parameters
  responses: any;                // Response schemas
  tags: string[];                // Method tags
  createdAt: Date;               // Creation timestamp
}
```

### OpenAPI Specification Structure

The generated OpenAPI specification includes:

- **Info**: Title, description, and version
- **Servers**: Base URL configuration
- **Paths**: Endpoint definitions with HTTP methods
- **Parameters**: Query parameters and headers
- **Request Body**: JSON schema for POST/PUT requests
- **Responses**: Success and error response schemas
- **Tags**: Categorization for organization

## Backend Integration

### API Endpoints

The system uses existing backend endpoints:

- `POST /unified/namespaces/{namespaceId}/methods` - Save method to namespace
- `POST /api-method/test` - Test API methods with real calls

### Method Testing

The backend provides a dedicated testing endpoint that:
- Handles CORS and timeout issues
- Provides detailed response information
- Supports custom headers and request bodies
- Returns structured test results

## Use Cases

### 1. Lambda Function Integration
- Deploy Lambda functions and automatically create methods
- Override URLs for different environments (dev, staging, prod)
- Maintain consistent method definitions across deployments

### 2. Third-Party API Integration
- Create methods for external APIs
- Add custom authentication headers
- Define request/response schemas
- Test API connectivity

### 3. API Documentation
- Generate OpenAPI specifications for existing APIs
- Create comprehensive API documentation
- Export specifications for external tools

### 4. Method Reusability
- Create once, use multiple times with different URLs
- Maintain method definitions while changing endpoints
- Version control for API methods

## Best Practices

### 1. Naming Conventions
- Use descriptive method names (e.g., `getUserProfile`, `createOrder`)
- Include the resource type in the name
- Use camelCase for consistency

### 2. URL Management
- Use override URLs for different environments
- Keep original URLs for reference
- Document URL changes in descriptions

### 3. Parameter Design
- Mark required parameters appropriately
- Use appropriate data types
- Provide clear descriptions for all parameters

### 4. Testing Strategy
- Test methods after generation
- Verify response formats
- Check error handling

## Troubleshooting

### Common Issues

1. **Invalid URL Format**
   - Ensure URLs include protocol (https://)
   - Check for typos in the URL
   - Verify the endpoint is accessible

2. **Method Generation Fails**
   - Check URL accessibility
   - Verify network connectivity
   - Review browser console for errors

3. **Save to Namespace Fails**
   - Ensure namespace is selected
   - Check namespace permissions
   - Verify backend connectivity

4. **Test Method Fails**
   - Check API endpoint availability
   - Verify authentication requirements
   - Review custom headers and parameters

### Error Messages

- **"Please provide both URL and method name"**: Fill in required fields
- **"No namespace selected"**: Select a namespace before saving
- **"Test failed"**: Check API endpoint and network connectivity

## Advanced Configuration

### Custom Parameters
- Add query parameters with type validation
- Set required/optional status
- Provide descriptions for documentation

### Custom Headers
- Add authentication headers
- Set content-type headers
- Configure custom API headers

### Response Schemas
- Define success response structures
- Configure error response formats
- Set appropriate HTTP status codes

## Integration with Other Features

### Schema Integration
- Use existing schemas for request/response validation
- Import schemas from the Schema tab
- Generate schemas from API responses

### Namespace Management
- Save methods to specific namespaces
- Organize methods by project or service
- Share methods across team members

### Deployment Integration
- Auto-populate from deployed Lambda functions
- Track deployment status
- Manage environment-specific URLs

## Future Enhancements

Planned features include:
- Bulk method import from OpenAPI files
- Method versioning and history
- Advanced authentication support
- Response validation and testing
- Method performance monitoring
- Integration with external API documentation tools

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review browser console for errors
3. Verify backend service status
4. Contact the development team

---

*This guide covers the API Method Creation Agent functionality. For additional features and updates, refer to the main documentation.*
