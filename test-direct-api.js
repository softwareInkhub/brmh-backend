import { registerDynamicApi, clearAllDynamicApis } from './lib/dynamic-api-generator.js';

// Test API specification
const testApi = {
  openapi: "3.0.0",
  info: {
    title: "Test Product API",
    version: "1.0.0"
  },
  paths: {
    "/products": {
      get: {
        summary: "List all products",
        responses: {
          "200": {
            description: "Success",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                      price: { type: "number" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/products/{id}": {
      delete: {
        summary: "Delete a product",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        responses: {
          "204": {
            description: "No Content"
          },
          "404": {
            description: "Not Found"
          }
        }
      }
    }
  }
};

console.log('Testing direct API registration...');

// Clear any existing APIs
const clearedCount = clearAllDynamicApis();
console.log(`Cleared ${clearedCount} previous APIs`);

// Register the test API
const apiId = `test-api-${Date.now()}`;
registerDynamicApi(testApi, apiId);
console.log(`Registered API with ID: ${apiId}`);

console.log('Test API registered successfully!');
console.log('You can now test:');
console.log(`- GET http://localhost:5001/dynamic-api/products`);
console.log(`- DELETE http://localhost:5001/dynamic-api/products/123`); 