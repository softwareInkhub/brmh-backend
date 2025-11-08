# User Roles Quick Start Guide

## Your Use Case

You want each user to have **different roles in different namespaces**:

- User in `projectmangement` → Role: **PM** → Permissions: manage projects
- Same user in `admin` → Role: **ProductLister** → Permissions: list/edit products  
- Same user in `drive` → Role: **Manager** → Permissions: manage files/folders

---

## 🚀 Quick Setup

### Step 1: Create the Table
```bash
cd brmh-backend
node scripts/create-user-roles-table.js
```

### Step 2: Your Example - Baba3 with Multiple Roles

```bash
# Assign PM role in projectmangement
curl -X POST https://brmh.in/user-roles/assign \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "e4680438-9091-70bd-625d-e31143790d37",
    "namespaceId": "projectmangement",
    "roleId": "role-06eb06f8-ada9-4ff5-b7ea-b1d0b3532e8e",
    "assignedBy": "admin"
  }'

# Assign ProductLister role in admin
curl -X POST https://brmh.in/user-roles/assign \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "e4680438-9091-70bd-625d-e31143790d37",
    "namespaceId": "admin",
    "roleId": "role-product-lister-001",
    "assignedBy": "admin"
  }'

# Assign Manager role in drive
curl -X POST https://brmh.in/user-roles/assign \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "e4680438-9091-70bd-625d-e31143790d37",
    "namespaceId": "drive",
    "roleId": "role-manager-001",
    "assignedBy": "admin"
  }'
```

### Step 3: Check User's Roles

```bash
# Get ALL roles for Baba3
curl https://brmh.in/user-roles/e4680438-9091-70bd-625d-e31143790d37

# Response:
{
  "success": true,
  "userId": "e4680438-9091-70bd-625d-e31143790d37",
  "count": 3,
  "assignments": [
    {
      "namespaceId": "projectmangement",
      "roleId": "role-06eb06f8-ada9-4ff5-b7ea-b1d0b3532e8e",
      "roleName": "PM",
      "permissions": ["manage:projects", "read:all"]
    },
    {
      "namespaceId": "admin",
      "roleId": "role-product-lister-001",
      "roleName": "ProductLister",
      "permissions": ["read:products", "write:products"]
    },
    {
      "namespaceId": "drive",
      "roleId": "role-manager-001",
      "roleName": "Manager",
      "permissions": ["manage:files", "manage:folders"]
    }
  ]
}
```

---

## 📋 Common Operations

### Check User's Role in Specific Namespace

```bash
# What's Baba3's role in projectmangement?
curl https://brmh.in/user-roles/e4680438-9091-70bd-625d-e31143790d37/namespaces/projectmangement

# What's Baba3's role in drive?
curl https://brmh.in/user-roles/e4680438-9091-70bd-625d-e31143790d37/namespaces/drive
```

### Check User's Permissions

```bash
# Can Baba3 manage projects in projectmangement?
curl -X POST https://brmh.in/user-roles/e4680438-9091-70bd-625d-e31143790d37/namespaces/projectmangement/check-permissions \
  -H "Content-Type: application/json" \
  -d '{"requiredPermissions": ["manage:projects"]}'

# Can Baba3 write products in admin?
curl -X POST https://brmh.in/user-roles/e4680438-9091-70bd-625d-e31143790d37/namespaces/admin/check-permissions \
  -H "Content-Type: application/json" \
  -d '{"requiredPermissions": ["write:products"]}'
```

### Change User's Role

```bash
# Promote Baba3 to Senior PM in projectmangement
curl -X PUT https://brmh.in/user-roles/e4680438-9091-70bd-625d-e31143790d37/namespaces/projectmangement \
  -H "Content-Type: application/json" \
  -d '{"roleId": "role-senior-pm-001"}'
```

### Remove Role from Namespace

```bash
# Remove Baba3 from admin namespace
curl -X DELETE https://brmh.in/user-roles/e4680438-9091-70bd-625d-e31143790d37/namespaces/admin
```

---

## 🎯 Real-World Example

```javascript
// Frontend: Check if current user can access a feature

async function canUserAccessFeature(userId, namespaceId, requiredPermissions) {
  const response = await fetch(
    `https://brmh.in/user-roles/${userId}/namespaces/${namespaceId}/check-permissions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requiredPermissions })
    }
  );
  
  const data = await response.json();
  return data.hasPermissions;
}

// Usage:
const canManageProjects = await canUserAccessFeature(
  'e4680438-9091-70bd-625d-e31143790d37',
  'projectmangement',
  ['manage:projects']
);

if (canManageProjects) {
  // Show project management features
}
```

---

## 🔑 Complete Workflow

### 1. First, create roles (one-time per namespace)

```bash
# Create PM role in projectmangement
curl -X POST https://brmh.in/roles-permissions/namespaces/projectmangement/roles \
  -H "Content-Type: application/json" \
  -d '{
    "roleName": "PM",
    "roleDescription": "Project Manager",
    "permissions": ["read:all", "write:projects", "manage:projects", "manage:team"],
    "createdBy": "admin"
  }'

# Create ProductLister role in admin
curl -X POST https://brmh.in/roles-permissions/namespaces/admin/roles \
  -H "Content-Type: application/json" \
  -d '{
    "roleName": "ProductLister",
    "roleDescription": "Can list and edit products",
    "permissions": ["read:products", "write:products", "list:products"],
    "createdBy": "admin"
  }'

# Create Manager role in drive
curl -X POST https://brmh.in/roles-permissions/namespaces/drive/roles \
  -H "Content-Type: application/json" \
  -d '{
    "roleName": "Manager",
    "roleDescription": "Drive Manager",
    "permissions": ["read:files", "write:files", "delete:files", "manage:folders"],
    "createdBy": "admin"
  }'
```

### 2. Then, assign roles to users

```bash
# Assign all three roles to Baba3
# (Use the roleId from the create response above)

curl -X POST https://brmh.in/user-roles/assign \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "e4680438-9091-70bd-625d-e31143790d37",
    "namespaceId": "projectmangement",
    "roleId": "ROLE_ID_FROM_STEP_1",
    "assignedBy": "admin"
  }'
```

---

## 📊 Querying

### Get All Users with Role "PM" in projectmangement

```bash
curl https://brmh.in/user-roles/roles/role-pm-001/namespaces/projectmangement/users
```

### Get User's Complete Permissions Summary

```bash
curl https://brmh.in/user-roles/e4680438-9091-70bd-625d-e31143790d37/permissions-summary

# Response shows all namespaces, roles, and permissions
```

---

## 💡 Best Practices

1. **Create roles first** in each namespace
2. **Then assign roles** to users
3. **Use check-permissions endpoint** in your frontend before showing features
4. **Soft delete** (default) to keep history
5. **Hard delete** only when absolutely necessary

---

## 🎨 Frontend Integration

```javascript
// React Hook Example
function useUserRole(userId, namespaceId) {
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRole() {
      try {
        const response = await fetch(
          `https://brmh.in/user-roles/${userId}/namespaces/${namespaceId}`
        );
        const data = await response.json();
        setRole(data.assignment);
      } catch (error) {
        console.error('Error fetching role:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchRole();
  }, [userId, namespaceId]);

  return { role, loading };
}

// Usage in component:
function ProjectManagementDashboard() {
  const { currentUser } = useAuth();
  const { role, loading } = useUserRole(currentUser.userId, 'projectmangement');

  if (loading) return <Loading />;
  if (!role) return <NoAccess />;

  return (
    <div>
      <h1>Welcome, {role.roleName}!</h1>
      <p>Your permissions: {role.permissions.join(', ')}</p>
    </div>
  );
}
```

---

## ✅ What You Have Now

- ✅ One user can have different roles in different namespaces
- ✅ PM in `projectmangement`
- ✅ ProductLister in `admin`
- ✅ Manager in `drive`
- ✅ Each role has its own permissions
- ✅ Easy to check permissions
- ✅ Easy to update/remove roles

---

## 📖 Full Documentation

- **USER_ROLES_API.md** - Complete API reference
- **ROLES_PERMISSIONS_API.md** - Role management
- **USER_ROLES_QUICKSTART.md** - This file

---

Ready to assign namespace-specific roles to your users! 🚀

