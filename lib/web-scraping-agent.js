import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';
import { promises as fs } from 'fs';
import path from 'path';

class WebScrapingAgent {
  constructor() {
    // Universal patterns for detecting APIs, schemas, and documentation
    this.universalPatterns = {
      // API endpoint patterns
      apiEndpoints: [
        /\/api\/[a-zA-Z0-9\/\-_]+/g,
        /\/v[0-9]+\/[a-zA-Z0-9\/\-_]+/g,
        /\/rest\/[a-zA-Z0-9\/\-_]+/g,
        /\/graphql/g,
        /\/swagger/g,
        /\/openapi/g,
        /\/docs\/api/g,
        /\/developer\/[a-zA-Z0-9\/\-_]+/g
      ],
      
      // Schema patterns
      schemas: [
        /"schema":\s*\{[^}]+\}/g,
        /"components":\s*\{[^}]+\}/g,
        /"definitions":\s*\{[^}]+\}/g,
        /"properties":\s*\{[^}]+\}/g,
        /"models":\s*\{[^}]+\}/g,
        /"types":\s*\{[^}]+\}/g,
        /"interfaces":\s*\{[^}]+\}/g
      ],
      
      // Documentation patterns
      documentation: [
        /<div[^>]*class="[^"]*doc[^"]*"[^>]*>.*?<\/div>/gs,
        /<div[^>]*class="[^"]*api-doc[^"]*"[^>]*>.*?<\/div>/gs,
        /<div[^>]*class="[^"]*markdown-body[^"]*"[^>]*>.*?<\/div>/gs,
        /<article[^>]*>.*?<\/article>/gs,
        /<section[^>]*class="[^"]*content[^"]*"[^>]*>.*?<\/section>/gs,
        /<main[^>]*>.*?<\/main>/gs
      ],
      
      // Code patterns
      codeBlocks: [
        /```[a-zA-Z]*\n[\s\S]*?```/g,
        /<pre[^>]*>[\s\S]*?<\/pre>/g,
        /<code[^>]*>[\s\S]*?<\/code>/g
      ],
      
      // JSON patterns
      jsonData: [
        /"openapi":\s*"[^"]*"/g,
        /"swagger":\s*"[^"]*"/g,
        /"@type":\s*"APIReference"/g,
        /"@type":\s*"WebAPI"/g
      ]
    };
    
    // Common service patterns for auto-detection
    this.servicePatterns = {
      'shopify': {
        name: 'Shopify',
        patterns: [/shopify\.dev/, /shopify\.com\/api/],
        priority: 1
      },
      'stripe': {
        name: 'Stripe',
        patterns: [/stripe\.com/, /stripe\.com\/docs\/api/],
        priority: 1
      },
      'github': {
        name: 'GitHub',
        patterns: [/docs\.github\.com/, /api\.github\.com/],
        priority: 1
      },
      'google': {
        name: 'Google APIs',
        patterns: [/developers\.google\.com/, /googleapis\.com/],
        priority: 1
      },
      'pinterest': {
        name: 'Pinterest',
        patterns: [/developers\.pinterest\.com/],
        priority: 1
      },
      'twitter': {
        name: 'Twitter/X API',
        patterns: [/developer\.twitter\.com/, /api\.twitter\.com/],
        priority: 1
      },
      'facebook': {
        name: 'Facebook',
        patterns: [/developers\.facebook\.com/],
        priority: 1
      },
      'linkedin': {
        name: 'LinkedIn',
        patterns: [/developer\.linkedin\.com/],
        priority: 1
      },
      'slack': {
        name: 'Slack',
        patterns: [/api\.slack\.com/],
        priority: 1
      },
      'discord': {
        name: 'Discord',
        patterns: [/discord\.com\/developers/],
        priority: 1
      }
    };
  }

  async scrapeService(serviceName, options = {}) {
    console.log(`[Web Scraping Agent] Starting scrape for service: ${serviceName}`);
    
    // Check if it's a known service or a custom URL
    const isKnownService = this.servicePatterns[serviceName.toLowerCase()];
    const isUrl = serviceName.startsWith('http://') || serviceName.startsWith('https://');
    
    if (!isKnownService && !isUrl) {
      throw new Error(`Invalid service or URL: ${serviceName}. Please provide a known service name or a valid URL.`);
    }

    const results = {
      service: isKnownService ? isKnownService.name : this.extractDomainName(serviceName),
      timestamp: new Date().toISOString(),
      apis: [],
      schemas: [],
      documentation: [],
      errors: [],
      sourceUrl: isUrl ? serviceName : null
    };

    try {
      // Initialize browser for dynamic content
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      if (isUrl) {
        // Scrape from custom URL
        console.log(`[Web Scraping Agent] Scraping from custom URL: ${serviceName}`);
        await this.scrapeFromUrl(browser, serviceName, results, options);
      } else {
        // Scrape from known service
        console.log(`[Web Scraping Agent] Scraping from known service: ${serviceName}`);
        await this.scrapeFromKnownService(browser, serviceName, results, options);
      }

      await browser.close();
      
      console.log(`[Web Scraping Agent] Scraping completed for ${results.service}`);
      console.log(`[Web Scraping Agent] Results: ${results.apis.length} APIs, ${results.schemas.length} schemas, ${results.documentation.length} docs`);
      
      return results;

    } catch (error) {
      console.error(`[Web Scraping Agent] Error scraping ${results.service}:`, error);
      results.errors.push(error.message);
      return results;
    }
  }

  async scrapeFromUrl(browser, url, results, options) {
    try {
      const page = await browser.newPage();
      
      // Set user agent to avoid being blocked
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      
      console.log(`[Web Scraping Agent] Navigating to: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Wait for content to load
      await page.waitForTimeout(3000);
      
      // Scrape everything from this URL
      if (options.scrapeApis !== false) {
        results.apis = await this.scrapeAPIsFromPage(page, url);
      }
      
      if (options.scrapeSchemas !== false) {
        results.schemas = await this.scrapeSchemasFromPage(page, url);
      }
      
      if (options.scrapeDocumentation !== false) {
        results.documentation = await this.scrapeDocumentationFromPage(page, url);
      }
      
      // Follow links to find more content
      if (options.followLinks !== false) {
        await this.followAndScrapeLinks(page, url, results, options);
      }
      
      await page.close();
      
    } catch (error) {
      console.error(`[Web Scraping Agent] Error scraping from URL ${url}:`, error);
      results.errors.push(`Error scraping ${url}: ${error.message}`);
    }
  }

  async scrapeFromKnownService(browser, serviceName, results, options) {
    const service = this.servicePatterns[serviceName.toLowerCase()];
    
    // Common URLs to try for known services
    const commonUrls = [
      `https://${serviceName}.com`,
      `https://${serviceName}.dev`,
      `https://developers.${serviceName}.com`,
      `https://docs.${serviceName}.com`,
      `https://api.${serviceName}.com`,
      `https://developer.${serviceName}.com`
    ];
    
    for (const url of commonUrls) {
      try {
        await this.scrapeFromUrl(browser, url, results, options);
        if (results.apis.length > 0 || results.schemas.length > 0 || results.documentation.length > 0) {
          break; // Found content, stop trying other URLs
        }
      } catch (error) {
        console.log(`[Web Scraping Agent] Failed to scrape ${url}: ${error.message}`);
      }
    }
  }

  async scrapeAPIsFromPage(page, baseUrl) {
    const apis = [];
    
    try {
      // Extract API endpoints using universal patterns
      const apiData = await page.evaluate((patterns) => {
        const apis = [];
        
        // Find all links that might be API endpoints
        const links = document.querySelectorAll('a[href]');
        
        links.forEach(link => {
          const href = link.getAttribute('href');
          const text = link.textContent.trim();
          
          if (href && text) {
            // Check if this link matches any API pattern
            for (const pattern of patterns) {
              if (pattern.test(href)) {
                apis.push({
                  endpoint: href,
                  name: text,
                  description: link.getAttribute('title') || link.getAttribute('aria-label') || '',
                  method: this.detectMethod(href),
                  url: new URL(href, window.location.origin).href,
                  source: 'link-detection'
                });
                break;
              }
            }
          }
        });
        
        // Also look for API endpoints in text content
        const bodyText = document.body.textContent;
        for (const pattern of patterns) {
          const matches = bodyText.match(pattern);
          if (matches) {
            matches.forEach(match => {
              apis.push({
                endpoint: match,
                name: `API Endpoint: ${match}`,
                description: 'Found in page content',
                method: this.detectMethod(match),
                url: new URL(match, window.location.origin).href,
                source: 'content-detection'
              });
            });
          }
        }
        
        return apis;
      }, this.universalPatterns.apiEndpoints);

      apis.push(...apiData);
      
      // Find OpenAPI/Swagger specs
      const openApiSpecs = await this.findOpenAPISpecs(page, { baseUrl });
      apis.push(...openApiSpecs);
      
      // Look for GraphQL endpoints
      const graphqlEndpoints = await this.findGraphQLEndpoints(page);
      apis.push(...graphqlEndpoints);
      
    } catch (error) {
      console.error(`[Web Scraping Agent] Error scraping APIs from page:`, error);
    }
    
    return apis;
  }

  async scrapeAPIs(browser, service) {
    const apis = [];
    
    try {
      const page = await browser.newPage();
      await page.goto(service.apiDocsUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Wait for content to load
      await page.waitForTimeout(2000);
      
      // Extract API endpoints
      const apiData = await page.evaluate((patterns) => {
        const apis = [];
        const links = document.querySelectorAll('a[href*="/api/"], a[href*="/v1/"], a[href*="/v5/"], a[href*="/apis/"]');
        
        links.forEach(link => {
          const href = link.getAttribute('href');
          const text = link.textContent.trim();
          
          if (href && text) {
            apis.push({
              endpoint: href,
              name: text,
              description: link.getAttribute('title') || '',
              method: this.detectMethod(href),
              url: new URL(href, window.location.origin).href
            });
          }
        });
        
        return apis;
      }, service.patterns);

      apis.push(...apiData);
      
      // Also try to find OpenAPI/Swagger specs
      const openApiSpecs = await this.findOpenAPISpecs(page, service);
      apis.push(...openApiSpecs);
      
      await page.close();
      
    } catch (error) {
      console.error(`[Web Scraping Agent] Error scraping APIs:`, error);
    }
    
    return apis;
  }

  async scrapeSchemasFromPage(page, baseUrl) {
    const schemas = [];
    
    try {
      // Extract schemas using universal patterns
      const schemaData = await page.evaluate((patterns) => {
        const schemas = [];
        
        // Look for JSON-LD schemas
        const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
        jsonLdScripts.forEach(script => {
          try {
            const data = JSON.parse(script.textContent);
            if (data['@type'] === 'APIReference' || data['@type'] === 'WebAPI' || data['@type'] === 'SoftwareApplication') {
              schemas.push({
                type: 'json-ld',
                name: data.name || data.title || 'Unknown',
                description: data.description || '',
                schema: data,
                source: 'json-ld'
              });
            }
          } catch (e) {
            // Ignore parsing errors
          }
        });
        
        // Look for OpenAPI specs
        const openApiScripts = document.querySelectorAll('script[type="application/json"]');
        openApiScripts.forEach(script => {
          try {
            const data = JSON.parse(script.textContent);
            if (data.openapi || data.swagger) {
              schemas.push({
                type: 'openapi',
                name: data.info?.title || 'OpenAPI Spec',
                description: data.info?.description || '',
                version: data.info?.version || '1.0.0',
                schema: data,
                source: 'openapi'
              });
            }
          } catch (e) {
            // Ignore parsing errors
          }
        });
        
        // Look for schema patterns in text content
        const bodyText = document.body.textContent;
        for (const pattern of patterns) {
          const matches = bodyText.match(pattern);
          if (matches) {
            matches.forEach((match, index) => {
              try {
                const schemaData = JSON.parse(match);
                schemas.push({
                  type: 'json-schema',
                  name: `Schema ${index + 1}`,
                  description: 'Found in page content',
                  schema: schemaData,
                  source: 'content-detection'
                });
              } catch (e) {
                // Not valid JSON, skip
              }
            });
          }
        }
        
        return schemas;
      }, this.universalPatterns.schemas);
      
      schemas.push(...schemaData);
      
      // Look for downloadable schema files
      const schemaFiles = await this.findSchemaFiles(page);
      schemas.push(...schemaFiles);
      
    } catch (error) {
      console.error(`[Web Scraping Agent] Error scraping schemas from page:`, error);
    }
    
    return schemas;
  }

  async scrapeSchemas(browser, service) {
    const schemas = [];
    
    try {
      const page = await browser.newPage();
      await page.goto(service.schemasUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Wait for content to load
      await page.waitForTimeout(2000);
      
      // Extract JSON schemas
      const schemaData = await page.evaluate(() => {
        const schemas = [];
        
        // Look for JSON-LD schemas
        const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
        jsonLdScripts.forEach(script => {
          try {
            const data = JSON.parse(script.textContent);
            if (data['@type'] === 'APIReference' || data['@type'] === 'WebAPI') {
              schemas.push({
                type: 'json-ld',
                name: data.name || 'Unknown',
                description: data.description || '',
                schema: data
              });
            }
          } catch (e) {
            // Ignore parsing errors
          }
        });
        
        // Look for OpenAPI specs
        const openApiScripts = document.querySelectorAll('script[type="application/json"]');
        openApiScripts.forEach(script => {
          try {
            const data = JSON.parse(script.textContent);
            if (data.openapi || data.swagger) {
              schemas.push({
                type: 'openapi',
                name: data.info?.title || 'OpenAPI Spec',
                description: data.info?.description || '',
                version: data.info?.version || '1.0.0',
                schema: data
              });
            }
          } catch (e) {
            // Ignore parsing errors
          }
        });
        
        return schemas;
      });
      
      schemas.push(...schemaData);
      
      await page.close();
      
    } catch (error) {
      console.error(`[Web Scraping Agent] Error scraping schemas:`, error);
    }
    
    return schemas;
  }

  async scrapeDocumentationFromPage(page, baseUrl) {
    const documentation = [];
    
    try {
      // Extract documentation using universal patterns
      const docData = await page.evaluate((patterns) => {
        const docs = [];
        
        // Look for documentation sections
        const docSections = document.querySelectorAll('article, .doc-content, .api-doc, .markdown-body, .documentation, .docs, .content, main, section');
        
        docSections.forEach((section, index) => {
          const title = section.querySelector('h1, h2, h3, h4')?.textContent?.trim() || `Documentation ${index + 1}`;
          const content = section.textContent?.trim() || '';
          
          if (content.length > 100) { // Only include substantial content
            docs.push({
              title: title,
              content: content.substring(0, 3000), // Limit content length
              url: window.location.href,
              section: index + 1,
              source: 'section-detection'
            });
          }
        });
        
        // Look for code blocks and examples
        const codeBlocks = document.querySelectorAll('pre, code, .code-block, .example');
        codeBlocks.forEach((block, index) => {
          const content = block.textContent?.trim() || '';
          if (content.length > 50) {
            docs.push({
              title: `Code Example ${index + 1}`,
              content: content.substring(0, 2000),
              url: window.location.href,
              section: `code-${index + 1}`,
              source: 'code-detection'
            });
          }
        });
        
        // Look for documentation in text content using patterns
        const bodyText = document.body.textContent;
        for (const pattern of patterns) {
          const matches = bodyText.match(pattern);
          if (matches) {
            matches.forEach((match, index) => {
              docs.push({
                title: `Documentation Pattern ${index + 1}`,
                content: match.substring(0, 2000),
                url: window.location.href,
                section: `pattern-${index + 1}`,
                source: 'pattern-detection'
              });
            });
          }
        }
        
        return docs;
      }, this.universalPatterns.documentation);
      
      documentation.push(...docData);
      
    } catch (error) {
      console.error(`[Web Scraping Agent] Error scraping documentation from page:`, error);
    }
    
    return documentation;
  }

  async scrapeDocumentation(browser, service) {
    const documentation = [];
    
    try {
      const page = await browser.newPage();
      await page.goto(service.baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Wait for content to load
      await page.waitForTimeout(2000);
      
      // Extract documentation
      const docData = await page.evaluate(() => {
        const docs = [];
        
        // Look for documentation sections
        const docSections = document.querySelectorAll('article, .doc-content, .api-doc, .markdown-body');
        
        docSections.forEach((section, index) => {
          const title = section.querySelector('h1, h2, h3')?.textContent?.trim() || `Documentation ${index + 1}`;
          const content = section.textContent?.trim() || '';
          
          if (content.length > 100) { // Only include substantial content
            docs.push({
              title: title,
              content: content.substring(0, 2000), // Limit content length
              url: window.location.href,
              section: index + 1
            });
          }
        });
        
        return docs;
      });
      
      documentation.push(...docData);
      
      await page.close();
      
    } catch (error) {
      console.error(`[Web Scraping Agent] Error scraping documentation:`, error);
    }
    
    return documentation;
  }

  async followAndScrapeLinks(page, baseUrl, results, options) {
    try {
      // Find relevant links to follow
      const linksToFollow = await page.evaluate((baseUrl) => {
        const links = [];
        const allLinks = document.querySelectorAll('a[href]');
        
        allLinks.forEach(link => {
          const href = link.getAttribute('href');
          if (href) {
            const fullUrl = new URL(href, window.location.origin).href;
            
            // Only follow links that are likely to contain APIs, schemas, or docs
            const relevantPatterns = [
              /\/api\//, /\/docs\//, /\/developer\//, /\/reference\//, 
              /\/swagger\//, /\/openapi\//, /\/graphql\//, /\/rest\//,
              /\/v[0-9]+\//, /\/spec\//, /\/schema\//
            ];
            
            const isRelevant = relevantPatterns.some(pattern => pattern.test(href));
            const isSameDomain = fullUrl.startsWith(baseUrl);
            
            if (isRelevant && isSameDomain) {
              links.push({
                url: fullUrl,
                text: link.textContent.trim(),
                title: link.getAttribute('title') || ''
              });
            }
          }
        });
        
        return links.slice(0, 10); // Limit to 10 links to avoid infinite loops
      }, baseUrl);

      // Follow each link and scrape content
      for (const link of linksToFollow) {
        try {
          const newPage = await page.browser().newPage();
          await newPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
          
          await newPage.goto(link.url, { waitUntil: 'networkidle2', timeout: 15000 });
          await newPage.waitForTimeout(2000);
          
          // Scrape content from this page
          if (options.scrapeApis !== false) {
            const apis = await this.scrapeAPIsFromPage(newPage, link.url);
            results.apis.push(...apis);
          }
          
          if (options.scrapeSchemas !== false) {
            const schemas = await this.scrapeSchemasFromPage(newPage, link.url);
            results.schemas.push(...schemas);
          }
          
          if (options.scrapeDocumentation !== false) {
            const docs = await this.scrapeDocumentationFromPage(newPage, link.url);
            results.documentation.push(...docs);
          }
          
          await newPage.close();
          
        } catch (error) {
          console.log(`[Web Scraping Agent] Failed to follow link ${link.url}: ${error.message}`);
        }
      }
      
    } catch (error) {
      console.error(`[Web Scraping Agent] Error following links:`, error);
    }
  }

  async findOpenAPISpecs(page, service) {
    try {
      // Look for OpenAPI spec URLs
      const openApiUrls = await page.evaluate(() => {
        const urls = [];
        const links = document.querySelectorAll('a[href*="openapi"], a[href*="swagger"], a[href*="api.json"], a[href*="api.yaml"]');
        
        links.forEach(link => {
          const href = link.getAttribute('href');
          if (href) {
            urls.push(new URL(href, window.location.origin).href);
          }
        });
        
        return urls;
      });

      const apis = [];
      
      // Fetch OpenAPI specs
      for (const url of openApiUrls.slice(0, 5)) { // Limit to 5 specs
        try {
          const response = await axios.get(url, { timeout: 10000 });
          const spec = response.data;
          
          if (spec.paths) {
            Object.entries(spec.paths).forEach(([path, methods]) => {
              Object.entries(methods).forEach(([method, details]) => {
                apis.push({
                  endpoint: path,
                  name: details.summary || details.operationId || path,
                  description: details.description || '',
                  method: method.toUpperCase(),
                  url: url,
                  openApiSpec: true
                });
              });
            });
          }
        } catch (error) {
          console.error(`[Web Scraping Agent] Error fetching OpenAPI spec ${url}:`, error.message);
        }
      }
      
      return apis;
      
    } catch (error) {
      console.error(`[Web Scraping Agent] Error finding OpenAPI specs:`, error);
      return [];
    }
  }

  async findGraphQLEndpoints(page) {
    try {
      const graphqlEndpoints = await page.evaluate(() => {
        const endpoints = [];
        
        // Look for GraphQL endpoints in links
        const links = document.querySelectorAll('a[href*="graphql"], a[href*="/gql"]');
        links.forEach(link => {
          const href = link.getAttribute('href');
          if (href) {
            endpoints.push({
              endpoint: href,
              name: link.textContent.trim() || 'GraphQL Endpoint',
              description: 'GraphQL API endpoint',
              method: 'POST',
              url: new URL(href, window.location.origin).href,
              type: 'graphql'
            });
          }
        });
        
        // Look for GraphQL in text content
        const bodyText = document.body.textContent;
        const graphqlPatterns = [/\/graphql/g, /\/gql/g, /graphql\./g];
        
        graphqlPatterns.forEach(pattern => {
          const matches = bodyText.match(pattern);
          if (matches) {
            matches.forEach(match => {
              endpoints.push({
                endpoint: match,
                name: `GraphQL: ${match}`,
                description: 'GraphQL endpoint found in content',
                method: 'POST',
                url: new URL(match, window.location.origin).href,
                type: 'graphql'
              });
            });
          }
        });
        
        return endpoints;
      });
      
      return graphqlEndpoints;
      
    } catch (error) {
      console.error(`[Web Scraping Agent] Error finding GraphQL endpoints:`, error);
      return [];
    }
  }

  async findSchemaFiles(page) {
    try {
      const schemaFiles = await page.evaluate(() => {
        const files = [];
        
        // Look for downloadable schema files
        const links = document.querySelectorAll('a[href*=".json"], a[href*=".yaml"], a[href*=".yml"], a[href*="schema"]');
        
        links.forEach(link => {
          const href = link.getAttribute('href');
          const text = link.textContent.trim();
          
          if (href && (href.includes('.json') || href.includes('.yaml') || href.includes('.yml') || href.includes('schema'))) {
            files.push({
              url: new URL(href, window.location.origin).href,
              name: text || href.split('/').pop(),
              type: 'downloadable-schema',
              description: `Schema file: ${href}`
            });
          }
        });
        
        return files;
      });
      
      return schemaFiles;
      
    } catch (error) {
      console.error(`[Web Scraping Agent] Error finding schema files:`, error);
      return [];
    }
  }

  detectMethod(endpoint) {
    const methodPatterns = {
      'GET': /\/get\//i,
      'POST': /\/post\//i,
      'PUT': /\/put\//i,
      'DELETE': /\/delete\//i,
      'PATCH': /\/patch\//i
    };
    
    for (const [method, pattern] of Object.entries(methodPatterns)) {
      if (pattern.test(endpoint)) {
        return method;
      }
    }
    
    return 'GET'; // Default to GET
  }

  async saveToNamespace(scrapedData, namespaceId, dynamodbClient) {
    console.log(`[Web Scraping Agent] Saving scraped data to namespace: ${namespaceId}`);
    
    const savedItems = {
      schemas: [],
      apis: [],
      documentation: []
    };

    try {
      // Check if tables exist first
      const tableNames = ['schemas', 'apis', 'documentation'];
      for (const tableName of tableNames) {
        try {
          await dynamodbClient.describeTable({ TableName: tableName }).promise();
        } catch (error) {
          if (error.name === 'ResourceNotFoundException') {
            console.log(`[Web Scraping Agent] Table ${tableName} does not exist, creating it...`);
            await this.createTable(dynamodbClient, tableName);
          } else {
            throw error;
          }
        }
      }

      // Save schemas
      for (const schema of scrapedData.schemas) {
        const schemaItem = {
          id: `scraped-schema-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          namespaceId: namespaceId,
          name: schema.name,
          description: schema.description || `Scraped schema from ${scrapedData.service}`,
          content: JSON.stringify(schema.schema, null, 2),
          type: schema.type || 'json',
          source: 'web-scraping',
          service: scrapedData.service,
          scrapedAt: scrapedData.timestamp,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        await dynamodbClient.put({
          TableName: 'schemas',
          Item: schemaItem
        }).promise();

        savedItems.schemas.push(schemaItem);
        console.log(`[Web Scraping Agent] Saved schema: ${schema.name}`);
      }

      // Save APIs
      for (const api of scrapedData.apis) {
        const apiItem = {
          id: `scraped-api-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          namespaceId: namespaceId,
          name: api.name,
          description: api.description || `Scraped API from ${scrapedData.service}`,
          endpoint: api.endpoint,
          method: api.method,
          url: api.url,
          source: 'web-scraping',
          service: scrapedData.service,
          scrapedAt: scrapedData.timestamp,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        await dynamodbClient.put({
          TableName: 'apis',
          Item: apiItem
        }).promise();

        savedItems.apis.push(apiItem);
        console.log(`[Web Scraping Agent] Saved API: ${api.name}`);
      }

      // Save documentation
      for (const doc of scrapedData.documentation) {
        const docItem = {
          id: `scraped-doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          namespaceId: namespaceId,
          title: doc.title,
          content: doc.content,
          url: doc.url,
          source: 'web-scraping',
          service: scrapedData.service,
          scrapedAt: scrapedData.timestamp,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        await dynamodbClient.put({
          TableName: 'documentation',
          Item: docItem
        }).promise();

        savedItems.documentation.push(docItem);
        console.log(`[Web Scraping Agent] Saved documentation: ${doc.title}`);
      }

      console.log(`[Web Scraping Agent] Successfully saved ${savedItems.schemas.length} schemas, ${savedItems.apis.length} APIs, ${savedItems.documentation.length} docs`);
      
      return {
        success: true,
        savedItems,
        summary: {
          schemas: savedItems.schemas.length,
          apis: savedItems.apis.length,
          documentation: savedItems.documentation.length,
          service: scrapedData.service,
          timestamp: scrapedData.timestamp
        }
      };

    } catch (error) {
      console.error(`[Web Scraping Agent] Error saving to namespace:`, error);
      return {
        success: false,
        error: error.message,
        savedItems
      };
    }
  }

  async createTable(dynamodbClient, tableName) {
    const tableDefinitions = {
      schemas: {
        TableName: 'schemas',
        KeySchema: [
          { AttributeName: 'id', KeyType: 'HASH' }
        ],
        AttributeDefinitions: [
          { AttributeName: 'id', AttributeType: 'S' }
        ],
        BillingMode: 'PAY_PER_REQUEST'
      },
      apis: {
        TableName: 'apis',
        KeySchema: [
          { AttributeName: 'id', KeyType: 'HASH' }
        ],
        AttributeDefinitions: [
          { AttributeName: 'id', AttributeType: 'S' }
        ],
        BillingMode: 'PAY_PER_REQUEST'
      },
      documentation: {
        TableName: 'documentation',
        KeySchema: [
          { AttributeName: 'id', KeyType: 'HASH' }
        ],
        AttributeDefinitions: [
          { AttributeName: 'id', AttributeType: 'S' }
        ],
        BillingMode: 'PAY_PER_REQUEST'
      }
    };

    try {
      await dynamodbClient.createTable(tableDefinitions[tableName]).promise();
      console.log(`[Web Scraping Agent] Created table: ${tableName}`);
      
      // Wait for table to be active
      await this.waitForTableActive(dynamodbClient, tableName);
    } catch (error) {
      console.error(`[Web Scraping Agent] Error creating table ${tableName}:`, error);
      throw error;
    }
  }

  async waitForTableActive(dynamodbClient, tableName) {
    let attempts = 0;
    const maxAttempts = 30;
    
    while (attempts < maxAttempts) {
      try {
        const result = await dynamodbClient.describeTable({ TableName: tableName }).promise();
        if (result.Table.TableStatus === 'ACTIVE') {
          console.log(`[Web Scraping Agent] Table ${tableName} is now active`);
          return;
        }
      } catch (error) {
        console.error(`[Web Scraping Agent] Error checking table status:`, error);
      }
      
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    }
    
    throw new Error(`Table ${tableName} did not become active within expected time`);
  }

  extractDomainName(url) {
    try {
      const domain = new URL(url).hostname;
      return domain.replace(/^www\./, '').split('.')[0];
    } catch (error) {
      return 'unknown';
    }
  }

  getSupportedServices() {
    const knownServices = Object.keys(this.servicePatterns).map(key => ({
      key,
      name: this.servicePatterns[key].name,
      type: 'known-service'
    }));
    
    return [
      ...knownServices,
      {
        key: 'custom-url',
        name: 'Custom URL',
        type: 'custom-url',
        description: 'Enter any URL to scrape APIs, schemas, and documentation'
      }
    ];
  }
}

export default WebScrapingAgent;
 