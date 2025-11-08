# Roles & Permissions API Documentation

This API provides namespace-specific role and permission management for the BRMH platform.

## Base URL
```
https://brmh.in
```

## Table Structure

**Table Name:** `brmh-roles-permissions`

**Primary Key:**
- Partition Key: `namespaceId` (String)
- Sort Key: `roleId` (String)

**Attributes:**
- `roleName` (String) - Display name of the role
- `roleDescription` (String) - Description of the role
- `permissions` (Array of Strings) - List of permissions assigned to this role
- `createdAt` (String) - ISO timestamp of creation
- `updatedAt` (String) - ISO timestamp of last update
- `createdBy` (String) - User ID who created the role
- `isActive` (Boolean) - Whether the role is active
- `metadata` (Object) - Additional metadata

---

## Setup

### 1. Create the DynamoDB Table

Run the setup script to create the table:

```bash
cd brmh-backend
node scripts/create-roles-permissions-table.js
```

This will create the `brmh-roles-permissions` table with:
- On-demand billing mode
- Partition key: `namespaceId`
- Sort key: `roleId`

---

## API Endpoints

### 1. Create a Role

**Endpoint:** `POST /roles-permissions/namespaces/:namespaceId/roles`

**Description:** Create a new role for a specific namespace with permissions.

**URL Parameters:**
- `namespaceId` (required): The namespace ID

**Request Body:**
```json
{
  "roleName": "Admin",
  "roleDescription": "Full administrative access to the namespace",
  "permissions": [
    "read:all",
    "write:all",
    "delete:all",
    "manage:users",
    "manage:roles"
  ],
  "createdBy": "user-123",
  "metadata": {
    "department": "IT",
    "level": "high"
  }
}
```

**Required Fields:**
- `roleName` (String)

**Optional Fields:**
- `roleDescription` (String)
- `permissions` (Array of Strings)
- `createdBy` (String) - defaults to "system"
- `metadata` (Object)

**Example Request:**
```bash
curl -X POST https://brmh.in/roles-permissions/namespaces/ns-123/roles \
  -H "Content-Type: application/json" \
  -d '{
    "roleName": "Admin",
    "roleDescription": "Full administrative access",
    "permissions": ["read:all", "write:all", "delete:all"],
    "createdBy": "user-123"
  }'
```

**Success Response (201):**
```json
{
  "success": true,
  "role": {
    "namespaceId": "ns-123",
    "roleId": "role-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "roleName": "Admin",
    "roleDescription": "Full administrative access",
    "permissions": ["read:all", "write:all", "delete:all"],
    "createdAt": "2025-10-07T12:00:00.000Z",
    "updatedAt": "2025-10-07T12:00:00.000Z",
    "createdBy": "user-123",
    "isActive": true,
    "metadata": {}
  },
  "message": "Role created successfully"
}
```

---

### 2. Get All Roles for a Namespace

**Endpoint:** `GET /roles-permissions/namespaces/:namespaceId/roles`

**Description:** Retrieve all roles for a specific namespace.

**URL Parameters:**
- `namespaceId` (required): The namespace ID

**Query Parameters:**
- `activeOnly` (optional): Filter by active status (default: "true")
  - "true" - Only active roles
  - "false" - All roles (including inactive)

**Example Request:**
```bash
# Get only active roles
curl -X GET "https://brmh.in/roles-permissions/namespaces/ns-123/roles?activeOnly=true"

# Get all roles (including inactive)
curl -X GET "https://brmh.in/roles-permissions/namespaces/ns-123/roles?activeOnly=false"
```

**Success Response (200):**
```json
{
  "success": true,
  "namespaceId": "ns-123",
  "count": 3,
  "roles": [
    {
      "namespaceId": "ns-123",
      "roleId": "role-admin-001",
      "roleName": "Admin",
      "roleDescription": "Full administrative access",
      "permissions": ["read:all", "write:all", "delete:all"],
      "createdAt": "2025-10-07T12:00:00.000Z",
      "updatedAt": "2025-10-07T12:00:00.000Z",
      "createdBy": "user-123",
      "isActive": true,
      "metadata": {}
    },
    {
      "namespaceId": "ns-123",
      "roleId": "role-editor-001",
      "roleName": "Editor",
      "roleDescription": "Can read and write content",
      "permissions": ["read:all", "write:content"],
      "createdAt": "2025-10-07T12:05:00.000Z",
      "updatedAt": "2025-10-07T12:05:00.000Z",
      "createdBy": "user-123",
      "isActive": true,
      "metadata": {}
    },
    {
      "namespaceId": "ns-123",
      "roleId": "role-viewer-001",
      "roleName": "Viewer",
      "roleDescription": "Read-only access",
      "permissions": ["read:all"],
      "createdAt": "2025-10-07T12:10:00.000Z",
      "updatedAt": "2025-10-07T12:10:00.000Z",
      "createdBy": "user-123",
      "isActive": true,
      "metadata": {}
    }
  ]
}
```

---

### 3. Get a Specific Role

**Endpoint:** `GET /roles-permissions/namespaces/:namespaceId/roles/:roleId`

**Description:** Retrieve details of a specific role.

**URL Parameters:**
- `namespaceId` (required): The namespace ID
- `roleId` (required): The role ID

**Example Request:**
```bash
curl -X GET "https://brmh.in/roles-permissions/namespaces/ns-123/roles/role-admin-001"
```

**Success Response (200):**
```json
{
  "success": true,
  "role": {
    "namespaceId": "ns-123",
    "roleId": "role-admin-001",
    "roleName": "Admin",
    "roleDescription": "Full administrative access",
    "permissions": ["read:all", "write:all", "delete:all"],
    "createdAt": "2025-10-07T12:00:00.000Z",
    "updatedAt": "2025-10-07T12:00:00.000Z",
    "createdBy": "user-123",
    "isActive": true,
    "metadata": {}
  }
}
```

**Error Response (404):**
```json
{
  "success": false,
  "error": "Role not found"
}
```

---

### 4. Update a Role

**Endpoint:** `PUT /roles-permissions/namespaces/:namespaceId/roles/:roleId`

**Description:** Update an existing role's details.

**URL Parameters:**
- `namespaceId` (required): The namespace ID
- `roleId` (required): The role ID

**Request Body (all fields optional):**
```json
{
  "roleName": "Super Admin",
  "roleDescription": "Updated description with more privileges",
  "permissions": ["read:all", "write:all", "delete:all", "manage:all"],
  "isActive": true,
  "metadata": {
    "department": "IT",
    "level": "critical"
  }
}
```

**Example Request:**
```bash
curl -X PUT https://brmh.in/roles-permissions/namespaces/ns-123/roles/role-admin-001 \
  -H "Content-Type: application/json" \
  -d '{
    "roleName": "Super Admin",
    "roleDescription": "Updated description with more privileges"
  }'
```

**Success Response (200):**
```json
{
  "success": true,
  "role": {
    "namespaceId": "ns-123",
    "roleId": "role-admin-001",
    "roleName": "Super Admin",
    "roleDescription": "Updated description with more privileges",
    "permissions": ["read:all", "write:all", "delete:all", "manage:all"],
    "createdAt": "2025-10-07T12:00:00.000Z",
    "updatedAt": "2025-10-07T13:00:00.000Z",
    "createdBy": "user-123",
    "isActive": true,
    "metadata": {
      "department": "IT",
      "level": "critical"
    }
  },
  "message": "Role updated successfully"
}
```

---

### 5. Delete a Role

**Endpoint:** `DELETE /roles-permissions/namespaces/:namespaceId/roles/:roleId`

**Description:** Delete a role (soft delete by default, or hard delete with query parameter).

**URL Parameters:**
- `namespaceId` (required): The namespace ID
- `roleId` (required): The role ID

**Query Parameters:**
- `hardDelete` (optional): Permanently delete the role (default: "false")
  - "false" - Soft delete (marks as inactive)
  - "true" - Hard delete (permanently removes from database)

**Example Requests:**
```bash
# Soft delete (marks as inactive)
curl -X DELETE "https://brmh.in/roles-permissions/namespaces/ns-123/roles/role-admin-001"

# Hard delete (permanently removes)
curl -X DELETE "https://brmh.in/roles-permissions/namespaces/ns-123/roles/role-admin-001?hardDelete=true"
```

**Success Response - Soft Delete (200):**
```json
{
  "success": true,
  "role": {
    "namespaceId": "ns-123",
    "roleId": "role-admin-001",
    "roleName": "Admin",
    "roleDescription": "Full administrative access",
    "permissions": ["read:all", "write:all", "delete:all"],
    "createdAt": "2025-10-07T12:00:00.000Z",
    "updatedAt": "2025-10-07T14:00:00.000Z",
    "createdBy": "user-123",
    "isActive": false,
    "metadata": {}
  },
  "message": "Role deactivated successfully"
}
```

**Success Response - Hard Delete (200):**
```json
{
  "success": true,
  "message": "Role permanently deleted"
}
```

---

### 6. Add Permissions to a Role

**Endpoint:** `POST /roles-permissions/namespaces/:namespaceId/roles/:roleId/permissions`

**Description:** Add new permissions to an existing role (no duplicates).

**URL Parameters:**
- `namespaceId` (required): The namespace ID
- `roleId` (required): The role ID

**Request Body:**
```json
{
  "permissions": [
    "manage:billing",
    "manage:integrations",
    "export:data"
  ]
}
```

**Example Request:**
```bash
curl -X POST https://brmh.in/roles-permissions/namespaces/ns-123/roles/role-admin-001/permissions \
  -H "Content-Type: application/json" \
  -d '{
    "permissions": ["manage:billing", "manage:integrations"]
  }'
```

**Success Response (200):**
```json
{
  "success": true,
  "role": {
    "namespaceId": "ns-123",
    "roleId": "role-admin-001",
    "roleName": "Admin",
    "roleDescription": "Full administrative access",
    "permissions": [
      "read:all",
      "write:all",
      "delete:all",
      "manage:billing",
      "manage:integrations"
    ],
    "createdAt": "2025-10-07T12:00:00.000Z",
    "updatedAt": "2025-10-07T15:00:00.000Z",
    "createdBy": "user-123",
    "isActive": true,
    "metadata": {}
  },
  "addedPermissions": ["manage:billing", "manage:integrations"],
  "message": "Permissions added successfully"
}
```

---

### 7. Remove Permissions from a Role

**Endpoint:** `DELETE /roles-permissions/namespaces/:namespaceId/roles/:roleId/permissions`

**Description:** Remove specific permissions from a role.

**URL Parameters:**
- `namespaceId` (required): The namespace ID
- `roleId` (required): The role ID

**Request Body:**
```json
{
  "permissions": [
    "delete:all",
    "manage:billing"
  ]
}
```

**Example Request:**
```bash
curl -X DELETE https://brmh.in/roles-permissions/namespaces/ns-123/roles/role-admin-001/permissions \
  -H "Content-Type: application/json" \
  -d '{
    "permissions": ["delete:all", "manage:billing"]
  }'
```

**Success Response (200):**
```json
{
  "success": true,
  "role": {
    "namespaceId": "ns-123",
    "roleId": "role-admin-001",
    "roleName": "Admin",
    "roleDescription": "Full administrative access",
    "permissions": [
      "read:all",
      "write:all",
      "manage:integrations"
    ],
    "createdAt": "2025-10-07T12:00:00.000Z",
    "updatedAt": "2025-10-07T16:00:00.000Z",
    "createdBy": "user-123",
    "isActive": true,
    "metadata": {}
  },
  "removedPermissions": ["delete:all", "manage:billing"],
  "message": "Permissions removed successfully"
}
```

---

### 8. Check Permissions

**Endpoint:** `POST /roles-permissions/namespaces/:namespaceId/check-permissions`

**Description:** Check if a role has specific required permissions.

**URL Parameters:**
- `namespaceId` (required): The namespace ID

**Request Body:**
```json
{
  "roleId": "role-admin-001",
  "requiredPermissions": [
    "read:all",
    "write:all",
    "delete:all"
  ]
}
```

**Example Request:**
```bash
curl -X POST https://brmh.in/roles-permissions/namespaces/ns-123/check-permissions \
  -H "Content-Type: application/json" \
  -d '{
    "roleId": "role-admin-001",
    "requiredPermissions": ["read:all", "write:all", "delete:all"]
  }'
```

**Success Response (200) - Has All Permissions:**
```json
{
  "success": true,
  "hasPermissions": true,
  "rolePermissions": [
    "read:all",
    "write:all",
    "delete:all",
    "manage:users"
  ],
  "requiredPermissions": [
    "read:all",
    "write:all",
    "delete:all"
  ],
  "missingPermissions": []
}
```

**Success Response (200) - Missing Permissions:**
```json
{
  "success": true,
  "hasPermissions": false,
  "rolePermissions": [
    "read:all",
    "write:all"
  ],
  "requiredPermissions": [
    "read:all",
    "write:all",
    "delete:all"
  ],
  "missingPermissions": [
    "delete:all"
  ]
}
```

---

## Common Permission Examples

Here are some common permission strings you might use:

### General Permissions
- `read:all` - Read access to all resources
- `write:all` - Write access to all resources
- `delete:all` - Delete access to all resources
- `manage:all` - Full management access

### Resource-Specific Permissions
- `read:schemas` - Read schemas
- `write:schemas` - Create/update schemas
- `delete:schemas` - Delete schemas
- `read:apis` - Read APIs
- `write:apis` - Create/update APIs
- `delete:apis` - Delete APIs
- `read:files` - Read files
- `write:files` - Upload files
- `delete:files` - Delete files

### User Management
- `manage:users` - Manage users
- `manage:roles` - Manage roles and permissions
- `invite:users` - Invite new users

### Advanced Permissions
- `manage:billing` - Manage billing and subscriptions
- `manage:integrations` - Manage integrations
- `export:data` - Export data
- `import:data` - Import data
- `view:analytics` - View analytics
- `manage:webhooks` - Manage webhooks

---

## Complete Usage Example

Here's a complete workflow example:

```bash
# 1. Create the table
node scripts/create-roles-permissions-table.js

# 2. Create an Admin role
curl -X POST https://brmh.in/roles-permissions/namespaces/my-namespace-123/roles \
  -H "Content-Type: application/json" \
  -d '{
    "roleName": "Admin",
    "roleDescription": "Full administrative access",
    "permissions": ["read:all", "write:all", "delete:all"],
    "createdBy": "user-789"
  }'

# 3. Create an Editor role
curl -X POST https://brmh.in/roles-permissions/namespaces/my-namespace-123/roles \
  -H "Content-Type: application/json" \
  -d '{
    "roleName": "Editor",
    "roleDescription": "Can read and write content",
    "permissions": ["read:all", "write:content", "write:schemas"],
    "createdBy": "user-789"
  }'

# 4. Create a Viewer role
curl -X POST https://brmh.in/roles-permissions/namespaces/my-namespace-123/roles \
  -H "Content-Type: application/json" \
  -d '{
    "roleName": "Viewer",
    "roleDescription": "Read-only access",
    "permissions": ["read:all"],
    "createdBy": "user-789"
  }'

# 5. Get all roles
curl -X GET "https://brmh.in/roles-permissions/namespaces/my-namespace-123/roles"

# 6. Add permissions to Editor role
curl -X POST https://brmh.in/roles-permissions/namespaces/my-namespace-123/roles/role-editor-001/permissions \
  -H "Content-Type: application/json" \
  -d '{
    "permissions": ["delete:content"]
  }'

# 7. Check if a role has specific permissions
curl -X POST https://brmh.in/roles-permissions/namespaces/my-namespace-123/check-permissions \
  -H "Content-Type: application/json" \
  -d '{
    "roleId": "role-editor-001",
    "requiredPermissions": ["read:all", "write:content"]
  }'

# 8. Update a role
curl -X PUT https://brmh.in/roles-permissions/namespaces/my-namespace-123/roles/role-editor-001 \
  -H "Content-Type: application/json" \
  -d '{
    "roleDescription": "Updated: Can read, write, and delete content"
  }'

# 9. Soft delete a role (marks as inactive)
curl -X DELETE "https://brmh.in/roles-permissions/namespaces/my-namespace-123/roles/role-viewer-001"

# 10. Hard delete a role (permanently removes)
curl -X DELETE "https://brmh.in/roles-permissions/namespaces/my-namespace-123/roles/role-viewer-001?hardDelete=true"
```

---

## Error Responses

All endpoints return consistent error responses:

**400 Bad Request:**
```json
{
  "success": false,
  "error": "roleName is required"
}
```

**404 Not Found:**
```json
{
  "success": false,
  "error": "Role not found"
}
```

**409 Conflict:**
```json
{
  "success": false,
  "error": "Role already exists"
}
```

**500 Internal Server Error:**
```json
{
  "success": false,
  "error": "Failed to create role",
  "details": "Error message details"
}
```

---

## Notes

- All timestamps are in ISO 8601 format (e.g., `2025-10-07T12:00:00.000Z`)
- Role IDs are automatically generated with the format `role-{uuid}`
- Soft delete (default) marks roles as inactive (`isActive: false`)
- Hard delete permanently removes the role from the database
- Adding duplicate permissions is prevented automatically
- The `createdBy` field defaults to "system" if not provided
- All responses include a `success` boolean field

