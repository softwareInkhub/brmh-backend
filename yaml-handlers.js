import { v4 as uuidv4 } from 'uuid';
import yaml from 'js-yaml';

export const handlers = {
  generateOpenApiSpec: async (c, req, res) => {
    try {
      const { namespace, accounts = [], methods = [] } = c.request.requestBody;

      // Validate required namespace data
      if (!namespace || !namespace['namespace-name'] || !namespace['namespace-url']) {
        return {
          statusCode: 400,
          body: {
            error: 'Invalid namespace data',
            details: 'Namespace name and URL are required'
          }
        };
      }

      // Generate OpenAPI specification
      const openApiSpec = {
        openapi: '3.0.0',
        info: {
          title: `${namespace['namespace-name']} API`,
          version: '1.0.0',
          description: namespace.description || `API specification for ${namespace['namespace-name']} namespace`
        },
        servers: [
          {
            url: namespace['namespace-url'],
            description: 'Base API URL'
          }
        ],
        paths: {},
        components: {
          schemas: {},
          securitySchemes: {}
        }
      };

      // Process all accounts
      if (accounts && accounts.length > 0) {
        // Add account-specific servers and security schemes
        accounts.forEach((account, index) => {
          // Add account-specific server if URL override is provided
          if (account['namespace-account-url-override']) {
            openApiSpec.servers.push({
              url: account['namespace-account-url-override'],
              description: `${account['namespace-account-name']} API URL`
            });
          }

          // Add account headers to security schemes
          if (account['namespace-account-header']?.length > 0) {
            account['namespace-account-header'].forEach(header => {
              const securityKey = `${account['namespace-account-name']}Auth${index}`;
              openApiSpec.components.securitySchemes[securityKey] = {
                type: 'apiKey',
                in: 'header',
                name: header.key,
                description: `Authentication header for ${account['namespace-account-name']}`
              };
            });
          }
        });

        // Add global security requirement combining all account securities
        openApiSpec.security = accounts
          .map((account, index) => account['namespace-account-header']?.length > 0 
            ? { [`${account['namespace-account-name']}Auth${index}`]: [] }
            : null)
          .filter(Boolean);
      }

      // Process all methods
      if (methods && methods.length > 0) {
        methods.forEach(method => {
          const path = method['namespace-method-url-override'] || 
                      `/${method['namespace-method-name'].toLowerCase()}`;
          
          openApiSpec.paths[path] = {
            [method['namespace-method-type'].toLowerCase()]: {
              summary: method['namespace-method-name'],
              description: method.description,
              operationId: method['namespace-method-name'],
              tags: method.tags || [],
              parameters: [],
              responses: {
                '200': {
                  description: 'Successful response',
                  content: {
                    'application/json': {
                      schema: method['response-schema'] || 
                              (method['sample-response'] ? {
                                type: 'object',
                                example: method['sample-response']
                              } : {
                                type: 'object'
                              })
                    }
                  }
                },
                '400': {
                  description: 'Bad Request - Invalid input parameters'
                },
                '401': {
                  description: 'Unauthorized - Authentication failed'
                },
                '403': {
                  description: 'Forbidden - Insufficient permissions'
                },
                '429': {
                  description: 'Too Many Requests - Rate limit exceeded'
                },
                '500': {
                  description: 'Internal Server Error'
                }
              }
            }
          };

          const methodConfig = openApiSpec.paths[path][method['namespace-method-type'].toLowerCase()];

          // Add query parameters
          if (method['namespace-method-queryParams']?.length > 0) {
            method['namespace-method-queryParams'].forEach(param => {
              methodConfig.parameters.push({
                name: param.key,
                in: 'query',
                description: param.description || `Query parameter ${param.key}`,
                required: param.required || false,
                schema: {
                  type: 'string',
                  example: param.value
                }
              });
            });
          }

          // Add method-specific headers
          if (method['namespace-method-header']?.length > 0) {
            method['namespace-method-header'].forEach(header => {
              methodConfig.parameters.push({
                name: header.key,
                in: 'header',
                description: header.description || `Header ${header.key}`,
                required: header.required || false,
                schema: {
                  type: 'string',
                  example: header.value
                }
              });
            });
          }

          // Add request body if method is not GET or DELETE
          if (!['GET', 'DELETE'].includes(method['namespace-method-type'])) {
            methodConfig.requestBody = {
              required: true,
              content: {
                'application/json': {
                  schema: method['request-schema'] || 
                          (method['sample-request'] ? {
                            type: 'object',
                            example: method['sample-request']
                          } : {
                            type: 'object'
                          })
                }
              }
            };
          }

          // Add method to schema components if it has a request or response schema
          if (method['request-schema']) {
            openApiSpec.components.schemas[`${method['namespace-method-name']}Request`] = method['request-schema'];
          }
          if (method['response-schema']) {
            openApiSpec.components.schemas[`${method['namespace-method-name']}Response`] = method['response-schema'];
          }
        });
      }

      // Convert to YAML
      const yamlSpec = yaml.dump(openApiSpec, {
        indent: 2,
        lineWidth: -1,
        noRefs: true
      });

      return {
        statusCode: 200,
        body: yamlSpec
      };
    } catch (error) {
      console.error('Error generating OpenAPI spec:', error);
      return {
        statusCode: 500,
        body: {
          error: 'Failed to generate OpenAPI specification',
          details: error.message
        }
      };
    }
  }
}; 