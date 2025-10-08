# Admin User Creation - Quick Start

## ❌ The Problem You Had

You were creating users like this:

```bash
# WRONG - Direct DynamoDB insert
curl -X POST https://brmh.in/crud?tableName=brmh-users \
  -d '{
    "item": {
      "userId": "some-id",
      "email": "baba4@gmail.com",
      "username": "Baba4"
    }
  }'
```

**Result:**
- ✅ User appears in `brmh-users` DynamoDB table
- ❌ User **NOT** in Cognito User Pool
- ❌ User **CANNOT** login
- ❌ Email verification **DOESN'T WORK**
- ❌ Password reset **DOESN'T WORK**

---

## ✅ The Solution

Use the new admin endpoint:

```bash
# RIGHT - Admin API (creates in both)
curl -X POST https://brmh.in/admin/users/create \
  -H "Content-Type: application/json" \
  -d '{
    "email": "baba4@gmail.com",
    "username": "Baba4",
    "password": "SecurePass123!"
  }'
```

**Result:**
- ✅ User created in Cognito User Pool
- ✅ User created in `brmh-users` DynamoDB table
- ✅ User CAN login
- ✅ Email verification WORKS
- ✅ Password reset WORKS

---

## 🚀 Quick Commands

### Create User
```bash
curl -X POST https://brmh.in/admin/users/create \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@gmail.com",
    "username": "New User",
    "password": "SecurePass123!"
  }'
```

### Create User with Namespace Role
```bash
curl -X POST https://brmh.in/admin/users/create \
  -H "Content-Type: application/json" \
  -d '{
    "email": "manager@company.com",
    "username": "Drive Manager",
    "password": "SecurePass123!",
    "namespace": "drive",
    "role": "manager",
    "permissions": ["read:files", "write:files", "delete:files"]
  }'
```

### Confirm User Email (Skip Verification)
```bash
curl -X POST https://brmh.in/admin/users/confirm \
  -H "Content-Type: application/json" \
  -d '{"username": "Baba4"}'
```

### List All Cognito Users
```bash
curl https://brmh.in/admin/users/list
```

---

## 🔍 Verify Users Exist in Both Places

### Check Cognito
```bash
curl https://brmh.in/admin/users/list

# Look for your user in the response
```

### Check DynamoDB
```bash
curl "https://brmh.in/crud?tableName=brmh-users&userId=USER_ID_HERE"
```

---

## 🎯 Your Exact Use Case

```bash
# Create Baba4 with roles in multiple namespaces
curl -X POST https://brmh.in/admin/users/create \
  -H "Content-Type: application/json" \
  -d '{
    "email": "baba4@gmail.com",
    "username": "Baba4",
    "password": "SecurePass123!",
    "namespace": "drive",
    "role": "manager",
    "permissions": ["read:files", "write:files", "delete:files"]
  }'

# Then assign other namespace roles
curl -X POST https://brmh.in/namespace-roles/assign \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "USER_ID_FROM_RESPONSE",
    "namespace": "admin",
    "role": "product-lister",
    "permissions": ["read:products", "write:products"]
  }'

# Confirm email so user can login
curl -X POST https://brmh.in/admin/users/confirm \
  -H "Content-Type: application/json" \
  -d '{"username": "Baba4"}'
```

---

## ⚠️ Important Notes

### User Creation Flow:

```
1. Admin calls /admin/users/create
   ↓
2. Creates user in Cognito User Pool
   ↓
3. Cognito returns userSub (userId)
   ↓
4. Creates record in brmh-users table
   ↓
5. User exists in BOTH places ✅
```

### What Gets Created:

**In Cognito:**
- Username
- Email
- Password (hashed)
- Email verification status

**In DynamoDB (brmh-users):**
- userId (from Cognito sub)
- username
- email
- cognitoUsername
- namespaceRoles (if provided)
- metadata

---

## 🔄 Fix Existing Users

If you already have users in DynamoDB but not in Cognito:

```bash
# Option 1: Re-create them properly
curl -X POST https://brmh.in/admin/users/create \
  -H "Content-Type: application/json" \
  -d '{
    "email": "existing@example.com",
    "temporaryPassword": true
  }'

# Option 2: Delete orphaned records
curl -X DELETE "https://brmh.in/crud?tableName=brmh-users" \
  -d '{"userId": "orphaned-user-id"}'
```

---

## 📖 Related Docs

- **`ADMIN_USER_MANAGEMENT.md`** - Complete admin API docs
- **`NAMESPACE_ROLES_GUIDE.md`** - Namespace role management
- **`DOMAIN_TRACKING.md`** - Domain access tracking

---

## ✅ Summary

**Always create users via:**
```
POST /admin/users/create
```

**Never create users via:**
```
POST /crud?tableName=brmh-users  ❌
```

This ensures users exist in **both** Cognito and DynamoDB! 🎉

