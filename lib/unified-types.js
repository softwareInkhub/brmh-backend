// Schema Types
export const SchemaType = {
  OBJECT: 'object',
  ARRAY: 'array',
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  NULL: 'null'
};

// HTTP Method Types
export const HttpMethod = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DELETE'
};

// Pagination Types
export const PaginationType = {
  LINK: 'link',
  BOOKMARK: 'bookmark'
};

// Table Status Types
export const TableStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  TABLE_DELETED: 'TABLE_DELETED'
};

// Error Types
export class SchemaGenerationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'SchemaGenerationError';
    this.details = details;
  }
}

export class SchemaValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'SchemaValidationError';
    this.details = details;
  }
}

// Interface Types
export const NamespaceInput = {
  type: 'object',
  required: ['namespace-name', 'namespace-url'],
  properties: {
    'namespace-name': { type: 'string' },
    'namespace-url': { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } }
  }
};

export const NamespaceAccountInput = {
  type: 'object',
  required: ['namespace-account-name'],
  properties: {
    'namespace-account-name': { type: 'string' },
    'namespace-account-url-override': { type: 'string' },
    'namespace-account-header': {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'string' }
        }
      }
    },
    variables: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'string' }
        }
      }
    },
    tags: { type: 'array', items: { type: 'string' } }
  }
};

export const NamespaceMethodInput = {
  type: 'object',
  required: ['namespace-method-name', 'namespace-method-type'],
  properties: {
    'namespace-method-name': { type: 'string' },
    'namespace-method-type': { type: 'string', enum: Object.values(HttpMethod) },
    'namespace-method-url-override': { type: ['string', 'null'] },
    'save-data': { type: 'boolean', default: false },
    isInitialized: { type: 'boolean', default: false },
    tags: { type: 'array', items: { type: 'string' } },
    'namespace-method-queryParams': {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: ['string', 'null'] }
        }
      }
    },
    'namespace-method-header': {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: ['string', 'null'] }
        }
      }
    },
    'sample-request': { type: ['object', 'null'] },
    'sample-response': { type: ['object', 'null'] },
    'request-schema': { type: ['object', 'null'] },
    'response-schema': { type: ['object', 'null'] }
  }
}; 