# Admin User Management API

## 🎯 Problem Solved

**Issue:** Users were being created directly in DynamoDB (`brmh-users` table) which bypassed AWS Cognito. This meant:
- ❌ Users couldn't log in (Cognito didn't know about them)
- ❌ Email verification didn't work
- ❌ Password reset didn't work

**Solution:** New admin endpoints that create users in **BOTH** Cognito and DynamoDB simultaneously.

---

## ✅ How It Works Now

```
Admin API → Cognito User Pool → DynamoDB (brmh-users)
         ✅ Creates user       ✅ Stores metadata
```

Both systems are synchronized!

---

## 📋 Admin Endpoints

### 1. Create User (Cognito + DynamoDB)

**POST** `/admin/users/create`

Creates a user in BOTH Cognito User Pool and DynamoDB table.

**Request Body:**
```json
{
  "email": "baba4@gmail.com",
  "username": "Baba4",
  "password": "MySecurePass123!",
  "phoneNumber": "+1234567890",
  "temporaryPassword": false,
  "namespace": "drive",
  "role": "viewer",
  "permissions": ["read:files"]
}
```

**Required Fields:**
- `email` (String) - User's email address

**Optional Fields:**
- `username` (String) - Display name (defaults to email prefix)
- `password` (String) - User's password (auto-generated if not provided)
- `phoneNumber` (String) - Phone number in E.164 format
- `temporaryPassword` (Boolean) - If true, generates a temporary password
- `namespace` (String) - Assign user to a namespace immediately
- `role` (String) - Role name for the namespace
- `permissions` (Array) - Permissions for the namespace

**Example - Simple User:**
```bash
curl -X POST https://brmh.in/admin/users/create \
  -H "Content-Type: application/json" \
  -d '{
    "email": "baba4@gmail.com",
    "username": "Baba4",
    "password": "SecurePass123!"
  }'
```

**Example - User with Namespace Role:**
```bash
curl -X POST https://brmh.in/admin/users/create \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@company.com",
    "username": "John Doe",
    "password": "SecurePass123!",
    "namespace": "drive",
    "role": "manager",
    "permissions": ["read:files", "write:files", "delete:files"]
  }'
```

**Example - User with Temporary Password:**
```bash
curl -X POST https://brmh.in/admin/users/create \
  -H "Content-Type: application/json" \
  -d '{
    "email": "employee@company.com",
    "temporaryPassword": true
  }'
```

**Success Response (201):**
```json
{
  "success": true,
  "message": "User created successfully in both Cognito and DynamoDB",
  "user": {
    "userId": "e4680438-9091-70bd-625d-e31143790d37",
    "cognitoUsername": "Baba4",
    "email": "baba4@gmail.com",
    "phoneNumber": null,
    "temporaryPassword": "TempAbc123!",
    "emailVerificationRequired": true
  }
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": "Failed to create user in Cognito",
  "details": "User already exists"
}
```

---

### 2. Confirm User Email (Admin)

**POST** `/admin/users/confirm`

Manually confirm a user's email without requiring them to click the verification link.

**Request Body:**
```json
{
  "username": "Baba4"
}
```

**Required Fields:**
- `username` (String) - The cognitoUsername (not email)

**Example:**
```bash
curl -X POST https://brmh.in/admin/users/confirm \
  -H "Content-Type: application/json" \
  -d '{
    "username": "Baba4"
  }'
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "User confirmed successfully"
}
```

**What It Does:**
1. ✅ Confirms user in Cognito (can now login)
2. ✅ Updates DynamoDB record (`metadata.verified = true`)

---

### 3. List All Users

**GET** `/admin/users/list?limit=60`

Lists all users in the Cognito User Pool.

**Query Parameters:**
- `limit` (Number) - Max users to return (default: 60)

**Example:**
```bash
curl https://brmh.in/admin/users/list?limit=100
```

**Success Response (200):**
```json
{
  "success": true,
  "count": 3,
  "users": [
    {
      "username": "Baba3",
      "userStatus": "CONFIRMED",
      "enabled": true,
      "userCreateDate": "2025-10-07T10:04:20.934Z",
      "attributes": {
        "sub": "e4680438-9091-70bd-625d-e31143790d37",
        "email": "baba3@gmail.com",
        "email_verified": "true"
      }
    },
    {
      "username": "Baba4",
      "userStatus": "UNCONFIRMED",
      "enabled": true,
      "userCreateDate": "2025-10-08T12:00:00.000Z",
      "attributes": {
        "sub": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "email": "baba4@gmail.com",
        "email_verified": "false"
      }
    }
  ]
}
```

**User Status Values:**
- `UNCONFIRMED` - Email not verified yet
- `CONFIRMED` - Email verified, can login
- `FORCE_CHANGE_PASSWORD` - Must change password on first login
- `ARCHIVED` - User disabled

---

## 🚀 Complete Workflow

### Scenario: Admin Creates New User

```bash
# 1. Create user in both Cognito and DynamoDB
curl -X POST https://brmh.in/admin/users/create \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@company.com",
    "username": "New User",
    "password": "SecurePass123!",
    "namespace": "drive",
    "role": "viewer",
    "permissions": ["read:files"]
  }'

# Response:
{
  "success": true,
  "user": {
    "userId": "abc-123-xyz",
    "cognitoUsername": "New_User",
    "email": "newuser@company.com",
    "emailVerificationRequired": true
  }
}

# 2. User receives verification email from Cognito
# (User clicks link in email to verify)

# OR admin can confirm manually:
curl -X POST https://brmh.in/admin/users/confirm \
  -H "Content-Type: application/json" \
  -d '{"username": "New_User"}'

# 3. User can now login!
curl -X POST https://brmh.in/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "newuser@company.com",
    "password": "SecurePass123!"
  }'
```

---

## 📊 Comparison: Wrong Way vs Right Way

### ❌ Wrong Way (What You Were Doing):

```bash
# Direct DynamoDB insert (bypasses Cognito)
curl -X POST https://brmh.in/crud?tableName=brmh-users \
  -H "Content-Type: application/json" \
  -d '{
    "item": {
      "userId": "manual-id",
      "email": "user@example.com"
    }
  }'

# Result:
✅ User in DynamoDB
❌ User NOT in Cognito
❌ Can't login
❌ Can't verify email
❌ Can't reset password
```

### ✅ Right Way (Use Admin API):

```bash
# Use admin endpoint
curl -X POST https://brmh.in/admin/users/create \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!"
  }'

# Result:
✅ User in Cognito User Pool
✅ User in DynamoDB
✅ Can login
✅ Can verify email
✅ Can reset password
```

---

## 🔐 Security Recommendations

### 1. Add Authentication to Admin Endpoints

You should protect these endpoints with admin authentication:

```javascript
// In index.js, add middleware
const adminAuth = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    const decoded = await validateJwtToken(token);
    // Check if user is admin
    const userRecord = await getUserRecord(decoded.sub);
    if (!userRecord.isAdmin) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Apply to admin routes
app.post('/admin/users/create', adminAuth, adminCreateUserHandler);
app.post('/admin/users/confirm', adminAuth, adminConfirmUserHandler);
app.get('/admin/users/list', adminAuth, adminListUsersHandler);
```

### 2. Add Rate Limiting

```javascript
import rateLimit from 'express-rate-limit';

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 requests per windowMs
  message: 'Too many admin requests, please try again later'
});

app.use('/admin/', adminLimiter);
```

---

## 💡 Migration: Fix Existing Users

If you already have users in DynamoDB that aren't in Cognito:

### Option 1: Re-create Them

```bash
# For each user in DynamoDB, create in Cognito
curl -X POST https://brmh.in/admin/users/create \
  -H "Content-Type: application/json" \
  -d '{
    "email": "existinguser@example.com",
    "username": "Existing User",
    "password": "TemporaryPass123!"
  }'

# Then confirm them
curl -X POST https://brmh.in/admin/users/confirm \
  -H "Content-Type: application/json" \
  -d '{"username": "Existing_User"}'

# Send them email to reset password
```

### Option 2: Delete and Re-invite

```bash
# Delete from DynamoDB
curl -X DELETE "https://brmh.in/crud?tableName=brmh-users" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "orphaned-user-id"
  }'

# Create properly using admin API
curl -X POST https://brmh.in/admin/users/create \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "temporaryPassword": true
  }'
```

---

## 📝 Best Practices

### ✅ DO:
1. **Always use `/admin/users/create`** to create users
2. **Confirm users** with `/admin/users/confirm` for testing
3. **List Cognito users** to verify they were created
4. **Protect admin endpoints** with authentication
5. **Use temporary passwords** for bulk user creation

### ❌ DON'T:
1. **Don't create users directly in DynamoDB** using CRUD API
2. **Don't skip email verification** in production
3. **Don't share real passwords** (use temporary passwords)
4. **Don't expose admin endpoints** without authentication

---

## 🎉 Summary

**Problem:** Users created in DynamoDB weren't in Cognito → couldn't login

**Solution:** 
- ✅ Use `/admin/users/create` - creates in BOTH places
- ✅ Use `/admin/users/confirm` - manually verify emails
- ✅ Use `/admin/users/list` - see all Cognito users

**Now users can:**
- ✅ Login with email/password
- ✅ Verify their email
- ✅ Reset their password
- ✅ Use all Cognito features

---

## 🔗 Related Documentation

- **Auth Flow:** See `brmh-auth.js` for login/signup
- **Namespace Roles:** See `NAMESPACE_ROLES_GUIDE.md` for role management
- **Domain Tracking:** See `DOMAIN_TRACKING.md` for access tracking

---

**Always create users through the admin API to ensure they exist in both Cognito and DynamoDB!** ✅

