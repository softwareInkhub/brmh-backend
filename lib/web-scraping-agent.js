import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';

class WebScrapingAgent {
  constructor() {
    // Universal patterns for detecting APIs, schemas, and documentation
    this.universalPatterns = {
      // API endpoint patterns - improved to avoid overlaps
      apiEndpoints: [
        // Specific API version patterns (more specific first)
        /\/api\/v[0-9]+\/[a-zA-Z0-9\/\-_]+/g,
        /\/rest\/v[0-9]+\/[a-zA-Z0-9\/\-_]+/g,
        /\/v[0-9]+\/[a-zA-Z0-9\/\-_]+/g,
        // General API patterns (less specific)
        /\/api\/[a-zA-Z0-9\/\-_]+/g,
        /\/rest\/[a-zA-Z0-9\/\-_]+/g,
        // Special endpoints
        /\/graphql/g,
        /\/swagger/g,
        /\/openapi/g,
        // Documentation endpoints (exclude these as they're not functional APIs)
        // /\/docs\/api/g,  // Commented out to prevent non-functional API detection
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

  // New method to find existing namespace by service name
  async findNamespaceByServiceName(serviceName, dynamodbClient) {
    try {
      console.log(`[Web Scraping Agent] Looking for existing namespace for service: ${serviceName}`);
      
      // Scan all namespaces (like unified handlers do)
      const scanResult = await dynamodbClient.send(new ScanCommand({
        TableName: 'brmh-namespace'
      }));
      
      console.log(`[Web Scraping Agent] Found ${scanResult.Items?.length || 0} total namespaces`);
      
      if (!scanResult.Items) {
        console.log(`[Web Scraping Agent] No namespaces found in database`);
        return null;
      }
      
      // Search through the results manually (more reliable than FilterExpression)
      // Priority: exact match first, then case variations
      const exactMatch = serviceName;
      const caseVariations = [
        serviceName.toLowerCase(),
        serviceName.charAt(0).toUpperCase() + serviceName.slice(1).toLowerCase()
      ];
      
      console.log(`[Web Scraping Agent] Searching for exact match: "${exactMatch}"`);
      console.log(`[Web Scraping Agent] Then case variations: ${caseVariations.join(', ')}`);
      
      // First pass: look for exact match
      for (const item of scanResult.Items) {
        if (item.data && item.data['namespace-name']) {
          const namespaceName = item.data['namespace-name'];
          console.log(`[Web Scraping Agent] Checking namespace: "${namespaceName}" (ID: ${item.data['namespace-id']})`);
          
          if (namespaceName === exactMatch) {
            console.log(`[Web Scraping Agent] Found exact match: ${item.data['namespace-id']} for service: ${serviceName}`);
            return item.data;
          }
        }
      }
      
      // Second pass: look for case variations
      for (const item of scanResult.Items) {
        if (item.data && item.data['namespace-name']) {
          const namespaceName = item.data['namespace-name'];
          
          if (caseVariations.includes(namespaceName)) {
            console.log(`[Web Scraping Agent] Found case variation match: ${item.data['namespace-id']} for service: ${serviceName}`);
            return item.data;
          }
        }
      }

      console.log(`[Web Scraping Agent] No existing namespace found for service: ${serviceName}`);
      return null;
    } catch (error) {
      console.error(`[Web Scraping Agent] Error finding namespace for service ${serviceName}:`, error);
      return null;
    }
  }

  // New method to create a new namespace for a service
  async createNamespaceForService(serviceName, sourceUrl = null, dynamodbClient) {
    try {
      console.log(`[Web Scraping Agent] Creating new namespace for service: ${serviceName}`);
      
      const namespaceId = uuidv4();
      const namespaceName = this.extractServiceName(sourceUrl) || serviceName;
      
      const namespaceData = {
        'namespace-id': namespaceId,
        'namespace-name': namespaceName,
        'namespace-url': sourceUrl || `https://${serviceName.toLowerCase()}.com`,
        'tags': [serviceName.toLowerCase(), 'web-scraped', 'api'],
        'namespace-accounts': [],
        'namespace-methods': [],
        'created-via': 'web-scraping',
        'scraped-service': serviceName,
        'created-at': new Date().toISOString()
      };

      const item = {
        id: namespaceId,
        type: 'namespace',
        data: namespaceData
      };

      await dynamodbClient.send(new PutCommand({
        TableName: 'brmh-namespace',
        Item: item
      }));

      console.log(`[Web Scraping Agent] Created new namespace: ${namespaceId} for service: ${serviceName}`);
      return namespaceData;
    } catch (error) {
      console.error(`[Web Scraping Agent] Error creating namespace for service ${serviceName}:`, error);
      throw error;
    }
  }

  // New method to get namespace by ID
  async getNamespaceById(namespaceId, dynamodbClient) {
    try {
      console.log(`[Web Scraping Agent] Looking for namespace by ID: ${namespaceId}`);
      
      const result = await dynamodbClient.send(new GetCommand({
        TableName: 'brmh-namespace',
        Key: { id: namespaceId }
      }));

      if (result.Item && result.Item.data) {
        console.log(`[Web Scraping Agent] Found namespace: ${result.Item.data['namespace-name']} (${namespaceId})`);
        return result.Item.data;
      }

      console.log(`[Web Scraping Agent] Namespace not found: ${namespaceId}`);
      return null;
    } catch (error) {
      console.error(`[Web Scraping Agent] Error getting namespace by ID ${namespaceId}:`, error);
      return null;
    }
  }

  // New method to get or create namespace for a service
  async getOrCreateNamespaceForService(serviceName, sourceUrl = null, dynamodbClient) {
    try {
      // First, try to find an existing namespace
      const existingNamespace = await this.findNamespaceByServiceName(serviceName, dynamodbClient);
      
      if (existingNamespace) {
        console.log(`[Web Scraping Agent] Using existing namespace: ${existingNamespace['namespace-id']}`);
        return existingNamespace;
      }

      // If no existing namespace found, create a new one
      const newNamespace = await this.createNamespaceForService(serviceName, sourceUrl, dynamodbClient);
      console.log(`[Web Scraping Agent] Created and using new namespace: ${newNamespace['namespace-id']}`);
      return newNamespace;
    } catch (error) {
      console.error(`[Web Scraping Agent] Error getting or creating namespace for service ${serviceName}:`, error);
      throw error;
    }
  }

  // Modified main scraping method to handle namespace management
  async scrapeService(serviceName, options = {}, docClient = null, providedNamespaceId = null) {
    console.log(`[Web Scraping Agent] Starting scrape for service: ${serviceName}${providedNamespaceId ? ` to namespace: ${providedNamespaceId}` : ''}`);
    
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
      sourceUrl: isUrl ? serviceName : null,
      namespaceInfo: null
    };

    try {
      if (isUrl) {
        // Scrape from custom URL using axios and cheerio
        console.log(`[Web Scraping Agent] Scraping from custom URL: ${serviceName}`);
        await this.scrapeFromUrlSimple(serviceName, results, options);
      } else {
        // Scrape from known service
        console.log(`[Web Scraping Agent] Scraping from known service: ${serviceName}`);
        await this.scrapeFromKnownServiceSimple(serviceName, results, options);
      }
      
      console.log(`[Web Scraping Agent] Scraping completed for ${results.service}`);
      console.log(`[Web Scraping Agent] Results: ${results.apis.length} APIs, ${results.schemas.length} schemas, ${results.documentation.length} docs`);
      
      // Handle namespace management if DynamoDB client is provided
      if (docClient) {
        try {
          if (providedNamespaceId) {
            // Use the provided namespace ID
            console.log(`[Web Scraping Agent] Using provided namespace: ${providedNamespaceId}`);
            const namespaceInfo = await this.getNamespaceById(providedNamespaceId, docClient);
            if (namespaceInfo) {
              results.namespaceInfo = namespaceInfo;
              console.log(`[Web Scraping Agent] Using existing namespace: ${namespaceInfo['namespace-id']}`);
            } else {
              console.error(`[Web Scraping Agent] Provided namespace ${providedNamespaceId} not found, falling back to auto-creation`);
              const namespaceInfo = await this.getOrCreateNamespaceForService(
                results.service, 
                results.sourceUrl, 
                docClient
              );
              results.namespaceInfo = namespaceInfo;
            }
          } else {
            // Auto-manage namespace
            const namespaceInfo = await this.getOrCreateNamespaceForService(
              results.service, 
              results.sourceUrl, 
              docClient
            );
            results.namespaceInfo = namespaceInfo;
            console.log(`[Web Scraping Agent] Namespace management completed: ${namespaceInfo['namespace-id']}`);
          }
        } catch (namespaceError) {
          console.error(`[Web Scraping Agent] Error in namespace management:`, namespaceError);
          results.errors.push(`Namespace management error: ${namespaceError.message}`);
        }
      }
      
      return results;

    } catch (error) {
      console.error(`[Web Scraping Agent] Error scraping ${results.service}:`, error);
      results.errors.push(error.message);
      return results;
    }
  }

  async scrapeFromUrlSimple(url, results, options) {
    try {
      console.log(`[Web Scraping Agent] Scraping from URL: ${url}`);
      
      // Fetch the page content using axios
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        timeout: 15000
      });
      
      const html = response.data;
      const $ = cheerio.load(html);
      
      // Scrape everything from this URL
      if (options.scrapeApis !== false) {
        results.apis = await this.scrapeAPIsFromHTML($, url);
      }
      
      if (options.scrapeSchemas !== false) {
        results.schemas = await this.scrapeSchemasFromHTML($, url);
      }
      
      if (options.scrapeDocumentation !== false) {
        results.documentation = await this.scrapeDocumentationFromHTML($, url);
      }
      
      // Try to find OpenAPI/Swagger specs
      await this.findAndAddOpenAPISpecs($, url, results);
      
      // Try to find JSON schemas
      await this.findAndAddJSONSchemas($, url, results);
      
      // Try to find documentation files
      await this.findAndAddDocumentationFiles($, url, results);
      
    } catch (error) {
      console.error(`[Web Scraping Agent] Error scraping from URL ${url}:`, error);
      results.errors.push(`Error scraping ${url}: ${error.message}`);
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
      await new Promise(resolve => setTimeout(resolve, 3000));
      
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

  async scrapeFromKnownServiceSimple(serviceName, results, options) {
    const service = this.servicePatterns[serviceName.toLowerCase()];
    
    // Service-specific URLs for better scraping
    const serviceUrls = {
      'shopify': [
        'https://shopify.dev/api/admin-rest',
        'https://shopify.dev/api/storefront',
        'https://shopify.dev/docs/api',
        'https://developers.shopify.com/docs/api'
      ],
      'stripe': [
        'https://stripe.com/docs/api',
        'https://stripe.com/docs/api/customers',
        'https://stripe.com/docs/api/charges'
      ],
      'github': [
        'https://docs.github.com/en/rest',
        'https://docs.github.com/en/rest/reference',
        'https://api.github.com'
      ],
      'google': [
        'https://developers.google.com/apis-explorer',
        'https://developers.google.com/apis',
        'https://console.cloud.google.com/apis'
      ],
      'pinterest': [
        'https://developers.pinterest.com/docs/api/v5',
        'https://developers.pinterest.com/docs'
      ],
      'twitter': [
        'https://developer.twitter.com/en/docs',
        'https://developer.twitter.com/en/docs/api-reference-index'
      ]
    };
    
    const urlsToTry = serviceUrls[serviceName.toLowerCase()] || [
      `https://${serviceName}.com`,
      `https://${serviceName}.dev`,
      `https://developers.${serviceName}.com`,
      `https://docs.${serviceName}.com`,
      `https://api.${serviceName}.com`,
      `https://developer.${serviceName}.com`
    ];
    
    for (const url of urlsToTry) {
      try {
        console.log(`[Web Scraping Agent] Trying URL: ${url}`);
        await this.scrapeFromUrlSimple(url, results, options);
        if (results.apis.length > 0 || results.schemas.length > 0 || results.documentation.length > 0) {
          console.log(`[Web Scraping Agent] Found content at: ${url}`);
          break; // Found content, stop trying other URLs
        }
      } catch (error) {
        console.log(`[Web Scraping Agent] Failed to scrape ${url}: ${error.message}`);
      }
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

  async scrapeAPIsFromHTML($, baseUrl) {
    const apis = [];
    
    try {
      // Find all links that might be API endpoints
      $('a[href]').each((index, element) => {
        const href = $(element).attr('href');
        const text = $(element).text().trim();
        
        if (href && text) {
          // Check if this link matches any API pattern
          for (const pattern of this.universalPatterns.apiEndpoints) {
            if (pattern.test(href)) {
              apis.push({
                endpoint: href,
                name: text,
                description: $(element).attr('title') || $(element).attr('aria-label') || '',
                method: this.detectMethod(href),
                url: new URL(href, baseUrl).href,
                source: 'link-detection'
              });
              break;
            }
          }
        }
      });
      
      // Also look for API endpoints in text content
      const bodyText = $('body').text();
      for (const pattern of this.universalPatterns.apiEndpoints) {
        const matches = bodyText.match(pattern);
        if (matches) {
          matches.forEach(match => {
            apis.push({
              endpoint: match,
              name: `API Endpoint: ${match}`,
              description: 'Found in page content',
              method: this.detectMethod(match),
              url: new URL(match, baseUrl).href,
              source: 'content-detection'
            });
          });
        }
      }
      
      // Find OpenAPI/Swagger specs
      const openApiSpecs = await this.findOpenAPISpecsFromHTML($, baseUrl);
      apis.push(...openApiSpecs);
      
      // Convert all scraped endpoints to OpenAPI format
      const serviceName = this.extractServiceName(baseUrl);
      if (serviceName && apis.length > 0) {
        // Create a comprehensive OpenAPI spec from all endpoints
        const comprehensiveSpec = this.createComprehensiveOpenAPISpec(serviceName, apis);
        
        // Add the comprehensive spec as the main API
        apis.unshift({
          endpoint: '/api/v1',
          name: `${serviceName} Complete API Specification`,
          description: `Comprehensive OpenAPI specification for ${serviceName} with ${apis.length} endpoints`,
          method: 'GET',
          url: baseUrl,
          source: 'comprehensive-openapi',
          openapiSpec: comprehensiveSpec,
          format: 'openapi'
        });
        
        // Also convert individual endpoints to OpenAPI format
        apis.forEach((api, index) => {
          if (!api.openapiSpec) {
            const individualSpec = this.createIndividualOpenAPISpec(serviceName, api);
            api.openapiSpec = individualSpec;
            api.format = 'openapi';
            api.source = api.source + '-openapi';
          }
        });
      }
      
      // Look for GraphQL endpoints
      const graphqlEndpoints = await this.findGraphQLEndpointsFromHTML($);
      apis.push(...graphqlEndpoints);
      
    } catch (error) {
      console.error(`[Web Scraping Agent] Error scraping APIs from HTML:`, error);
    }
    
    return apis;
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
      
      // Deduplicate APIs found on this page
      const deduplicatedApis = this.deduplicateApis(apis);
      console.log(`[Web Scraping Agent] Page ${baseUrl}: Found ${apis.length} APIs, ${deduplicatedApis.length} unique`);
      
    } catch (error) {
      console.error(`[Web Scraping Agent] Error scraping APIs from page:`, error);
    }
    
    return this.deduplicateApis(apis);
  }

  async scrapeAPIs(browser, service) {
    const apis = [];
    
    try {
      const page = await browser.newPage();
      await page.goto(service.apiDocsUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Wait for content to load
      await new Promise(resolve => setTimeout(resolve, 2000));
      
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

  async scrapeSchemasFromHTML($, baseUrl) {
    const schemas = [];
    
    try {
      // Look for JSON-LD schemas
      $('script[type="application/ld+json"]').each((index, element) => {
        try {
          const data = JSON.parse($(element).html());
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
      $('script[type="application/json"]').each((index, element) => {
        try {
          const data = JSON.parse($(element).html());
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
      const bodyText = $('body').text();
      for (const pattern of this.universalPatterns.schemas) {
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
              // Ignore parsing errors
            }
          });
        }
      }
      
    } catch (error) {
      console.error(`[Web Scraping Agent] Error scraping schemas from HTML:`, error);
    }
    
    return schemas;
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
      await new Promise(resolve => setTimeout(resolve, 2000));
      
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

  async scrapeDocumentationFromHTML($, baseUrl) {
    const documentation = [];
    
    try {
      // Look for documentation sections
      $('article, .doc-content, .api-doc, .markdown-body, .documentation, .docs, .content, main, section').each((index, element) => {
        const title = $(element).find('h1, h2, h3, h4').first().text().trim() || `Documentation ${index + 1}`;
        const content = $(element).text().trim();
        
        if (content.length > 100) { // Only include substantial content
          documentation.push({
            title: title,
            content: content.substring(0, 3000), // Limit content length
            url: baseUrl,
            section: index + 1,
            source: 'section-detection'
          });
        }
      });
      
      // Look for code blocks and examples
      $('pre, code, .code-block, .example').each((index, element) => {
        const content = $(element).text().trim();
        if (content.length > 50) {
          documentation.push({
            title: `Code Example ${index + 1}`,
            content: content.substring(0, 2000),
            url: baseUrl,
            section: `code-${index + 1}`,
            source: 'code-detection'
          });
        }
      });
      
      // Look for documentation patterns in text content
      const bodyText = $('body').text();
      for (const pattern of this.universalPatterns.documentation) {
        const matches = bodyText.match(pattern);
        if (matches) {
          matches.forEach((match, index) => {
            documentation.push({
              title: `Documentation ${index + 1}`,
              content: match.substring(0, 2000),
              url: baseUrl,
              section: `pattern-${index + 1}`,
              source: 'pattern-detection'
            });
          });
        }
      }
      
    } catch (error) {
      console.error(`[Web Scraping Agent] Error scraping documentation from HTML:`, error);
    }
    
    return documentation;
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
      await new Promise(resolve => setTimeout(resolve, 2000));
      
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
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Scrape content from this page
          if (options.scrapeApis !== false) {
            const apis = await this.scrapeAPIsFromPage(newPage, link.url);
            // APIs are already deduplicated in scrapeAPIsFromPage, so we can safely push them
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

  async findOpenAPISpecsFromHTML($, baseUrl) {
    const specs = [];
    
    try {
      // Look for OpenAPI/Swagger spec links and fetch them
      const specLinks = [];
      $('a[href*="swagger"], a[href*="openapi"], a[href*="api-docs"], a[href*="spec"]').each((index, element) => {
        const href = $(element).attr('href');
        const text = $(element).text().trim();
        
        if (href && text) {
          specLinks.push({ href, text });
        }
      });
      
      // Fetch OpenAPI specs from the links
      for (const { href, text } of specLinks.slice(0, 10)) { // Limit to 10 specs
        try {
          const specUrl = new URL(href, baseUrl).href;
          const specResponse = await axios.get(specUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 10000
          });
          
          const specData = specResponse.data;
          if (specData.openapi || specData.swagger) {
            specs.push({
              endpoint: href,
              name: text,
              description: 'OpenAPI/Swagger specification',
              method: 'GET',
              url: specUrl,
              source: 'openapi-spec',
              openapiSpec: specData,
              format: 'openapi'
            });
          }
        } catch (error) {
          console.log(`Failed to fetch OpenAPI spec from ${href}: ${error.message}`);
        }
      }
      
      // Look for OpenAPI specs in script tags
      $('script[type="application/json"]').each((index, element) => {
        try {
          const data = JSON.parse($(element).html());
          if (data.openapi || data.swagger) {
            specs.push({
              endpoint: '/openapi-spec',
              name: data.info?.title || 'OpenAPI Specification',
              description: data.info?.description || 'OpenAPI/Swagger specification',
              method: 'GET',
              url: `${baseUrl}/openapi-spec`,
              source: 'openapi-embedded',
              openapiSpec: data,
              format: 'openapi'
            });
          }
        } catch (e) {
          // Ignore parsing errors
        }
      });
      
    } catch (error) {
      console.error(`[Web Scraping Agent] Error finding OpenAPI specs from HTML:`, error);
    }
    
    return specs;
  }

  extractServiceName(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      
      // Extract service name from common patterns
      if (hostname.includes('shopify')) return 'Shopify';
      if (hostname.includes('stripe')) return 'Stripe';
      if (hostname.includes('github')) return 'GitHub';
      if (hostname.includes('google')) return 'Google';
      if (hostname.includes('pinterest')) return 'Pinterest';
      if (hostname.includes('twitter')) return 'Twitter';
      
      // Extract from subdomain or domain
      const parts = hostname.split('.');
      if (parts.length >= 2) {
        return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  createComprehensiveOpenAPISpec(serviceName, apis) {
    const baseUrl = `https://api.${serviceName.toLowerCase()}.com`;
    const paths = {};
    
    // Convert all APIs to OpenAPI paths
    apis.forEach((api, index) => {
      if (api.endpoint && api.endpoint !== '/api/v1') {
        const path = api.endpoint.startsWith('/') ? api.endpoint : `/${api.endpoint}`;
        const method = (api.method || 'GET').toLowerCase();
        
        if (!paths[path]) {
          paths[path] = {};
        }
        
        paths[path][method] = {
          summary: api.name || `API Endpoint ${index + 1}`,
          description: api.description || `Endpoint for ${path}`,
          operationId: `api_${index}`,
          responses: {
            "200": {
              description: "Successful response",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "object",
                        description: "Response data"
                      },
                      success: {
                        type: "boolean",
                        description: "Operation success status"
                      }
                    }
                  }
                }
              }
            },
            "400": {
              description: "Bad request"
            },
            "404": {
              description: "Not found"
            },
            "500": {
              description: "Internal server error"
            }
          }
        };
        
        // Add request body for POST/PUT methods
        if (['post', 'put', 'patch'].includes(method)) {
          paths[path][method].requestBody = {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "object",
                      description: "Request data"
                    }
                  }
                }
              }
            }
          };
        }
      }
    });
    
    return {
      openapi: "3.0.0",
      info: {
        title: `${serviceName} Complete API`,
        description: `Comprehensive OpenAPI specification for ${serviceName} with ${apis.length} endpoints`,
        version: "1.0.0",
        contact: {
          name: `${serviceName} API Support`,
          url: baseUrl
        }
      },
      servers: [
        {
          url: baseUrl,
          description: `${serviceName} API server`
        }
      ],
      paths: paths,
      components: {
        schemas: {
          Error: {
            type: "object",
            properties: {
              error: { type: "string" },
              message: { type: "string" },
              code: { type: "integer" }
            }
          },
          Success: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: { type: "object" }
            }
          }
        }
      }
    };
  }

  createIndividualOpenAPISpec(serviceName, api) {
    const baseUrl = `https://api.${serviceName.toLowerCase()}.com`;
    const path = api.endpoint.startsWith('/') ? api.endpoint : `/${api.endpoint}`;
    const method = (api.method || 'GET').toLowerCase();
    
    const paths = {};
    paths[path] = {};
    paths[path][method] = {
      summary: api.name || `API Endpoint`,
      description: api.description || `Endpoint for ${path}`,
      operationId: `individual_${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`,
      responses: {
        "200": {
          description: "Successful response",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: {
                    type: "object",
                    description: "Response data"
                  },
                  success: {
                    type: "boolean",
                    description: "Operation success status"
                  }
                }
              }
            }
          }
        },
        "400": {
          description: "Bad request"
        },
        "404": {
          description: "Not found"
        },
        "500": {
          description: "Internal server error"
        }
      }
    };
    
    // Add request body for POST/PUT methods
    if (['post', 'put', 'patch'].includes(method)) {
      paths[path][method].requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                data: {
                  type: "object",
                  description: "Request data"
                }
              }
            }
          }
        }
      };
    }
    
    return {
      openapi: "3.0.0",
      info: {
        title: `${serviceName} API - ${api.name || path}`,
        description: api.description || `Individual API endpoint for ${serviceName}`,
        version: "1.0.0"
      },
      servers: [
        {
          url: baseUrl,
          description: `${serviceName} API server`
        }
      ],
      paths: paths
    };
  }

  generateSampleOpenAPISpec(serviceName) {
    const baseUrl = `https://api.${serviceName.toLowerCase()}.com`;
    
    return {
      openapi: "3.0.0",
      info: {
        title: `${serviceName} API`,
        description: `Sample OpenAPI specification for ${serviceName}`,
        version: "1.0.0"
      },
      servers: [
        {
          url: baseUrl,
          description: `${serviceName} API server`
        }
      ],
      paths: {
        "/v1/users": {
          get: {
            summary: "Get Users",
            description: "Retrieve a list of users",
            operationId: "getUsers",
            responses: {
              "200": {
                description: "Successful response",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        users: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              id: { type: "string" },
                              name: { type: "string" },
                              email: { type: "string" }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          post: {
            summary: "Create User",
            description: "Create a new user",
            operationId: "createUser",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      email: { type: "string" }
                    },
                    required: ["name", "email"]
                  }
                }
              }
            },
            responses: {
              "201": {
                description: "User created successfully"
              }
            }
          }
        },
        "/v1/products": {
          get: {
            summary: "Get Products",
            description: "Retrieve a list of products",
            operationId: "getProducts",
            responses: {
              "200": {
                description: "Successful response",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        products: {
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
            }
          }
        }
      }
    };
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

  async findAndAddOpenAPISpecs($, baseUrl, results) {
    try {
      // Look for OpenAPI/Swagger spec links
      $('a[href*="swagger"], a[href*="openapi"], a[href*="api-docs"], a[href*="spec"]').each(async (index, element) => {
        const href = $(element).attr('href');
        const text = $(element).text().trim();
        
        if (href && text) {
          try {
            const specUrl = new URL(href, baseUrl).href;
            const specResponse = await axios.get(specUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
              },
              timeout: 10000
            });
            
            const specData = specResponse.data;
            if (specData.openapi || specData.swagger) {
              results.apis.push({
                endpoint: href,
                name: text,
                description: 'OpenAPI/Swagger specification',
                method: 'GET',
                url: specUrl,
                source: 'openapi-spec',
                openapiSpec: specData,
                format: 'openapi'
              });
            }
          } catch (error) {
            console.log(`Failed to fetch OpenAPI spec from ${href}: ${error.message}`);
          }
        }
      });
      
      // Look for OpenAPI specs in script tags
      $('script[type="application/json"]').each((index, element) => {
        try {
          const data = JSON.parse($(element).html());
          if (data.openapi || data.swagger) {
            results.apis.push({
              endpoint: '/openapi-spec',
              name: data.info?.title || 'OpenAPI Specification',
              description: data.info?.description || 'OpenAPI/Swagger specification',
              method: 'GET',
              url: `${baseUrl}/openapi-spec`,
              source: 'openapi-embedded',
              openapiSpec: data,
              format: 'openapi'
            });
          }
        } catch (e) {
          // Ignore parsing errors
        }
      });
      
    } catch (error) {
      console.error(`[Web Scraping Agent] Error finding OpenAPI specs:`, error);
    }
  }

  async findAndAddJSONSchemas($, baseUrl, results) {
    try {
      // Look for JSON schema links
      $('a[href*="schema"], a[href*="json"], a[href*="model"]').each(async (index, element) => {
        const href = $(element).attr('href');
        const text = $(element).text().trim();
        
        if (href && text) {
          try {
            const schemaUrl = new URL(href, baseUrl).href;
            const schemaResponse = await axios.get(schemaUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
              },
              timeout: 10000
            });
            
            const schemaData = schemaResponse.data;
            if (schemaData.type === 'object' || schemaData.properties || schemaData.$schema) {
              results.schemas.push({
                type: 'json-schema',
                name: text,
                description: 'JSON Schema definition',
                schema: schemaData,
                source: 'json-schema-file',
                format: 'json'
              });
            }
          } catch (error) {
            console.log(`Failed to fetch JSON schema from ${href}: ${error.message}`);
          }
        }
      });
      
      // Look for JSON schemas in script tags
      $('script[type="application/json"]').each((index, element) => {
        try {
          const data = JSON.parse($(element).html());
          if (data.type === 'object' || data.properties || data.$schema) {
            results.schemas.push({
              type: 'json-schema',
              name: 'Embedded JSON Schema',
              description: 'JSON Schema found in page',
              schema: data,
              source: 'json-schema-embedded',
              format: 'json'
            });
          }
        } catch (e) {
          // Ignore parsing errors
        }
      });
      
    } catch (error) {
      console.error(`[Web Scraping Agent] Error finding JSON schemas:`, error);
    }
  }

  async findAndAddDocumentationFiles($, baseUrl, results) {
    try {
      // Look for documentation file links (PDF, DOC, etc.)
      $('a[href*=".pdf"], a[href*=".doc"], a[href*="docs"], a[href*="documentation"]').each(async (index, element) => {
        const href = $(element).attr('href');
        const text = $(element).text().trim();
        
        if (href && text) {
          try {
            const docUrl = new URL(href, baseUrl).href;
            const docResponse = await axios.get(docUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
              },
              timeout: 10000,
              responseType: 'arraybuffer'
            });
            
            const contentType = docResponse.headers['content-type'];
            if (contentType && (contentType.includes('pdf') || contentType.includes('document'))) {
              const base64Data = Buffer.from(docResponse.data).toString('base64');
              results.documentation.push({
                title: text,
                content: `Documentation file: ${text}`,
                url: docUrl,
                section: index + 1,
                source: 'documentation-file',
                format: 'pdf',
                data: base64Data,
                contentType: contentType
              });
            }
          } catch (error) {
            console.log(`Failed to fetch documentation from ${href}: ${error.message}`);
          }
        }
      });
      
    } catch (error) {
      console.error(`[Web Scraping Agent] Error finding documentation files:`, error);
    }
  }

  async findGraphQLEndpointsFromHTML($) {
    const endpoints = [];
    
    try {
      // Look for GraphQL endpoint links
      $('a[href*="graphql"], a[href*="/graphql"], a[href*="gql"]').each((index, element) => {
        const href = $(element).attr('href');
        const text = $(element).text().trim();
        
        if (href && text) {
          endpoints.push({
            endpoint: href,
            name: text,
            description: 'GraphQL endpoint',
            method: 'POST',
            url: href,
            source: 'graphql-link'
          });
        }
      });
      
      // Look for GraphQL in text content
      const bodyText = $('body').text();
      const graphqlPatterns = [/\/graphql/g, /graphql\./g, /gql\./g];
      
      for (const pattern of graphqlPatterns) {
        const matches = bodyText.match(pattern);
        if (matches) {
          matches.forEach(match => {
            endpoints.push({
              endpoint: match,
              name: `GraphQL Endpoint: ${match}`,
              description: 'GraphQL endpoint found in content',
              method: 'POST',
              url: match,
              source: 'graphql-content'
            });
          });
        }
      }
      
    } catch (error) {
      console.error(`[Web Scraping Agent] Error finding GraphQL endpoints from HTML:`, error);
    }
    
    return endpoints;
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

  // Helper method to generate deterministic ID based on endpoint and method
  generateDeterministicId(endpoint, method, service) {
    const normalizedEndpoint = endpoint.replace(/[^a-zA-Z0-9\/\-_]/g, '_');
    const key = `${service}_${normalizedEndpoint}_${method}`.toLowerCase();
    return `api-${Buffer.from(key).toString('base64').replace(/[^a-zA-Z0-9]/g, '')}`;
  }

  // Helper method to check if API already exists in namespace
  async findExistingApi(endpoint, method, namespaceId, docClient) {
    try {
      // Check in namespace methods table
      const command = new ScanCommand({
        TableName: 'brmh-namespace-methods',
        FilterExpression: 'data.#namespaceId = :namespaceId AND data.#methodName = :methodName AND data.#methodType = :methodType',
        ExpressionAttributeNames: {
          '#namespaceId': 'namespace-id',
          '#methodName': 'namespace-method-name',
          '#methodType': 'namespace-method-type'
        },
        ExpressionAttributeValues: {
          ':namespaceId': namespaceId,
          ':methodName': `API Endpoint: ${endpoint}`,
          ':methodType': method
        }
      });

      const result = await docClient.send(command);
      return result.Items && result.Items.length > 0 ? result.Items[0] : null;
    } catch (error) {
      console.error(`[Web Scraping Agent] Error checking for existing API:`, error);
      return null;
    }
  }

  // Helper method to deduplicate APIs during scraping
  deduplicateApis(apis) {
    const seen = new Set();
    const deduplicated = [];

    for (const api of apis) {
      // Create a unique key based on endpoint and method
      const key = `${api.endpoint}_${api.method}`.toLowerCase();
      
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(api);
      } else {
        console.log(`[Web Scraping Agent] Skipping duplicate API during scraping: ${api.name} (${api.endpoint})`);
      }
    }

    console.log(`[Web Scraping Agent] Deduplicated APIs: ${apis.length} -> ${deduplicated.length}`);
    return deduplicated;
  }

  async saveToNamespace(scrapedData, namespaceId = null, docClient) {
    // Use namespaceId from scrapedData if not provided
    const targetNamespaceId = namespaceId || (scrapedData.namespaceInfo ? scrapedData.namespaceInfo['namespace-id'] : null);
    
    if (!targetNamespaceId) {
      throw new Error('No namespace ID provided and no namespace info found in scraped data');
    }
    
    console.log(`[Web Scraping Agent] Saving scraped data to namespace: ${targetNamespaceId}`);
    
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
          // Use the document client with DescribeTableCommand
          await docClient.send(new DescribeTableCommand({ TableName: tableName }));
        } catch (error) {
          if (error.name === 'ResourceNotFoundException') {
            console.log(`[Web Scraping Agent] Table ${tableName} does not exist, creating it...`);
            await this.createTable(docClient, tableName);
          } else {
            throw error;
          }
        }
      }

      // Save schemas
      for (const schema of scrapedData.schemas) {
        const schemaItem = {
          id: `scraped-schema-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          namespaceId: targetNamespaceId,
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

        await docClient.send(new PutCommand({
          TableName: 'schemas',
          Item: schemaItem
        }));

        savedItems.schemas.push(schemaItem);
        console.log(`[Web Scraping Agent] Saved schema: ${schema.name}`);
      }

      // Deduplicate APIs before saving
      const deduplicatedApis = this.deduplicateApis(scrapedData.apis);
      console.log(`[Web Scraping Agent] Processing ${deduplicatedApis.length} unique APIs (from ${scrapedData.apis.length} total)`);

      // Save APIs and create namespace methods
      for (const api of deduplicatedApis) {
        // Check if API already exists in namespace
        const existingApi = await this.findExistingApi(api.endpoint, api.method, targetNamespaceId, docClient);
        
        if (existingApi) {
          console.log(`[Web Scraping Agent] Skipping duplicate API: ${api.name} (${api.endpoint}) - already exists in namespace`);
          continue;
        }

        // Generate deterministic ID
        const deterministicId = this.generateDeterministicId(api.endpoint, api.method, scrapedData.service);
        
        const apiItem = {
          id: deterministicId,
          namespaceId: targetNamespaceId,
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

        await docClient.send(new PutCommand({
          TableName: 'apis',
          Item: apiItem
        }));

        savedItems.apis.push(apiItem);
        console.log(`[Web Scraping Agent] Saved API: ${api.name}`);

        // Also create a namespace method for this API
        try {
          const methodId = deterministicId; // Use same deterministic ID for consistency
          const methodItem = {
            id: methodId,
            type: 'method',
            data: {
              'namespace-id': targetNamespaceId,
              'namespace-method-id': methodId,
              'namespace-method-name': api.name || `API Endpoint: ${api.endpoint}`,
              'namespace-method-type': api.method || 'GET',
              'namespace-method-url-override': api.url || api.endpoint,
              'namespace-method-queryParams': [],
              'namespace-method-header': [],
              'save-data': false,
              'isInitialized': false,
              'tags': ['web-scraped', scrapedData.service.toLowerCase()],
              'sample-request': null,
              'sample-response': null,
              'request-schema': null,
              'response-schema': null,
              'source': 'web-scraping',
              'original-api': api,
              'created-at': new Date().toISOString()
            }
          };

          await docClient.send(new PutCommand({
            TableName: 'brmh-namespace-methods',
            Item: methodItem
          }));

          console.log(`[Web Scraping Agent] Created namespace method: ${api.name}`);
        } catch (methodError) {
          console.error(`[Web Scraping Agent] Error creating namespace method for ${api.name}:`, methodError);
        }
      }

      // Save documentation
      for (const doc of scrapedData.documentation) {
        const docItem = {
          id: `scraped-doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          namespaceId: targetNamespaceId,
          title: doc.title,
          content: doc.content,
          url: doc.url,
          source: 'web-scraping',
          service: scrapedData.service,
          scrapedAt: scrapedData.timestamp,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        await docClient.send(new PutCommand({
          TableName: 'documentation',
          Item: docItem
        }));

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
          timestamp: scrapedData.timestamp,
          namespaceId: targetNamespaceId,
          namespaceInfo: scrapedData.namespaceInfo
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

  async createTable(docClient, tableName) {
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
      // Use document client with CreateTableCommand
      const { CreateTableCommand } = await import('@aws-sdk/client-dynamodb');
      await docClient.send(new CreateTableCommand(tableDefinitions[tableName]));
      console.log(`[Web Scraping Agent] Created table: ${tableName}`);
      
      // Wait for table to be active
      await this.waitForTableActive(docClient, tableName);
    } catch (error) {
      console.error(`[Web Scraping Agent] Error creating table ${tableName}:`, error);
      throw error;
    }
  }

  async waitForTableActive(docClient, tableName) {
    let attempts = 0;
    const maxAttempts = 30;
    
    while (attempts < maxAttempts) {
      try {
        const result = await docClient.send(new DescribeTableCommand({ TableName: tableName }));
        
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

  // Method to migrate existing namespaces and create missing methods
  async migrateExistingNamespaces(docClient) {
    console.log('[Web Scraping Agent] Starting migration of existing namespaces...\n');

    try {
      // Step 1: Get all scraped APIs
      console.log('[Web Scraping Agent] Fetching all scraped APIs...');
      const apisResult = await docClient.send(new ScanCommand({
        TableName: 'apis',
        FilterExpression: '#source = :source',
        ExpressionAttributeNames: {
          '#source': 'source'
        },
        ExpressionAttributeValues: {
          ':source': 'web-scraping'
        }
      }));

      const scrapedApis = apisResult.Items || [];
      console.log(`[Web Scraping Agent] Found ${scrapedApis.length} scraped APIs`);

      if (scrapedApis.length === 0) {
        console.log('[Web Scraping Agent] No scraped APIs found. Migration not needed.');
        return { success: true, message: 'No scraped APIs found' };
      }

      // Step 2: Get existing namespace methods
      console.log('[Web Scraping Agent] Fetching existing namespace methods...');
      const methodsResult = await docClient.send(new ScanCommand({
        TableName: 'brmh-namespace-methods',
        FilterExpression: '#data.#source = :source',
        ExpressionAttributeNames: {
          '#data': 'data',
          '#source': 'source'
        },
        ExpressionAttributeValues: {
          ':source': 'web-scraping'
        }
      }));

      const existingMethods = methodsResult.Items || [];
      console.log(`[Web Scraping Agent] Found ${existingMethods.length} existing web-scraped methods`);

      // Step 3: Group APIs by namespace
      const apisByNamespace = {};
      scrapedApis.forEach(api => {
        const namespaceId = api.namespaceId;
        if (!apisByNamespace[namespaceId]) {
          apisByNamespace[namespaceId] = [];
        }
        apisByNamespace[namespaceId].push(api);
      });

      // Step 4: Group existing methods by namespace
      const methodsByNamespace = {};
      existingMethods.forEach(method => {
        const namespaceId = method.data['namespace-id'];
        if (!methodsByNamespace[namespaceId]) {
          methodsByNamespace[namespaceId] = [];
        }
        methodsByNamespace[namespaceId].push(method);
      });

      // Step 5: Process each namespace
      let totalMethodsCreated = 0;
      let totalNamespacesProcessed = 0;

      for (const [namespaceId, namespaceApis] of Object.entries(apisByNamespace)) {
        const namespaceMethods = methodsByNamespace[namespaceId] || [];

        console.log(`[Web Scraping Agent] Processing namespace: ${namespaceId}`);
        console.log(`  - Has ${namespaceApis.length} scraped APIs`);
        console.log(`  - Has ${namespaceMethods.length} existing methods`);

        // Check which APIs don't have corresponding methods
        const apisWithoutMethods = namespaceApis.filter(api => {
          // Check if there's already a method for this API
          return !namespaceMethods.some(method => {
            const methodName = method.data['namespace-method-name'];
            const methodUrl = method.data['namespace-method-url-override'];
            return methodName === api.name || methodUrl === api.url || methodUrl === api.endpoint;
          });
        });

        if (apisWithoutMethods.length > 0) {
          console.log(`  - Creating ${apisWithoutMethods.length} missing methods...`);

          for (const api of apisWithoutMethods) {
            try {
              const methodId = uuidv4();
              const methodItem = {
                id: methodId,
                type: 'method',
                data: {
                  'namespace-id': namespaceId,
                  'namespace-method-id': methodId,
                  'namespace-method-name': api.name || `API: ${api.endpoint}`,
                  'namespace-method-type': api.method || 'GET',
                  'namespace-method-url-override': api.url || api.endpoint,
                  'namespace-method-queryParams': [],
                  'namespace-method-header': [],
                  'save-data': false,
                  'isInitialized': false,
                  'tags': ['web-scraped', api.service ? api.service.toLowerCase() : 'unknown'],
                  'sample-request': null,
                  'sample-response': null,
                  'request-schema': null,
                  'response-schema': null,
                  'source': 'web-scraping',
                  'original-api': api,
                  'created-at': new Date().toISOString(),
                  'migrated-at': new Date().toISOString()
                }
              };

              await docClient.send(new PutCommand({
                TableName: 'brmh-namespace-methods',
                Item: methodItem
              }));

              console.log(`    ✓ Created method: ${api.name || api.endpoint}`);
              totalMethodsCreated++;
            } catch (error) {
              console.error(`    ✗ Error creating method for ${api.name}:`, error.message);
            }
          }
        } else {
          console.log(`  - All APIs already have corresponding methods`);
        }

        totalNamespacesProcessed++;
      }

      // Summary
      console.log('\n' + '='.repeat(50));
      console.log('MIGRATION SUMMARY');
      console.log('='.repeat(50));
      console.log(`Total namespaces processed: ${totalNamespacesProcessed}`);
      console.log(`Total methods created: ${totalMethodsCreated}`);
      console.log(`Total scraped APIs found: ${scrapedApis.length}`);
      console.log(`Total existing methods found: ${existingMethods.length}`);
      console.log('='.repeat(50));

      if (totalMethodsCreated > 0) {
        console.log('[Web Scraping Agent] ✅ Migration completed successfully!');
        console.log('[Web Scraping Agent] The methods should now appear in the methods tab for existing namespaces.');
      } else {
        console.log('[Web Scraping Agent] ℹ️  No migration needed - all existing namespaces already have their methods.');
      }

      return {
        success: true,
        summary: {
          namespacesProcessed: totalNamespacesProcessed,
          methodsCreated: totalMethodsCreated,
          scrapedApisFound: scrapedApis.length,
          existingMethodsFound: existingMethods.length
        }
      };

    } catch (error) {
      console.error('[Web Scraping Agent] ❌ Migration failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default WebScrapingAgent; 
 