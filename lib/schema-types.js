// Schema Types
export const SchemaType = {
  STRING: 'string',
  NUMBER: 'number',
  OBJECT: 'object',
  ARRAY: 'array',
  NULL: 'null'
};

// Schema Property Interface
export const SchemaProperty = {
  type: SchemaType,
  properties: {}, // For object type
  items: {}, // For array type
  required: [] // For object type
};

// Schema Interface
export const Schema = {
  id: String,
  methodId: String,
  schemaName: String,
  methodName: String,
  namespaceId: String,
  schemaType: String,
  schema: SchemaProperty,
  isArray: Boolean,
  originalType: String,
  url: String,
  createdAt: String,
  updatedAt: String
};

// Schema Generation Request Interface
export const SchemaGenerationRequest = {
  responseData: Object
};

// Schema Save Request Interface
export const SchemaSaveRequest = {
  methodId: String,
  schemaName: String,
  methodName: String,
  namespaceId: String,
  schemaType: String,
  schema: SchemaProperty,
  isArray: Boolean,
  originalType: String,
  url: String
};

// Schema Update Request Interface
export const SchemaUpdateRequest = {
  schemaName: String,
  schema: SchemaProperty,
  isArray: Boolean,
  originalType: String,
  url: String
};

// Schema Response Interface
export const SchemaResponse = {
  schema: Schema,
  isArray: Boolean,
  originalType: String
};

// Schema List Response Interface
export const SchemaListResponse = {
  schemas: [Schema]
};

// Error Response Interface
export const ErrorResponse = {
  error: String,
  details: String
};

// Schema Validation Request Interface
export const SchemaValidationRequest = {
  schema: Object,
  data: Object
};

// Schema Validation Response Interface
export const SchemaValidationResponse = {
  valid: Boolean,
  errors: [String]
}; 

export const SchemaTableMeta = {
  id: String,
  schemaId: String,
  tableName: String,
  createdAt: String,
  details: Object
};

export const InsertSchemaDataRequest = {
  tableName: String,
  item: Object
}; 