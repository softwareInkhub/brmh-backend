# User Roles Assignment API Documentation

This API manages namespace-specific role assignments for users. Each user can have different roles in different namespaces.

## Base URL
```
https://brmh.in
```

## Table Structure

**Table Name:** `brmh-user-roles`

**Primary Key:**
- Partition Key: `userId` (String)
- Sort Key: `namespaceId` (String)

**Global Secondary Index:**
- Index Name: `RoleIndex`
- Partition Key: `roleId`
- Sort Key: `namespaceId`
- Purpose: Query all users with a specific role in a namespace

**Attributes:**
- `roleId` (String) - The role assigned to the user
- `roleName` (String) - Display name of the role
- `permissions` (Array of Strings) - Permissions from the role
- `assignedAt` (String) - ISO timestamp when assigned
- `updatedAt` (String) - ISO timestamp of last update
- `assignedBy` (String) - Who assigned the role
- `isActive` (Boolean) - Whether the assignment is active
- `metadata` (Object) - Additional metadata

---

## Setup

### 1. Create the DynamoDB Table

Run the setup script to create the table:

```bash
cd brmh-backend
node scripts/create-user-roles-table.js
```

This will create the `brmh-user-roles` table with a Global Secondary Index for querying users by role.

---

## API Endpoints

### 1. Assign Role to User

**Endpoint:** `POST /user-roles/assign`

**Description:** Assign a role to a user in a specific namespace.

**Request Body:**
```json
{
  "userId": "e4680438-9091-70bd-625d-e31143790d37",
  "namespaceId": "projectmangement",
  "roleId": "role-06eb06f8-ada9-4ff5-b7ea-b1d0b3532e8e",
  "assignedBy": "admin-user-id",
  "metadata": {
    "notes": "Project Manager role",
    "department": "Engineering"
  }
}
```

**Required Fields:**
- `userId` (String) - User's ID from brmh-users table
- `namespaceId` (String) - Namespace ID
- `roleId` (String) - Role ID from brmh-roles-permissions table

**Optional Fields:**
- `assignedBy` (String) - Who assigned the role (defaults to "system")
- `metadata` (Object) - Additional metadata

**Example Request:**
```bash
curl -X POST https://brmh.in/user-roles/assign \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "e4680438-9091-70bd-625d-e31143790d37",
    "namespaceId": "projectmangement",
    "roleId": "role-06eb06f8-ada9-4ff5-b7ea-b1d0b3532e8e",
    "assignedBy": "admin-123"
  }'
```

**Success Response (201):**
```json
{
  "success": true,
  "assignment": {
    "userId": "e4680438-9091-70bd-625d-e31143790d37",
    "namespaceId": "projectmangement",
    "roleId": "role-06eb06f8-ada9-4ff5-b7ea-b1d0b3532e8e",
    "roleName": "Admin",
    "permissions": ["read:all", "write:all", "delete:all", "manage:users"],
    "assignedAt": "2025-10-07T12:00:00.000Z",
    "updatedAt": "2025-10-07T12:00:00.000Z",
    "assignedBy": "admin-123",
    "isActive": true,
    "metadata": {}
  },
  "message": "Role assigned successfully"
}
```

---

### 2. Get User's Role in a Namespace

**Endpoint:** `GET /user-roles/:userId/namespaces/:namespaceId`

**Description:** Get a user's role assignment in a specific namespace.

**URL Parameters:**
- `userId` (required): User's ID
- `namespaceId` (required): Namespace ID

**Example Request:**
```bash
curl -X GET "https://brmh.in/user-roles/e4680438-9091-70bd-625d-e31143790d37/namespaces/projectmangement"
```

**Success Response (200):**
```json
{
  "success": true,
  "assignment": {
    "userId": "e4680438-9091-70bd-625d-e31143790d37",
    "namespaceId": "projectmangement",
    "roleId": "role-06eb06f8-ada9-4ff5-b7ea-b1d0b3532e8e",
    "roleName": "Admin",
    "permissions": ["read:all", "write:all", "delete:all", "manage:users"],
    "assignedAt": "2025-10-07T12:00:00.000Z",
    "updatedAt": "2025-10-07T12:00:00.000Z",
    "assignedBy": "admin-123",
    "isActive": true,
    "metadata": {}
  }
}
```

**Error Response (404):**
```json
{
  "success": false,
  "error": "No role assigned to this user in this namespace"
}
```

---

### 3. Get All Roles for a User

**Endpoint:** `GET /user-roles/:userId`

**Description:** Get all role assignments for a user across all namespaces.

**URL Parameters:**
- `userId` (required): User's ID

**Query Parameters:**
- `activeOnly` (optional): Filter by active status (default: "true")

**Example Requests:**
```bash
# Get only active roles
curl -X GET "https://brmh.in/user-roles/e4680438-9091-70bd-625d-e31143790d37?activeOnly=true"

# Get all roles (including inactive)
curl -X GET "https://brmh.in/user-roles/e4680438-9091-70bd-625d-e31143790d37?activeOnly=false"
```

**Success Response (200):**
```json
{
  "success": true,
  "userId": "e4680438-9091-70bd-625d-e31143790d37",
  "count": 3,
  "assignments": [
    {
      "userId": "e4680438-9091-70bd-625d-e31143790d37",
      "namespaceId": "projectmangement",
      "roleId": "role-pm-001",
      "roleName": "Project Manager",
      "permissions": ["read:all", "write:projects", "manage:team"],
      "assignedAt": "2025-10-07T10:00:00.000Z",
      "updatedAt": "2025-10-07T10:00:00.000Z",
      "assignedBy": "admin-123",
      "isActive": true,
      "metadata": {}
    },
    {
      "userId": "e4680438-9091-70bd-625d-e31143790d37",
      "namespaceId": "admin",
      "roleId": "role-product-lister-001",
      "roleName": "Product Lister",
      "permissions": ["read:products", "write:products"],
      "assignedAt": "2025-10-07T11:00:00.000Z",
      "updatedAt": "2025-10-07T11:00:00.000Z",
      "assignedBy": "admin-456",
      "isActive": true,
      "metadata": {}
    },
    {
      "userId": "e4680438-9091-70bd-625d-e31143790d37",
      "namespaceId": "drive",
      "roleId": "role-manager-001",
      "roleName": "Manager",
      "permissions": ["read:files", "write:files", "delete:files", "manage:folders"],
      "assignedAt": "2025-10-07T12:00:00.000Z",
      "updatedAt": "2025-10-07T12:00:00.000Z",
      "assignedBy": "drive-admin-789",
      "isActive": true,
      "metadata": {}
    }
  ]
}
```

---

### 4. Get Users with a Specific Role

**Endpoint:** `GET /user-roles/roles/:roleId/namespaces/:namespaceId/users`

**Description:** Get all users who have a specific role in a namespace.

**URL Parameters:**
- `roleId` (required): Role ID
- `namespaceId` (required): Namespace ID

**Query Parameters:**
- `activeOnly` (optional): Filter by active assignments (default: "true")

**Example Request:**
```bash
curl -X GET "https://brmh.in/user-roles/roles/role-pm-001/namespaces/projectmangement/users"
```

**Success Response (200):**
```json
{
  "success": true,
  "roleId": "role-pm-001",
  "namespaceId": "projectmangement",
  "count": 2,
  "users": [
    {
      "userId": "user-001",
      "namespaceId": "projectmangement",
      "roleId": "role-pm-001",
      "roleName": "Project Manager",
      "permissions": ["read:all", "write:projects", "manage:team"],
      "assignedAt": "2025-10-07T10:00:00.000Z",
      "updatedAt": "2025-10-07T10:00:00.000Z",
      "assignedBy": "admin-123",
      "isActive": true
    },
    {
      "userId": "user-002",
      "namespaceId": "projectmangement",
      "roleId": "role-pm-001",
      "roleName": "Project Manager",
      "permissions": ["read:all", "write:projects", "manage:team"],
      "assignedAt": "2025-10-07T11:00:00.000Z",
      "updatedAt": "2025-10-07T11:00:00.000Z",
      "assignedBy": "admin-123",
      "isActive": true
    }
  ]
}
```

---

### 5. Remove Role from User

**Endpoint:** `DELETE /user-roles/:userId/namespaces/:namespaceId`

**Description:** Remove a role assignment from a user in a namespace.

**URL Parameters:**
- `userId` (required): User's ID
- `namespaceId` (required): Namespace ID

**Query Parameters:**
- `hardDelete` (optional): Permanently delete (default: "false")
  - "false" - Soft delete (marks as inactive)
  - "true" - Hard delete (permanently removes)

**Example Requests:**
```bash
# Soft delete (marks as inactive)
curl -X DELETE "https://brmh.in/user-roles/e4680438-9091-70bd-625d-e31143790d37/namespaces/projectmangement"

# Hard delete (permanently removes)
curl -X DELETE "https://brmh.in/user-roles/e4680438-9091-70bd-625d-e31143790d37/namespaces/projectmangement?hardDelete=true"
```

**Success Response - Soft Delete (200):**
```json
{
  "success": true,
  "assignment": {
    "userId": "e4680438-9091-70bd-625d-e31143790d37",
    "namespaceId": "projectmangement",
    "roleId": "role-pm-001",
    "roleName": "Project Manager",
    "permissions": ["read:all", "write:projects", "manage:team"],
    "assignedAt": "2025-10-07T10:00:00.000Z",
    "updatedAt": "2025-10-07T14:00:00.000Z",
    "assignedBy": "admin-123",
    "isActive": false,
    "metadata": {}
  },
  "message": "Role assignment deactivated"
}
```

**Success Response - Hard Delete (200):**
```json
{
  "success": true,
  "message": "Role assignment permanently removed"
}
```

---

### 6. Update User's Role

**Endpoint:** `PUT /user-roles/:userId/namespaces/:namespaceId`

**Description:** Change a user's role in a namespace.

**URL Parameters:**
- `userId` (required): User's ID
- `namespaceId` (required): Namespace ID

**Request Body:**
```json
{
  "roleId": "role-senior-pm-001",
  "isActive": true,
  "metadata": {
    "notes": "Promoted to Senior PM",
    "promotedAt": "2025-10-07T15:00:00.000Z"
  }
}
```

**Required Fields:**
- `roleId` (String) - New role ID

**Optional Fields:**
- `isActive` (Boolean) - Activate/deactivate assignment
- `metadata` (Object) - Additional metadata

**Example Request:**
```bash
curl -X PUT https://brmh.in/user-roles/e4680438-9091-70bd-625d-e31143790d37/namespaces/projectmangement \
  -H "Content-Type: application/json" \
  -d '{
    "roleId": "role-senior-pm-001",
    "metadata": {
      "notes": "Promoted to Senior PM"
    }
  }'
```

**Success Response (200):**
```json
{
  "success": true,
  "assignment": {
    "userId": "e4680438-9091-70bd-625d-e31143790d37",
    "namespaceId": "projectmangement",
    "roleId": "role-senior-pm-001",
    "roleName": "Senior Project Manager",
    "permissions": ["read:all", "write:all", "manage:all"],
    "assignedAt": "2025-10-07T10:00:00.000Z",
    "updatedAt": "2025-10-07T15:00:00.000Z",
    "assignedBy": "admin-123",
    "isActive": true,
    "metadata": {
      "notes": "Promoted to Senior PM"
    }
  },
  "message": "Role updated successfully"
}
```

---

### 7. Check User Permissions

**Endpoint:** `POST /user-roles/:userId/namespaces/:namespaceId/check-permissions`

**Description:** Check if a user has specific permissions in a namespace.

**URL Parameters:**
- `userId` (required): User's ID
- `namespaceId` (required): Namespace ID

**Request Body:**
```json
{
  "requiredPermissions": [
    "write:projects",
    "manage:team"
  ]
}
```

**Example Request:**
```bash
curl -X POST https://brmh.in/user-roles/e4680438-9091-70bd-625d-e31143790d37/namespaces/projectmangement/check-permissions \
  -H "Content-Type: application/json" \
  -d '{
    "requiredPermissions": ["write:projects", "manage:team"]
  }'
```

**Success Response - Has Permissions (200):**
```json
{
  "success": true,
  "hasPermissions": true,
  "userId": "e4680438-9091-70bd-625d-e31143790d37",
  "namespaceId": "projectmangement",
  "roleId": "role-pm-001",
  "roleName": "Project Manager",
  "userPermissions": ["read:all", "write:projects", "manage:team"],
  "requiredPermissions": ["write:projects", "manage:team"],
  "missingPermissions": []
}
```

**Success Response - Missing Permissions (200):**
```json
{
  "success": true,
  "hasPermissions": false,
  "userId": "e4680438-9091-70bd-625d-e31143790d37",
  "namespaceId": "projectmangement",
  "roleId": "role-viewer-001",
  "roleName": "Viewer",
  "userPermissions": ["read:all"],
  "requiredPermissions": ["write:projects", "manage:team"],
  "missingPermissions": ["write:projects", "manage:team"]
}
```

---

### 8. Get Permissions Summary

**Endpoint:** `GET /user-roles/:userId/permissions-summary`

**Description:** Get a summary of user's permissions across all namespaces.

**URL Parameters:**
- `userId` (required): User's ID

**Example Request:**
```bash
curl -X GET "https://brmh.in/user-roles/e4680438-9091-70bd-625d-e31143790d37/permissions-summary"
```

**Success Response (200):**
```json
{
  "success": true,
  "userId": "e4680438-9091-70bd-625d-e31143790d37",
  "totalNamespaces": 3,
  "totalUniquePermissions": 8,
  "allPermissions": [
    "read:all",
    "write:projects",
    "manage:team",
    "read:products",
    "write:products",
    "read:files",
    "write:files",
    "manage:folders"
  ],
  "namespaceRoles": [
    {
      "namespaceId": "projectmangement",
      "roleId": "role-pm-001",
      "roleName": "Project Manager",
      "permissions": ["read:all", "write:projects", "manage:team"],
      "assignedAt": "2025-10-07T10:00:00.000Z"
    },
    {
      "namespaceId": "admin",
      "roleId": "role-product-lister-001",
      "roleName": "Product Lister",
      "permissions": ["read:products", "write:products"],
      "assignedAt": "2025-10-07T11:00:00.000Z"
    },
    {
      "namespaceId": "drive",
      "roleId": "role-manager-001",
      "roleName": "Manager",
      "permissions": ["read:files", "write:files", "manage:folders"],
      "assignedAt": "2025-10-07T12:00:00.000Z"
    }
  ]
}
```

---

## Complete Workflow Example

Here's a complete example showing how to set up roles for a user across multiple namespaces:

```bash
# 1. Create the user-roles table (one-time setup)
node scripts/create-user-roles-table.js

# 2. Assign PM role in projectmangement namespace
curl -X POST https://brmh.in/user-roles/assign \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "e4680438-9091-70bd-625d-e31143790d37",
    "namespaceId": "projectmangement",
    "roleId": "role-06eb06f8-ada9-4ff5-b7ea-b1d0b3532e8e",
    "assignedBy": "admin-123"
  }'

# 3. Assign Product Lister role in admin namespace
curl -X POST https://brmh.in/user-roles/assign \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "e4680438-9091-70bd-625d-e31143790d37",
    "namespaceId": "admin",
    "roleId": "role-product-lister-001",
    "assignedBy": "admin-123"
  }'

# 4. Assign Manager role in drive namespace
curl -X POST https://brmh.in/user-roles/assign \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "e4680438-9091-70bd-625d-e31143790d37",
    "namespaceId": "drive",
    "roleId": "role-manager-001",
    "assignedBy": "drive-admin-789"
  }'

# 5. Get all roles for the user
curl -X GET "https://brmh.in/user-roles/e4680438-9091-70bd-625d-e31143790d37"

# 6. Check if user has permission in projectmangement
curl -X POST https://brmh.in/user-roles/e4680438-9091-70bd-625d-e31143790d37/namespaces/projectmangement/check-permissions \
  -H "Content-Type: application/json" \
  -d '{
    "requiredPermissions": ["write:projects"]
  }'

# 7. Get permissions summary
curl -X GET "https://brmh.in/user-roles/e4680438-9091-70bd-625d-e31143790d37/permissions-summary"

# 8. Update user's role in projectmangement
curl -X PUT https://brmh.in/user-roles/e4680438-9091-70bd-625d-e31143790d37/namespaces/projectmangement \
  -H "Content-Type: application/json" \
  -d '{
    "roleId": "role-senior-pm-001"
  }'

# 9. Remove user's role from admin namespace
curl -X DELETE "https://brmh.in/user-roles/e4680438-9091-70bd-625d-e31143790d37/namespaces/admin"
```

---

## Error Responses

All endpoints return consistent error responses:

**400 Bad Request:**
```json
{
  "success": false,
  "error": "userId, namespaceId, and roleId are required"
}
```

**404 Not Found:**
```json
{
  "success": false,
  "error": "Role assignment not found"
}
```

**403 Forbidden:**
```json
{
  "success": false,
  "hasPermissions": false,
  "error": "User's role assignment is inactive"
}
```

**500 Internal Server Error:**
```json
{
  "success": false,
  "error": "Failed to assign role",
  "details": "Error message details"
}
```

---

## Notes

- Users can only have ONE role per namespace
- Assigning a new role automatically replaces the old role
- Soft delete (default) preserves the history
- Hard delete permanently removes the assignment
- Permissions are automatically copied from the role when assigned
- If a role's permissions are updated, existing assignments keep their cached permissions (update the assignment to refresh)

---

## Full Documentation

For the complete roles and permissions system, see:
- `ROLES_PERMISSIONS_API.md` - Role management
- `USER_ROLES_API.md` - This file (user-role assignments)

