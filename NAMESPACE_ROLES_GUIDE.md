# Namespace Roles & Permissions System
## Single Table Approach - Everything in `brmh-users`

## 🎯 Overview

This system stores **namespace-specific roles and permissions directly in each user's record** in the `brmh-users` table. No separate tables needed!

### What Gets Tracked

When a user logs in from `https://auth.brmh.in/login?next=https://drive.brmh.in/`:

1. ✅ **Subdomain/Namespace** extracted: `drive`
2. ✅ **User's role in that namespace**: `manager`
3. ✅ **User's permissions**: `["read:files", "write:files", "delete:files"]`
4. ✅ **Access history**: When they first/last accessed each namespace

---

## 📊 User Data Structure

Here's how **Baba3's** user record looks with namespace-specific roles:

```json
{
  "userId": "e4680438-9091-70bd-625d-e31143790d37",
  "username": "Baba3",
  "email": "baba3@gmail.com",
  "cognitoUsername": "Baba3",
  "createdAt": "2025-10-07T10:04:20.934Z",
  "updatedAt": "2025-10-07T12:00:00.000Z",
  "status": "active",
  
  "metadata": {
    "signupMethod": "email",
    "verified": false,
    "lastLogin": "2025-10-07T12:00:00.000Z",
    "loginCount": 5,
    "accessedDomains": [
      "drive.brmh.in",
      "admin.brmh.in",
      "auth.brmh.in"
    ],
    "accessedNamespaces": [
      "drive",
      "admin"
    ],
    "lastAccessedDomain": "drive.brmh.in",
    "lastAccessedNamespace": "drive",
    "domainAccessHistory": [
      {
        "domain": "drive.brmh.in",
        "namespace": "drive",
        "firstAccess": "2025-10-07T10:30:00.000Z",
        "lastAccess": "2025-10-07T12:00:00.000Z",
        "accessCount": 3
      },
      {
        "domain": "admin.brmh.in",
        "namespace": "admin",
        "firstAccess": "2025-10-07T11:00:00.000Z",
        "lastAccess": "2025-10-07T11:30:00.000Z",
        "accessCount": 2
      }
    ]
  },
  
  "namespaceRoles": {
    "drive": {
      "role": "manager",
      "permissions": [
        "read:files",
        "write:files",
        "delete:files",
        "manage:folders"
      ],
      "assignedAt": "2025-10-07T10:30:00.000Z",
      "updatedAt": "2025-10-07T11:00:00.000Z",
      "assignedBy": "admin"
    },
    "admin": {
      "role": "product-lister",
      "permissions": [
        "read:products",
        "write:products",
        "list:products"
      ],
      "assignedAt": "2025-10-07T11:00:00.000Z",
      "updatedAt": "2025-10-07T11:00:00.000Z",
      "assignedBy": "admin"
    },
    "projectmangement": {
      "role": "pm",
      "permissions": [
        "read:all",
        "write:projects",
        "manage:projects",
        "manage:team"
      ],
      "assignedAt": "2025-10-07T09:00:00.000Z",
      "updatedAt": "2025-10-07T10:00:00.000Z",
      "assignedBy": "super-admin"
    }
  }
}
```

---

## 🔄 How It Works Automatically

### 1. User Logs In from drive.brmh.in

```
User clicks login → Redirects to:
https://auth.brmh.in/login?next=https://drive.brmh.in/

Backend automatically:
1. Extracts domain: "drive.brmh.in"
2. Extracts namespace: "drive"
3. Adds "drive" to accessedNamespaces
4. Creates default role if first time:
   {
     "drive": {
       "role": "viewer",
       "permissions": ["read:all"]
     }
   }
```

### 2. Admin Assigns Better Role

```bash
curl -X POST https://brmh.in/namespace-roles/assign \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "e4680438-9091-70bd-625d-e31143790d37",
    "namespace": "drive",
    "role": "manager",
    "permissions": ["read:files", "write:files", "delete:files", "manage:folders"],
    "assignedBy": "admin"
  }'
```

### 3. Check Permissions Before Showing UI

```bash
curl -X POST https://brmh.in/namespace-roles/e4680438-9091-70bd-625d-e31143790d37/drive/check-permissions \
  -H "Content-Type: application/json" \
  -d '{
    "requiredPermissions": ["delete:files"]
  }'

# Response:
{
  "success": true,
  "hasPermissions": true,
  "role": "manager",
  "userPermissions": ["read:files", "write:files", "delete:files", "manage:folders"],
  "missingPermissions": []
}
```

---

## 📋 API Endpoints

All endpoints use: `https://brmh.in/namespace-roles`

### 1. Assign Role to User

**POST** `/namespace-roles/assign`

```bash
curl -X POST https://brmh.in/namespace-roles/assign \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "e4680438-9091-70bd-625d-e31143790d37",
    "namespace": "admin",
    "role": "product-lister",
    "permissions": ["read:products", "write:products"],
    "assignedBy": "admin"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Role assigned successfully",
  "namespaceRole": {
    "role": "product-lister",
    "permissions": ["read:products", "write:products"],
    "assignedAt": "2025-10-07T12:00:00.000Z",
    "updatedAt": "2025-10-07T12:00:00.000Z",
    "assignedBy": "admin"
  }
}
```

---

### 2. Get User's Role in Namespace

**GET** `/namespace-roles/:userId/:namespace`

```bash
curl https://brmh.in/namespace-roles/e4680438-9091-70bd-625d-e31143790d37/drive
```

**Response:**
```json
{
  "success": true,
  "userId": "e4680438-9091-70bd-625d-e31143790d37",
  "namespace": "drive",
  "role": "manager",
  "permissions": ["read:files", "write:files", "delete:files", "manage:folders"],
  "assignedAt": "2025-10-07T10:30:00.000Z",
  "updatedAt": "2025-10-07T11:00:00.000Z",
  "assignedBy": "admin"
}
```

---

### 3. Get All Namespace Roles for User

**GET** `/namespace-roles/:userId`

```bash
curl https://brmh.in/namespace-roles/e4680438-9091-70bd-625d-e31143790d37
```

**Response:**
```json
{
  "success": true,
  "userId": "e4680438-9091-70bd-625d-e31143790d37",
  "totalNamespaces": 3,
  "namespaceRoles": {
    "drive": {
      "role": "manager",
      "permissions": ["read:files", "write:files", "delete:files"],
      "assignedAt": "2025-10-07T10:30:00.000Z",
      "updatedAt": "2025-10-07T11:00:00.000Z",
      "assignedBy": "admin"
    },
    "admin": {
      "role": "product-lister",
      "permissions": ["read:products", "write:products"],
      "assignedAt": "2025-10-07T11:00:00.000Z",
      "updatedAt": "2025-10-07T11:00:00.000Z",
      "assignedBy": "admin"
    },
    "projectmangement": {
      "role": "pm",
      "permissions": ["manage:projects", "read:all"],
      "assignedAt": "2025-10-07T09:00:00.000Z",
      "updatedAt": "2025-10-07T10:00:00.000Z",
      "assignedBy": "super-admin"
    }
  }
}
```

---

### 4. Update Role

**PUT** `/namespace-roles/:userId/:namespace`

```bash
curl -X PUT https://brmh.in/namespace-roles/e4680438-9091-70bd-625d-e31143790d37/drive \
  -H "Content-Type: application/json" \
  -d '{
    "role": "senior-manager",
    "permissions": ["read:all", "write:all", "delete:all", "manage:all"]
  }'
```

---

### 5. Check Permissions

**POST** `/namespace-roles/:userId/:namespace/check-permissions`

```bash
curl -X POST https://brmh.in/namespace-roles/e4680438-9091-70bd-625d-e31143790d37/drive/check-permissions \
  -H "Content-Type: application/json" \
  -d '{
    "requiredPermissions": ["delete:files", "manage:folders"]
  }'
```

**Response:**
```json
{
  "success": true,
  "hasPermissions": true,
  "userId": "e4680438-9091-70bd-625d-e31143790d37",
  "namespace": "drive",
  "role": "manager",
  "userPermissions": ["read:files", "write:files", "delete:files", "manage:folders"],
  "requiredPermissions": ["delete:files", "manage:folders"],
  "missingPermissions": []
}
```

---

### 6. Add Permissions

**POST** `/namespace-roles/:userId/:namespace/add-permissions`

```bash
curl -X POST https://brmh.in/namespace-roles/e4680438-9091-70bd-625d-e31143790d37/drive/add-permissions \
  -H "Content-Type: application/json" \
  -d '{
    "permissions": ["export:files", "share:files"]
  }'
```

---

### 7. Remove Permissions

**POST** `/namespace-roles/:userId/:namespace/remove-permissions`

```bash
curl -X POST https://brmh.in/namespace-roles/e4680438-9091-70bd-625d-e31143790d37/drive/remove-permissions \
  -H "Content-Type: application/json" \
  -d '{
    "permissions": ["delete:files"]
  }'
```

---

### 8. Remove Role from Namespace

**DELETE** `/namespace-roles/:userId/:namespace`

```bash
curl -X DELETE https://brmh.in/namespace-roles/e4680438-9091-70bd-625d-e31143790d37/admin
```

---

## 🎨 Frontend Integration

### React Hook Example

```javascript
// useNamespaceRole.js
import { useState, useEffect } from 'react';

export function useNamespaceRole(userId, namespace) {
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRole() {
      try {
        const response = await fetch(
          `https://brmh.in/namespace-roles/${userId}/${namespace}`
        );
        const data = await response.json();
        if (data.success) {
          setRole({
            role: data.role,
            permissions: data.permissions
          });
        }
      } catch (error) {
        console.error('Error fetching role:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchRole();
  }, [userId, namespace]);

  return { role, loading };
}

// Usage:
function DriveApp() {
  const { currentUser } = useAuth();
  const { role, loading } = useNamespaceRole(currentUser.userId, 'drive');

  if (loading) return <Loading />;
  if (!role) return <NoAccess />;

  return (
    <div>
      <h1>Drive - {role.role}</h1>
      {role.permissions.includes('delete:files') && (
        <button>Delete Files</button>
      )}
    </div>
  );
}
```

### Check Permissions Hook

```javascript
// useHasPermissions.js
import { useState, useEffect } from 'react';

export function useHasPermissions(userId, namespace, requiredPermissions) {
  const [hasPermissions, setHasPermissions] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkPermissions() {
      try {
        const response = await fetch(
          `https://brmh.in/namespace-roles/${userId}/${namespace}/check-permissions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requiredPermissions })
          }
        );
        const data = await response.json();
        setHasPermissions(data.hasPermissions);
      } catch (error) {
        console.error('Error checking permissions:', error);
      } finally {
        setLoading(false);
      }
    }
    checkPermissions();
  }, [userId, namespace, requiredPermissions]);

  return { hasPermissions, loading };
}

// Usage:
function DeleteButton() {
  const { currentUser } = useAuth();
  const { hasPermissions } = useHasPermissions(
    currentUser.userId,
    'drive',
    ['delete:files']
  );

  if (!hasPermissions) return null;

  return <button>Delete</button>;
}
```

---

## ✅ Benefits of This Approach

1. **✅ Single Table** - Everything in `brmh-users`, no extra tables
2. **✅ Automatic Tracking** - Namespace extracted from login URL automatically
3. **✅ Simple Queries** - Just query user record, no joins needed
4. **✅ Fast** - No need to query multiple tables
5. **✅ Flexible** - Easy to add/update roles and permissions
6. **✅ Per-Namespace** - Different roles in different namespaces
7. **✅ No Migrations** - Just uses existing `brmh-users` table

---

## 🚀 Complete Example Workflow

```bash
# 1. User logs in from drive.brmh.in
# (Automatically creates default viewer role)

# 2. Admin assigns better role
curl -X POST https://brmh.in/namespace-roles/assign \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "e4680438-9091-70bd-625d-e31143790d37",
    "namespace": "drive",
    "role": "manager",
    "permissions": ["read:files", "write:files", "delete:files", "manage:folders"],
    "assignedBy": "admin"
  }'

# 3. User logs in from admin.brmh.in
# (Automatically creates default viewer role for admin namespace)

# 4. Admin assigns admin role
curl -X POST https://brmh.in/namespace-roles/assign \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "e4680438-9091-70bd-625d-e31143790d37",
    "namespace": "admin",
    "role": "product-lister",
    "permissions": ["read:products", "write:products"],
    "assignedBy": "admin"
  }'

# 5. Check all user's roles
curl https://brmh.in/namespace-roles/e4680438-9091-70bd-625d-e31143790d37

# 6. Frontend checks permissions before showing delete button
curl -X POST https://brmh.in/namespace-roles/e4680438-9091-70bd-625d-e31143790d37/drive/check-permissions \
  -H "Content-Type: application/json" \
  -d '{"requiredPermissions": ["delete:files"]}'
```

---

## 📖 Summary

**Your Use Case:**
- User Baba3 logs in from `drive.brmh.in` → Gets manager role → Has `["read:files", "write:files", "delete:files"]`
- Same user logs in from `admin.brmh.in` → Gets product-lister role → Has `["read:products", "write:products"]`
- Same user in `projectmangement` → Gets PM role → Has `["manage:projects", "read:all"]`

**All stored in ONE table: `brmh-users`!** ✅

No extra tables needed!

