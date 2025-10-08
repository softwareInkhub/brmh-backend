# Roles & Permissions Quick Start Guide

## 🚀 Setup (One-time)

```bash
cd brmh-backend
node scripts/create-roles-permissions-table.js
```

## 📋 Quick Reference

### Base URL
```
https://brmh.in/roles-permissions
```

### Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/namespaces/:namespaceId/roles` | Create role |
| GET | `/namespaces/:namespaceId/roles` | Get all roles |
| GET | `/namespaces/:namespaceId/roles/:roleId` | Get specific role |
| PUT | `/namespaces/:namespaceId/roles/:roleId` | Update role |
| DELETE | `/namespaces/:namespaceId/roles/:roleId` | Delete role |
| POST | `/namespaces/:namespaceId/roles/:roleId/permissions` | Add permissions |
| DELETE | `/namespaces/:namespaceId/roles/:roleId/permissions` | Remove permissions |
| POST | `/namespaces/:namespaceId/check-permissions` | Check permissions |

---

## 📝 Common Examples

### Create Admin Role
```bash
curl -X POST https://brmh.in/roles-permissions/namespaces/ns-123/roles \
  -H "Content-Type: application/json" \
  -d '{
    "roleName": "Admin",
    "roleDescription": "Full admin access",
    "permissions": ["read:all", "write:all", "delete:all", "manage:users"],
    "createdBy": "user-123"
  }'
```

### Create Editor Role
```bash
curl -X POST https://brmh.in/roles-permissions/namespaces/ns-123/roles \
  -H "Content-Type: application/json" \
  -d '{
    "roleName": "Editor",
    "roleDescription": "Can read and write",
    "permissions": ["read:all", "write:content", "write:schemas"],
    "createdBy": "user-123"
  }'
```

### Create Viewer Role
```bash
curl -X POST https://brmh.in/roles-permissions/namespaces/ns-123/roles \
  -H "Content-Type: application/json" \
  -d '{
    "roleName": "Viewer",
    "roleDescription": "Read-only access",
    "permissions": ["read:all"],
    "createdBy": "user-123"
  }'
```

### Get All Roles
```bash
curl https://brmh.in/roles-permissions/namespaces/ns-123/roles
```

### Add Permissions
```bash
curl -X POST https://brmh.in/roles-permissions/namespaces/ns-123/roles/role-xyz/permissions \
  -H "Content-Type: application/json" \
  -d '{"permissions": ["manage:billing", "export:data"]}'
```

### Remove Permissions
```bash
curl -X DELETE https://brmh.in/roles-permissions/namespaces/ns-123/roles/role-xyz/permissions \
  -H "Content-Type: application/json" \
  -d '{"permissions": ["delete:all"]}'
```

### Check Permissions
```bash
curl -X POST https://brmh.in/roles-permissions/namespaces/ns-123/check-permissions \
  -H "Content-Type: application/json" \
  -d '{
    "roleId": "role-xyz",
    "requiredPermissions": ["read:all", "write:content"]
  }'
```

---

## 🔑 Common Permission Strings

**General Access:**
- `read:all` - Read everything
- `write:all` - Write everything
- `delete:all` - Delete everything
- `manage:all` - Manage everything

**Resource-Specific:**
- `read:schemas`, `write:schemas`, `delete:schemas`
- `read:apis`, `write:apis`, `delete:apis`
- `read:files`, `write:files`, `delete:files`
- `read:content`, `write:content`, `delete:content`

**User & Role Management:**
- `manage:users` - Manage users
- `manage:roles` - Manage roles
- `invite:users` - Invite users

**Advanced:**
- `manage:billing` - Manage billing
- `manage:integrations` - Manage integrations
- `export:data` - Export data
- `import:data` - Import data
- `view:analytics` - View analytics

---

## 📊 Data Structure

**Role Object:**
```json
{
  "namespaceId": "ns-123",
  "roleId": "role-abc-123",
  "roleName": "Admin",
  "roleDescription": "Full access",
  "permissions": ["read:all", "write:all"],
  "createdAt": "2025-10-07T12:00:00.000Z",
  "updatedAt": "2025-10-07T12:00:00.000Z",
  "createdBy": "user-123",
  "isActive": true,
  "metadata": {}
}
```

---

## 🎯 Response Format

**Success:**
```json
{
  "success": true,
  "role": { /* role object */ },
  "message": "Role created successfully"
}
```

**Error:**
```json
{
  "success": false,
  "error": "Error message",
  "details": "Additional details"
}
```

---

## 💡 Tips

1. **Soft Delete vs Hard Delete:**
   - Soft: `DELETE /roles/:roleId` (marks inactive)
   - Hard: `DELETE /roles/:roleId?hardDelete=true` (permanent)

2. **Filter Active Roles:**
   - Active only: `GET /roles?activeOnly=true` (default)
   - All roles: `GET /roles?activeOnly=false`

3. **No Duplicate Permissions:**
   - Adding existing permissions is safe (they won't duplicate)

4. **Auto-Generated IDs:**
   - Role IDs are automatically generated (format: `role-{uuid}`)

---

## 📖 Full Documentation

For complete API documentation with all details, see:
- `ROLES_PERMISSIONS_API.md`

