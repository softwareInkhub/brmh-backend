# 🎉 Namespace Roles System - Simplified Single Table Approach

## What Changed

You wanted **everything in one table (`brmh-users`)** instead of multiple tables. Done! ✅

---

## 🎯 Your Exact Use Case - Implemented!

When user **Baba3** visits different subdomains:

| URL Visited | Namespace Extracted | Role Assigned | Permissions |
|-------------|-------------------|---------------|-------------|
| `https://auth.brmh.in/login?next=https://drive.brmh.in/` | `drive` | `manager` | `read:files`, `write:files`, `delete:files` |
| `https://auth.brmh.in/login?next=https://admin.brmh.in/` | `admin` | `product-lister` | `read:products`, `write:products` |
| Project Management page | `projectmangement` | `pm` | `manage:projects`, `read:all` |

**All stored in the same `brmh-users` table!**

---

## 📊 User Record Structure

```json
{
  "userId": "e4680438-9091-70bd-625d-e31143790d37",
  "username": "Baba3",
  "email": "baba3@gmail.com",
  
  "metadata": {
    "accessedDomains": ["drive.brmh.in", "admin.brmh.in"],
    "accessedNamespaces": ["drive", "admin", "projectmangement"],
    "lastAccessedNamespace": "drive"
  },
  
  "namespaceRoles": {
    "drive": {
      "role": "manager",
      "permissions": ["read:files", "write:files", "delete:files"]
    },
    "admin": {
      "role": "product-lister",
      "permissions": ["read:products", "write:products"]
    },
    "projectmangement": {
      "role": "pm",
      "permissions": ["manage:projects", "read:all"]
    }
  }
}
```

---

## 🔄 How It Works

### 1. Automatic Namespace Detection

When user hits: `https://auth.brmh.in/login?next=https://drive.brmh.in/`

Backend automatically:
1. Extracts domain: `drive.brmh.in`
2. Extracts namespace: `drive` (subdomain)
3. Adds to `accessedNamespaces` list
4. Creates default `viewer` role if first time

### 2. Admin Assigns Real Role

```bash
curl -X POST https://brmh.in/namespace-roles/assign \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "e4680438-9091-70bd-625d-e31143790d37",
    "namespace": "drive",
    "role": "manager",
    "permissions": ["read:files", "write:files", "delete:files"]
  }'
```

### 3. Frontend Checks Permissions

```bash
curl -X POST https://brmh.in/namespace-roles/e4680438-9091-70bd-625d-e31143790d37/drive/check-permissions \
  -H "Content-Type: application/json" \
  -d '{"requiredPermissions": ["delete:files"]}'

# Response:
{
  "success": true,
  "hasPermissions": true
}
```

---

## 📋 API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/namespace-roles/assign` | Assign role to user |
| GET | `/namespace-roles/:userId/:namespace` | Get role in namespace |
| GET | `/namespace-roles/:userId` | Get all namespace roles |
| PUT | `/namespace-roles/:userId/:namespace` | Update role |
| DELETE | `/namespace-roles/:userId/:namespace` | Remove role |
| POST | `/namespace-roles/:userId/:namespace/check-permissions` | Check permissions |
| POST | `/namespace-roles/:userId/:namespace/add-permissions` | Add permissions |
| POST | `/namespace-roles/:userId/:namespace/remove-permissions` | Remove permissions |

---

## 📁 Files Created/Modified

### ✅ Created:
1. **`utils/namespace-roles.js`** - All namespace role management handlers
2. **`NAMESPACE_ROLES_GUIDE.md`** - Complete API documentation
3. **`NAMESPACE_ROLES_SUMMARY.md`** - This file

### ✅ Modified:
1. **`utils/brmh-auth.js`** 
   - Added `extractNamespaceFromDomain()` function
   - Updated `createUserRecord()` to include namespace roles
   - Updated `updateUserLoginWithDomain()` to track namespaces
   - Auto-creates default role when accessing new namespace

2. **`index.js`**
   - Added 8 new namespace-role routes
   - Imports from `namespace-roles.js`

---

## 🚀 Quick Start

### Your Exact Use Case:

```bash
# 1. Assign PM role in projectmangement
curl -X POST https://brmh.in/namespace-roles/assign \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "e4680438-9091-70bd-625d-e31143790d37",
    "namespace": "projectmangement",
    "role": "pm",
    "permissions": ["manage:projects", "read:all", "write:projects"]
  }'

# 2. Assign product-lister role in admin
curl -X POST https://brmh.in/namespace-roles/assign \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "e4680438-9091-70bd-625d-e31143790d37",
    "namespace": "admin",
    "role": "product-lister",
    "permissions": ["read:products", "write:products"]
  }'

# 3. Assign manager role in drive
curl -X POST https://brmh.in/namespace-roles/assign \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "e4680438-9091-70bd-625d-e31143790d37",
    "namespace": "drive",
    "role": "manager",
    "permissions": ["read:files", "write:files", "delete:files", "manage:folders"]
  }'

# 4. Get all roles for Baba3
curl https://brmh.in/namespace-roles/e4680438-9091-70bd-625d-e31143790d37

# 5. Check if Baba3 can delete files in drive
curl -X POST https://brmh.in/namespace-roles/e4680438-9091-70bd-625d-e31143790d37/drive/check-permissions \
  -H "Content-Type: application/json" \
  -d '{"requiredPermissions": ["delete:files"]}'
```

---

## ✅ Key Benefits

1. **✅ Single Table** - Everything in `brmh-users`
2. **✅ No Migrations** - Uses existing table structure
3. **✅ Automatic Tracking** - Namespace extracted from URL
4. **✅ Simple** - No complex joins or queries
5. **✅ Fast** - Single record read for all namespaces
6. **✅ Flexible** - Easy to add/update roles per namespace

---

## 🎨 Frontend Example

```javascript
// Check if user can delete files
async function canDeleteFiles(userId, namespace) {
  const response = await fetch(
    `https://brmh.in/namespace-roles/${userId}/${namespace}/check-permissions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requiredPermissions: ['delete:files'] })
    }
  );
  const data = await response.json();
  return data.hasPermissions;
}

// Usage:
const canDelete = await canDeleteFiles('user-123', 'drive');
if (canDelete) {
  showDeleteButton();
}
```

---

## 📖 Documentation

- **`NAMESPACE_ROLES_GUIDE.md`** - Complete API reference with all endpoints
- **`NAMESPACE_ROLES_SUMMARY.md`** - This summary file
- **`DOMAIN_TRACKING.md`** - Domain/namespace tracking details

---

## 🎉 What You Have Now

**One user, multiple namespaces, different roles:**

```
Baba3 (e4680438-9091-70bd-625d-e31143790d37)
  ├─ drive → manager → [read:files, write:files, delete:files]
  ├─ admin → product-lister → [read:products, write:products]
  └─ projectmangement → pm → [manage:projects, read:all]
```

**All in ONE table: `brmh-users`!** ✅

No separate `brmh-roles-permissions` or `brmh-user-roles` tables needed!

---

## 🔧 Next Steps

1. **Restart your backend** (routes are already registered)
2. **Assign roles** to Baba3 using the API
3. **Test in frontend** by checking permissions before showing features

---

**Your requirement is now fully implemented!** 🚀

Namespace-specific roles and permissions, all stored in the `brmh-users` table!

