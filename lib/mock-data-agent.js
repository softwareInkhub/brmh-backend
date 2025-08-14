import { Anthropic } from '@anthropic-ai/sdk';
import { ChatAnthropic } from "@langchain/anthropic";
import { RunnableSequence } from "@langchain/core/runnables";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { initializeAgentExecutorWithOptions } from "langchain/agents";
import { z } from "zod";
import { docClient } from './dynamodb-client.js';
import { ScanCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const chat = new ChatAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: "claude-3-5-sonnet-20240620"
});

// Mock data generation tools
const mockDataTools = [
  new DynamicStructuredTool({
    name: "generate_mock_data",
    description: "Generate realistic mock data based on a JSON schema",
    schema: z.object({
      schema: z.any().describe("The JSON schema to generate data for"),
      count: z.number().describe("Number of mock records to generate"),
      context: z.string().optional().describe("Additional context for data generation")
    }),
    func: async ({ schema, count, context }) => {
      try {
        const prompt = `Generate ${count} realistic mock data records based on this JSON schema. 
        Make the data realistic and varied. Return only valid JSON array.
        
        Schema: ${JSON.stringify(schema, null, 2)}
        Context: ${context || 'General business data'}
        
        Requirements:
        - Generate exactly ${count} records
        - Make data realistic and business-appropriate
        - Ensure all required fields are present
        - Use appropriate data types based on schema
        - For string fields: use realistic text values
        - For number fields: use numeric values
        - For boolean fields: use true/false values
        - For array fields: use arrays of appropriate types
        - For object fields: use nested objects
        - Include realistic IDs, names, dates, etc.
        - Follow the exact schema structure and types
        
        Return only the JSON array, no explanations.`;

        const response = await chat.invoke(prompt);
        const mockData = JSON.parse(response.content);
        return { success: true, data: mockData };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  new DynamicStructuredTool({
    name: "insert_mock_data",
    description: "Insert mock data into a DynamoDB table via CRUD endpoint",
    schema: z.object({
      tableName: z.string().describe("The DynamoDB table name"),
      items: z.array(z.object({})).describe("Array of items to insert"),
      batchSize: z.number().optional().describe("Batch size for insertion (default: 10)")
    }),
    func: async ({ tableName, items, batchSize = 10 }) => {
      try {
        const results = [];
        const batches = [];
        
        // Split items into batches
        for (let i = 0; i < items.length; i += batchSize) {
          batches.push(items.slice(i, i + batchSize));
        }

        for (const batch of batches) {
          const batchResults = await Promise.all(
            batch.map(async (item) => {
              try {
                // Add unique ID if not present
                if (!item.id) {
                  item.id = uuidv4();
                }
                
                // Insert via CRUD endpoint
                const response = await fetch(`http://localhost:5001/crud?tableName=${tableName}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ item })
                });
                
                const result = await response.json();
                return { success: true, itemId: item.id, result };
              } catch (error) {
                return { success: false, itemId: item.id, error: error.message };
              }
            })
          );
          results.push(...batchResults);
        }

        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        
        return {
          success: true,
          totalItems: items.length,
          successful,
          failed,
          results
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  new DynamicStructuredTool({
    name: "get_table_schema",
    description: "Get the schema for a DynamoDB table",
    schema: z.object({
      tableName: z.string().describe("The DynamoDB table name")
    }),
    func: async ({ tableName }) => {
      try {
        // Try to get schema from brmh-schemas table
        const schemaResult = await docClient.send(new ScanCommand({
          TableName: 'brmh-schemas',
          FilterExpression: 'tableName = :tableName',
          ExpressionAttributeValues: { ':tableName': tableName }
        }));

        if (schemaResult.Items && schemaResult.Items.length > 0) {
          return { success: true, schema: schemaResult.Items[0] };
        }

        // Fallback: try to infer schema from existing data
        const dataResult = await docClient.send(new ScanCommand({
          TableName: tableName,
          Limit: 5
        }));

        if (dataResult.Items && dataResult.Items.length > 0) {
          const sampleItem = dataResult.Items[0];
          const inferredSchema = {
            type: "object",
            properties: {},
            required: []
          };

          Object.entries(sampleItem).forEach(([key, value]) => {
            inferredSchema.properties[key] = {
              type: typeof value === 'number' ? 'number' : 
                    typeof value === 'boolean' ? 'boolean' : 'string'
            };
            if (key === 'id') {
              inferredSchema.required.push(key);
            }
          });

          return { success: true, schema: { schema: inferredSchema, isInferred: true } };
        }

        return { success: false, error: 'No schema found and no data to infer from' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }),

  new DynamicStructuredTool({
    name: "list_available_tables",
    description: "List all available DynamoDB tables for mock data generation",
    schema: z.object({}),
    func: async () => {
      try {
        // Get tables from brmh-schemas
        const schemasResult = await docClient.send(new ScanCommand({
          TableName: 'brmh-schemas'
        }));

        const tables = schemasResult.Items?.map(item => ({
          tableName: item.tableName,
          schemaName: item.schemaName,
          namespaceId: item.namespaceId
        })) || [];

        return { success: true, tables };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  })
];

// Mock Data Agent Class
export class MockDataAgent {
  constructor() {
    this.agentExecutor = null;
  }

  async initialize() {
    if (!this.agentExecutor) {
      this.agentExecutor = await initializeAgentExecutorWithOptions(
        mockDataTools,
        chat,
        {
          agentType: "structured-chat-zero-shot-react-description",
          verbose: true,
          maxIterations: 10
        }
      );
    }
  }

  async generateMockData({ tableName, count = 10, context = null }) {
    try {
      // First, get the schema for the table
      const schemaResult = await docClient.send(new ScanCommand({
        TableName: 'brmh-schemas',
        FilterExpression: 'tableName = :tableName',
        ExpressionAttributeValues: { ':tableName': tableName }
      }));

      if (!schemaResult.Items || schemaResult.Items.length === 0) {
        return { success: false, error: `No schema found for table: ${tableName}` };
      }

      const schemaItem = schemaResult.Items[0];
      const schema = schemaItem.schema || schemaItem;

      // Generate mock data based on the schema
      const prompt = `Generate ${count} realistic mock data records based on this JSON schema. 
      Make the data realistic and varied. Return ONLY a valid JSON array, nothing else.
      
      Schema: ${JSON.stringify(schema, null, 2)}
      Context: ${context || 'General business data'}
      Table Name: ${tableName}
      
      Requirements:
      - Generate exactly ${count} records
      - Make data realistic and business-appropriate for the context: "${context || 'General business data'}"
      - Ensure all required fields are present
      - Use appropriate data types based on schema
      - For string fields: use realistic text values appropriate to the context
      - For number fields: use numeric values
      - For boolean fields: use true/false values
      - For array fields: use arrays of appropriate types
      - For object fields: use nested objects
      - Include realistic IDs, names, dates, etc.
      - Follow the exact schema structure and types
      - Make data contextually relevant to: ${context || 'General business data'}
      
      IMPORTANT: Return ONLY the JSON array. Do not include any explanations, markdown formatting, or other text. Start with [ and end with ].`;

      // Try up to 3 times to get valid JSON response
      let mockData;
      let lastError = null;
      
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const response = await chat.invoke(prompt);
          
          // Try to extract JSON from the response
          try {
            // First try to parse the entire response as JSON
            mockData = JSON.parse(response.content);
            break; // Success, exit the retry loop
          } catch (parseError) {
            console.error(`Attempt ${attempt}: Initial JSON parse failed:`, parseError.message);
            console.error(`Attempt ${attempt}: Response content:`, response.content);
            
            // If that fails, try to extract JSON from the response
            const jsonMatch = response.content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              try {
                mockData = JSON.parse(jsonMatch[0]);
                break; // Success, exit the retry loop
              } catch (extractError) {
                console.error(`Attempt ${attempt}: Failed to extract JSON from response:`, response.content);
                lastError = `Failed to parse AI response: ${extractError.message}. Response was incomplete or malformed.`;
                continue; // Try again
              }
            } else {
              // Try to find any JSON-like structure
              const anyJsonMatch = response.content.match(/\{[\s\S]*\}/);
              if (anyJsonMatch) {
                try {
                  const parsed = JSON.parse(anyJsonMatch[0]);
                  // If it's an object, try to convert to array
                  if (Array.isArray(parsed)) {
                    mockData = parsed;
                  } else {
                    mockData = [parsed];
                  }
                  break; // Success, exit the retry loop
                } catch (fallbackError) {
                  console.error(`Attempt ${attempt}: Fallback JSON parsing failed:`, fallbackError.message);
                  lastError = `AI response is malformed. Expected JSON array but got: ${response.content.substring(0, 200)}...`;
                  continue; // Try again
                }
              } else {
                console.error(`Attempt ${attempt}: No valid JSON found in response:`, response.content);
                lastError = `AI response does not contain valid JSON. Response: ${response.content.substring(0, 200)}...`;
                continue; // Try again
              }
            }
          }
        } catch (chatError) {
          console.error(`Attempt ${attempt}: Chat invocation failed:`, chatError.message);
          lastError = `Failed to generate mock data: ${chatError.message}`;
          continue; // Try again
        }
      }
      
      // If we still don't have valid data after all attempts
      if (!mockData) {
        // If all attempts failed, try to generate a simple fallback mock data
        try {
          console.log('All parsing attempts failed, generating fallback mock data');
          const fallbackData = generateFallbackMockData(schema, count, context);
          return { success: true, result: fallbackData, warning: 'Used fallback data due to parsing issues' };
        } catch (fallbackError) {
          return { success: false, error: lastError || 'Failed to generate valid mock data after multiple attempts' };
        }
      }

      return { success: true, result: mockData };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async generateMockDataForSchema({ schema, tableName, count = 10, context = null }) {
    try {
      // Generate mock data directly using the schema, similar to generateMockData
      const prompt = `You are a JSON generator. Generate exactly ${count} mock data records based on this schema.

SCHEMA: ${JSON.stringify(schema, null, 2)}
CONTEXT: ${context || 'General business data'}

RULES:
1. Return ONLY a valid JSON array
2. No explanations, no markdown, no text before or after
3. Start with [ and end with ]
4. Use regular double quotes " for all strings
5. No HTML entities, no escape sequences
6. Follow the schema exactly
7. Make data realistic for: ${context || 'General business data'}

OUTPUT FORMAT: [{"field1": "value1", "field2": 123}, {"field1": "value2", "field2": 456}]`;

      // Always use fallback data generation for 100% reliability
      console.log('Using fallback data generation for reliability');
      const mockData = generateFallbackMockData(schema, count, context);

      return { success: true, result: mockData, warning: 'Using fallback data generation for reliability' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async listAvailableTables() {
    await this.initialize();
    
    const prompt = "List all available tables that can be used for mock data generation.";
    
    try {
      const result = await this.agentExecutor.invoke({ input: prompt });
      return { success: true, result: result.output };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async generateMockDataForNamespace({ namespaceId, count = 10, context = null }) {
    await this.initialize();
    
    const prompt = `Generate mock data for all tables in namespace "${namespaceId}".
    
    Steps:
    1. Find all tables associated with namespace "${namespaceId}"
    2. For each table, generate ${count} realistic mock data records
    3. Insert the data into each table
    
    Make the data realistic and business-appropriate for each table's purpose.
    Context: ${context || 'General business data'}`;

    try {
      const result = await this.agentExecutor.invoke({ input: prompt });
      return { success: true, result: result.output };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// Extract and complete partial JSON
function extractAndCompleteJson(content) {
  // Look for the start of a JSON array
  const arrayStart = content.indexOf('[');
  if (arrayStart === -1) return null;
  
  // Find the content after the opening bracket
  let jsonContent = content.substring(arrayStart);
  
  // Count brackets and braces to find where the JSON should end
  let bracketCount = 0;
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;
  
  for (let i = 0; i < jsonContent.length; i++) {
    const char = jsonContent[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    
    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === '[') bracketCount++;
      if (char === ']') bracketCount--;
      if (char === '{') braceCount++;
      if (char === '}') braceCount--;
    }
    
    // If we've closed all brackets and braces, we have complete JSON
    if (bracketCount === 0 && braceCount === 0 && i > 0) {
      jsonContent = jsonContent.substring(0, i + 1);
      break;
    }
  }
  
  // If we didn't find complete JSON, try to complete it
  if (bracketCount > 0 || braceCount > 0) {
    // Add missing closing brackets/braces
    for (let i = 0; i < braceCount; i++) {
      jsonContent += '}';
    }
    for (let i = 0; i < bracketCount; i++) {
      jsonContent += ']';
    }
  }
  
  return jsonContent;
}

// JSON repair function to fix common issues
function repairJsonString(jsonString) {
  try {
    // First try to parse as-is
    JSON.parse(jsonString);
    return jsonString; // If it works, return as-is
  } catch (error) {
    console.log('Attempting to repair JSON:', error.message);
  }
  
  let repaired = jsonString;
  
  // Fix unterminated strings by finding the last quote and closing it
  const stringRegex = /"([^"]*)$/g;
  let match;
  while ((match = stringRegex.exec(repaired)) !== null) {
    const unmatchedString = match[1];
    if (unmatchedString.length > 0) {
      // Close the string by adding a quote
      repaired = repaired.replace(match[0], match[0] + '"');
    }
  }
  
  // Fix missing closing braces/brackets
  const openBraces = (repaired.match(/\{/g) || []).length;
  const closeBraces = (repaired.match(/\}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;
  
  // Add missing closing braces
  for (let i = 0; i < openBraces - closeBraces; i++) {
    repaired += '}';
  }
  
  // Add missing closing brackets
  for (let i = 0; i < openBrackets - closeBrackets; i++) {
    repaired += ']';
  }
  
  // Fix trailing commas
  repaired = repaired.replace(/,(\s*[}\]])/g, '$1');
  
  // Fix missing quotes around property names
  repaired = repaired.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
  
  // Try to parse the repaired JSON
  try {
    JSON.parse(repaired);
    console.log('JSON repair successful');
    return repaired;
  } catch (repairError) {
    console.log('JSON repair failed:', repairError.message);
    return jsonString; // Return original if repair fails
  }
}

// Fallback mock data generation function
function generateFallbackMockData(schema, count, context) {
  const mockData = [];
  const contextLower = (context || '').toLowerCase();
  
  // Context-aware data generation
  const isEcommerce = contextLower.includes('ecommerce') || contextLower.includes('e-commerce') || contextLower.includes('product');
  const isUser = contextLower.includes('user') || contextLower.includes('profile') || contextLower.includes('customer');
  const isOrder = contextLower.includes('order') || contextLower.includes('purchase') || contextLower.includes('transaction');
  
  for (let i = 0; i < count; i++) {
    const item = {};
    
    if (schema.properties) {
      Object.keys(schema.properties).forEach(key => {
        const prop = schema.properties[key];
        const propType = Array.isArray(prop.type) ? prop.type[0] : prop.type;
        const keyLower = key.toLowerCase();
        
        switch (propType) {
          case 'string':
            if (keyLower.includes('id')) {
              item[key] = `id_${i + 1}_${Date.now()}`;
            } else if (keyLower.includes('name')) {
              if (isEcommerce) {
                item[key] = `Product ${i + 1}`;
              } else if (isUser) {
                item[key] = `User ${i + 1}`;
              } else {
                item[key] = `${context || 'Item'} ${i + 1}`;
              }
            } else if (keyLower.includes('email')) {
              item[key] = `user${i + 1}@example.com`;
            } else if (keyLower.includes('title')) {
              if (isEcommerce) {
                item[key] = `Amazing Product ${i + 1}`;
              } else {
                item[key] = `Sample Title ${i + 1}`;
              }
            } else if (keyLower.includes('description')) {
              if (isEcommerce) {
                item[key] = `High-quality product with great features. Item ${i + 1}`;
              } else {
                item[key] = `Sample description for ${key} ${i + 1}`;
              }
            } else if (keyLower.includes('category')) {
              if (isEcommerce) {
                const categories = ['Electronics', 'Clothing', 'Books', 'Home', 'Sports'];
                item[key] = categories[i % categories.length];
              } else {
                item[key] = `Category ${i + 1}`;
              }
            } else if (keyLower.includes('status')) {
              const statuses = ['active', 'pending', 'completed', 'cancelled'];
              item[key] = statuses[i % statuses.length];
            } else if (keyLower.includes('date') || keyLower.includes('time')) {
              item[key] = new Date().toISOString();
            } else if (keyLower.includes('url') || keyLower.includes('link')) {
              item[key] = `https://example.com/${keyLower.replace(/[^a-z]/g, '')}/${i + 1}`;
            } else if (keyLower.includes('phone')) {
              item[key] = `+1-555-${String(i + 1).padStart(3, '0')}-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`;
            } else if (keyLower.includes('address')) {
              item[key] = `${i + 1} Main Street, City ${i + 1}, State ${i + 1}`;
            } else {
              item[key] = `Sample ${key} ${i + 1}`;
            }
            break;
          case 'number':
            if (keyLower.includes('price') || keyLower.includes('cost')) {
              item[key] = Math.floor(Math.random() * 1000) + 10;
            } else if (keyLower.includes('quantity') || keyLower.includes('stock')) {
              item[key] = Math.floor(Math.random() * 100) + 1;
            } else if (keyLower.includes('rating') || keyLower.includes('score')) {
              item[key] = Math.floor(Math.random() * 5) + 1;
            } else if (keyLower.includes('age')) {
              item[key] = Math.floor(Math.random() * 50) + 18;
            } else {
              item[key] = Math.floor(Math.random() * 1000) + 1;
            }
            break;
          case 'boolean':
            item[key] = Math.random() > 0.5;
            break;
          case 'array':
            item[key] = [];
            break;
          case 'object':
            item[key] = {};
            break;
          default:
            item[key] = `Default ${key} ${i + 1}`;
        }
      });
    }
    
    // Ensure required fields are present
    if (schema.required) {
      schema.required.forEach(field => {
        if (!item.hasOwnProperty(field)) {
          item[field] = `Required ${field} ${i + 1}`;
        }
      });
    }
    
    mockData.push(item);
  }
  
  return mockData;
}

export const mockDataAgent = new MockDataAgent(); 