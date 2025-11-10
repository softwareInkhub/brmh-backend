# BRMH Resource Management System

## Overview

The BRMH Resource Management System provides fine-grained access control for users across different resource types including namespaces, schemas, tables, and drive storage (folders and files).

## Features

✅ **Multi-Resource Support**
- Namespace access control
- Schema/Table access control  
- Drive folder access control
- Drive file access control

✅ **Flexible Permissions**
- `read`: View/read access
- `write`: Create/update access
- `delete`: Delete access
- `admin`: Full administrative access
- `execute`: Execute operations (APIs, methods)
- `share`: Share resource with other users

✅ **Comprehensive Management**
- Grant access to individual users
- Bulk grant access to multiple users
- Revoke access
- Update permissions
- Check user access
- List users with access to resources

## Database Setup

### 1. Create the DynamoDB Table

Run the table creation script:

```bash
cd brmh-backend
node scripts/create-user-resources-table.js
```

This creates the `brmh-user-resources` table with:
- **Primary Key**: `userId` (HASH) + `resourceId` (RANGE)
- **GSI 1**: `ResourceTypeIndex` - Query by user and resource type
- **GSI 2**: `GrantedByIndex` - Query by who granted the access

### Table Structure

```javascript
{
  userId: "user-123",
  resourceId: "namespace#ns-456",  // Format: {resourceType}#{actualId}
  resourceType: "namespace",
  actualResourceId: "ns-456",
  permissions: ["read", "write"],
  grantedBy: "superadmin",
  grantedAt: "2025-01-10T12:00:00.000Z",
  updatedAt: "2025-01-10T12:00:00.000Z",
  expiresAt: null,  // Optional expiration
  metadata: {},     // Optional metadata
  isActive: true
}
```

## API Endpoints

### Configuration

#### Get Resource Configuration
```http
GET /user-resources/config
```

Returns available resource types and permission types.

**Response:**
```json
{
  "success": true,
  "config": {
    "resourceTypes": [
      {
        "value": "namespace",
        "label": "Namespace",
        "description": "Access to entire namespace and all its contents"
      },
      // ... more resource types
    ],
    "permissionTypes": [
      {
        "value": "read",
        "label": "Read",
        "description": "View and read access"
      },
      // ... more permissions
    ]
  }
}
```

### Grant Access

#### Grant Resource Access to User
```http
POST /user-resources/grant
Content-Type: application/json

{
  "userId": "user-123",
  "resourceType": "namespace",
  "resourceId": "ns-456",
  "permissions": ["read", "write"],
  "grantedBy": "superadmin",
  "expiresAt": "2025-12-31T23:59:59.000Z",  // Optional
  "metadata": {}  // Optional
}
```

#### Bulk Grant Access
```http
POST /user-resources/grant-bulk
Content-Type: application/json

{
  "userIds": ["user-123", "user-456", "user-789"],
  "resourceType": "schema",
  "resourceId": "schema-abc",
  "permissions": ["read", "execute"],
  "grantedBy": "superadmin"
}
```

### Revoke Access

#### Revoke Resource Access
```http
DELETE /user-resources/revoke
Content-Type: application/json

{
  "userId": "user-123",
  "resourceType": "namespace",
  "resourceId": "ns-456"
}
```

### Update Access

#### Update Resource Permissions
```http
PUT /user-resources/:userId/:resourceType/:resourceId
Content-Type: application/json

{
  "permissions": ["read", "write", "admin"],
  "expiresAt": "2026-12-31T23:59:59.000Z",
  "metadata": { "reason": "Promotion to admin" }
}
```

### Query Access

#### Get All Resources for User
```http
GET /user-resources/:userId?resourceType=namespace&activeOnly=true
```

**Query Parameters:**
- `resourceType` (optional): Filter by resource type
- `activeOnly` (optional): Filter active/expired resources (default: true)

#### Get User Resource Summary
```http
GET /user-resources/:userId/summary
```

Returns summary with counts by type, expiring soon, recently granted, etc.

#### Check User Access
```http
POST /user-resources/:userId/check-access
Content-Type: application/json

{
  "resourceType": "namespace",
  "resourceId": "ns-456",
  "requiredPermissions": ["read", "write"]
}
```

**Response:**
```json
{
  "success": true,
  "hasAccess": true,
  "userId": "user-123",
  "resourceType": "namespace",
  "resourceId": "ns-456",
  "userPermissions": ["read", "write", "admin"],
  "requiredPermissions": ["read", "write"],
  "missingPermissions": [],
  "grantedBy": "superadmin",
  "grantedAt": "2025-01-10T12:00:00.000Z"
}
```

#### Get Users with Access to Resource
```http
GET /user-resources/resource/:resourceType/:resourceId/users?activeOnly=true
```

## Frontend Usage

### Access the Resource Management UI

1. Navigate to `/BRMH-IAM` in your frontend
2. Click on the **"Resource Access"** tab
3. Select a user from the dropdown
4. Click **"Grant Access"** to assign new resource access
5. Manage existing access from the table

### UI Features

- **Search Users**: Search by username or email
- **Filter by Type**: Filter resources by type (namespace, schema, etc.)
- **Grant Access Dialog**: 
  - Select resource type
  - Enter resource ID
  - Choose permissions
  - Grant access
- **Resource Overview**: See count of assignments per resource type
- **Revoke Access**: Remove access with one click

## Usage Examples

### Example 1: Grant Namespace Access

```javascript
// Grant full access to a namespace
const response = await fetch(`${API_BASE_URL}/user-resources/grant`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'user-123',
    resourceType: 'namespace',
    resourceId: 'shopify-namespace',
    permissions: ['read', 'write', 'admin'],
    grantedBy: 'superadmin'
  })
});
```

### Example 2: Grant Schema Access

```javascript
// Grant read and execute access to a schema
const response = await fetch(`${API_BASE_URL}/user-resources/grant`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'user-456',
    resourceType: 'schema',
    resourceId: 'schema-abc123',
    permissions: ['read', 'execute'],
    grantedBy: 'superadmin',
    expiresAt: '2025-12-31T23:59:59.000Z'  // Expires at end of year
  })
});
```

### Example 3: Grant Drive Folder Access

```javascript
// Grant folder access for collaboration
const response = await fetch(`${API_BASE_URL}/user-resources/grant`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'user-789',
    resourceType: 'drive-folder',
    resourceId: 'FOLDER_abc123xyz',
    permissions: ['read', 'write', 'share'],
    grantedBy: 'superadmin',
    metadata: {
      reason: 'Project collaboration',
      project: 'Q4-2025-Initiative'
    }
  })
});
```

### Example 4: Bulk Grant Access

```javascript
// Grant schema access to entire team
const response = await fetch(`${API_BASE_URL}/user-resources/grant-bulk`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userIds: ['user-1', 'user-2', 'user-3', 'user-4'],
    resourceType: 'schema',
    resourceId: 'analytics-schema',
    permissions: ['read', 'execute'],
    grantedBy: 'superadmin'
  })
});
```

### Example 5: Check Access Before Operation

```javascript
// Check if user has required permissions
const response = await fetch(`${API_BASE_URL}/user-resources/user-123/check-access`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    resourceType: 'drive-folder',
    resourceId: 'FOLDER_xyz789',
    requiredPermissions: ['write', 'delete']
  })
});

const result = await response.json();
if (result.hasAccess) {
  // Proceed with operation
  console.log('User has required permissions');
} else {
  // Show error
  console.error('Missing permissions:', result.missingPermissions);
}
```

## Integration with Existing Systems

### Namespace Integration

When assigning namespace-level access, users get access to:
- All schemas in the namespace
- All methods in the namespace
- All accounts in the namespace

### Schema/Table Integration

Schema-level access allows users to:
- View schema structure
- Query data (with `read` permission)
- Modify data (with `write` permission)
- Execute methods (with `execute` permission)

### Drive Integration

Drive access integrates with BRMH Drive (`brmh-drive.js`):
- `drive-folder`: Access to folder and all contents
- `drive-file`: Access to specific file

Before drive operations, check access:
```javascript
// Example: Check before allowing folder access
const hasAccess = await checkResourceAccess(
  userId, 
  'drive-folder', 
  folderId, 
  ['read']
);

if (!hasAccess) {
  return { error: 'Access denied' };
}
```

## Permission Hierarchy

### Admin Permission
Users with `admin` permission automatically have all other permissions:
- Includes: read, write, delete, execute, share

### Permission Combinations
Common permission sets:
- **Viewer**: `["read"]`
- **Editor**: `["read", "write"]`
- **Power User**: `["read", "write", "execute"]`
- **Manager**: `["read", "write", "delete", "share"]`
- **Administrator**: `["admin"]`

## Best Practices

1. **Principle of Least Privilege**: Grant minimum permissions needed
2. **Use Expiration Dates**: Set `expiresAt` for temporary access
3. **Document with Metadata**: Use metadata field to document reasons
4. **Regular Audits**: Periodically review granted access
5. **Bulk Operations**: Use bulk grant for team assignments
6. **Check Before Operations**: Always verify access before sensitive operations

## Security Considerations

1. **Validation**: All inputs are validated on the backend
2. **Active Status**: Inactive or expired access is automatically filtered
3. **Audit Trail**: All grants/revokes are logged with timestamps and grantor
4. **Superadmin Control**: Only superadmins can grant/revoke access
5. **Resource Verification**: Verify resources exist before granting access

## Troubleshooting

### Common Issues

**Issue**: "Resource not found" error
- **Solution**: Verify resource ID is correct and resource exists

**Issue**: User still has access after revocation
- **Solution**: Check if access was soft-deleted (isActive=false) vs hard-deleted

**Issue**: Bulk grant partially failed
- **Solution**: Check the response - it returns successful and failed arrays

**Issue**: Permission check returns false unexpectedly
- **Solution**: Verify resource hasn't expired and isActive is true

## Migration Guide

### Migrating from Old System

If you have existing access control:

1. Export existing access data
2. Map to new resource types
3. Use bulk grant API to migrate
4. Verify with check-access endpoints
5. Deprecate old system

Example migration script:
```javascript
// Migration example
const migrateAccess = async (oldAccessData) => {
  for (const access of oldAccessData) {
    await fetch(`${API_BASE_URL}/user-resources/grant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: access.userId,
        resourceType: mapToNewType(access.oldType),
        resourceId: access.resourceId,
        permissions: mapToNewPermissions(access.oldPermissions),
        grantedBy: 'migration-script',
        metadata: { migratedFrom: 'old-system', migratedAt: new Date().toISOString() }
      })
    });
  }
};
```

## Support

For issues or questions:
- Check API logs in CloudWatch
- Review DynamoDB table data
- Verify IAM permissions for DynamoDB access
- Check CORS configuration

## Future Enhancements

- [ ] Resource groups for bulk management
- [ ] Time-based access (schedule access)
- [ ] Approval workflows for access requests
- [ ] Access request system (users can request access)
- [ ] Enhanced audit logging with CloudTrail
- [ ] Integration with external identity providers

