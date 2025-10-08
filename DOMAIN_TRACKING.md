# Domain Tracking System

## 📍 Overview

The domain tracking system automatically records which domains/subdomains users are accessing when they login or signup. This helps you understand user behavior across your platform (drive.brmh.in, admin.brmh.in, app.brmh.in, etc.).

---

## 🎯 What Gets Tracked

When a user logs in or signs up, the system automatically captures:

1. **Domain/Subdomain** - e.g., `drive.brmh.in`, `admin.brmh.in`, `app.brmh.in`
2. **First Access Time** - When the user first accessed each domain
3. **Last Access Time** - Most recent access time for each domain
4. **Access Count** - How many times they've logged in from each domain
5. **Last Accessed Domain** - The most recent domain they used

---

## 📊 User Data Structure

The tracking data is stored in the `metadata` field of each user record in the `brmh-users` table:

```json
{
  "userId": "e4680438-9091-70bd-625d-e31143790d37",
  "username": "Baba3",
  "email": "baba3@gmail.com",
  "cognitoUsername": "Baba3",
  "createdAt": "2025-10-07T10:04:20.934Z",
  "updatedAt": "2025-10-07T12:30:00.000Z",
  "status": "active",
  "metadata": {
    "signupMethod": "email",
    "verified": false,
    "lastLogin": "2025-10-07T12:30:00.000Z",
    "loginCount": 5,
    
    // Domain tracking fields
    "lastAccessedDomain": "drive.brmh.in",
    "accessedDomains": [
      "auth.brmh.in",
      "drive.brmh.in",
      "admin.brmh.in",
      "app.brmh.in"
    ],
    "domainAccessHistory": [
      {
        "domain": "auth.brmh.in",
        "firstAccess": "2025-10-07T10:05:00.000Z",
        "lastAccess": "2025-10-07T10:05:00.000Z",
        "accessCount": 1
      },
      {
        "domain": "drive.brmh.in",
        "firstAccess": "2025-10-07T10:30:00.000Z",
        "lastAccess": "2025-10-07T12:30:00.000Z",
        "accessCount": 3
      },
      {
        "domain": "admin.brmh.in",
        "firstAccess": "2025-10-07T11:00:00.000Z",
        "lastAccess": "2025-10-07T11:15:00.000Z",
        "accessCount": 2
      },
      {
        "domain": "app.brmh.in",
        "firstAccess": "2025-10-07T12:00:00.000Z",
        "lastAccess": "2025-10-07T12:00:00.000Z",
        "accessCount": 1
      }
    ]
  }
}
```

---

## 🔧 How It Works

### Automatic Tracking

The system automatically tracks domains during:

1. **OAuth Login** (Google, Facebook, etc.)
2. **Email/Password Login** (Custom UI)
3. **Phone Number Login**
4. **Email Signup**
5. **Phone Number Signup**

### Domain Extraction

The system extracts the domain from the HTTP request headers:

```javascript
// Checks both origin and referer headers
const origin = req.headers.origin || req.headers.referer;
const domain = extractDomainFromOrigin(origin);
// Result: "drive.brmh.in", "admin.brmh.in", etc.
```

### Data Updates

**First Time Login from a Domain:**
```json
{
  "domain": "drive.brmh.in",
  "firstAccess": "2025-10-07T10:30:00.000Z",
  "lastAccess": "2025-10-07T10:30:00.000Z",
  "accessCount": 1
}
```

**Subsequent Logins from Same Domain:**
```json
{
  "domain": "drive.brmh.in",
  "firstAccess": "2025-10-07T10:30:00.000Z",  // Unchanged
  "lastAccess": "2025-10-07T12:30:00.000Z",   // Updated
  "accessCount": 3                             // Incremented
}
```

---

## 📖 Querying Domain Data

### Get User's Domain History

Use the existing auth endpoint to get user data:

```bash
curl -X GET "https://brmh.in/auth/me" \
  -H "Authorization: Bearer YOUR_ID_TOKEN"
```

**Response:**
```json
{
  "user": {
    "sub": "e4680438-9091-70bd-625d-e31143790d37",
    "email": "baba3@gmail.com",
    "name": "Baba3",
    "metadata": {
      "lastAccessedDomain": "drive.brmh.in",
      "accessedDomains": ["auth.brmh.in", "drive.brmh.in", "admin.brmh.in"],
      "domainAccessHistory": [...]
    }
  }
}
```

### Direct DynamoDB Query

Using the CRUD API:

```bash
curl -X GET "https://brmh.in/crud?tableName=brmh-users&userId=e4680438-9091-70bd-625d-e31143790d37"
```

---

## 📈 Analytics Use Cases

### 1. Most Popular Domains

Find which domains users access most frequently:

```javascript
// Sample analysis script
const users = await getAllUsers();
const domainStats = {};

users.forEach(user => {
  const history = user.metadata?.domainAccessHistory || [];
  history.forEach(entry => {
    if (!domainStats[entry.domain]) {
      domainStats[entry.domain] = { users: 0, totalAccesses: 0 };
    }
    domainStats[entry.domain].users++;
    domainStats[entry.domain].totalAccesses += entry.accessCount;
  });
});

console.log(domainStats);
// {
//   "drive.brmh.in": { users: 150, totalAccesses: 450 },
//   "admin.brmh.in": { users: 25, totalAccesses: 100 },
//   "app.brmh.in": { users: 200, totalAccesses: 800 }
// }
```

### 2. User Journey Tracking

Track which domains users visit in sequence:

```javascript
// Get a user's access pattern
const user = await getUser(userId);
const history = user.metadata.domainAccessHistory || [];

// Sort by first access time to see journey
const journey = history
  .sort((a, b) => new Date(a.firstAccess) - new Date(b.firstAccess))
  .map(entry => ({
    domain: entry.domain,
    when: entry.firstAccess
  }));

console.log(journey);
// [
//   { domain: "auth.brmh.in", when: "2025-10-07T10:05:00Z" },
//   { domain: "drive.brmh.in", when: "2025-10-07T10:30:00Z" },
//   { domain: "admin.brmh.in", when: "2025-10-07T11:00:00Z" }
// ]
```

### 3. Cross-Domain Usage

Identify power users who use multiple services:

```javascript
const users = await getAllUsers();

const crossDomainUsers = users.filter(user => {
  const domains = user.metadata?.accessedDomains || [];
  return domains.length >= 3; // Users accessing 3+ domains
});

console.log(`Power users: ${crossDomainUsers.length}`);
```

### 4. Domain-Specific Activity

Find most active users per domain:

```javascript
const users = await getAllUsers();

function getUsersForDomain(domain) {
  return users
    .map(user => {
      const history = user.metadata?.domainAccessHistory || [];
      const domainEntry = history.find(h => h.domain === domain);
      return {
        userId: user.userId,
        email: user.email,
        accessCount: domainEntry?.accessCount || 0,
        lastAccess: domainEntry?.lastAccess
      };
    })
    .filter(u => u.accessCount > 0)
    .sort((a, b) => b.accessCount - a.accessCount);
}

const driveUsers = getUsersForDomain('drive.brmh.in');
console.log('Top Drive users:', driveUsers.slice(0, 10));
```

---

## 🔍 Metadata Fields Reference

| Field | Type | Description |
|-------|------|-------------|
| `lastAccessedDomain` | String | Most recent domain accessed |
| `accessedDomains` | Array<String> | Unique list of all domains accessed |
| `domainAccessHistory` | Array<Object> | Detailed history per domain |
| `domainAccessHistory[].domain` | String | Domain name (e.g., "drive.brmh.in") |
| `domainAccessHistory[].firstAccess` | ISO String | First time accessed this domain |
| `domainAccessHistory[].lastAccess` | ISO String | Most recent access to this domain |
| `domainAccessHistory[].accessCount` | Number | Total logins from this domain |

---

## 🎨 Frontend Integration Examples

### React Hook for Domain Tracking

```javascript
// useUserDomains.js
import { useState, useEffect } from 'react';

export function useUserDomains(userId) {
  const [domains, setDomains] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDomains() {
      const response = await fetch(
        `https://brmh.in/crud?tableName=brmh-users&userId=${userId}`
      );
      const data = await response.json();
      setDomains(data.item?.metadata);
      setLoading(false);
    }
    fetchDomains();
  }, [userId]);

  return { domains, loading };
}

// Usage in component
function UserDashboard({ userId }) {
  const { domains, loading } = useUserDomains(userId);

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h2>Your Access History</h2>
      <p>Last accessed: {domains.lastAccessedDomain}</p>
      <ul>
        {domains.domainAccessHistory.map(entry => (
          <li key={entry.domain}>
            {entry.domain}: {entry.accessCount} visits
            (Last: {new Date(entry.lastAccess).toLocaleDateString()})
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### Dashboard Widget

```javascript
// DomainActivityWidget.jsx
function DomainActivityWidget({ userMetadata }) {
  const history = userMetadata?.domainAccessHistory || [];
  
  const mostUsedDomain = history.reduce((prev, current) => 
    (prev.accessCount > current.accessCount) ? prev : current
  , history[0]);

  return (
    <div className="domain-activity-widget">
      <h3>Your Activity</h3>
      <div className="stat">
        <span>Domains Accessed</span>
        <strong>{history.length}</strong>
      </div>
      <div className="stat">
        <span>Most Used</span>
        <strong>{mostUsedDomain?.domain}</strong>
      </div>
      <div className="stat">
        <span>Last Login</span>
        <strong>{userMetadata.lastAccessedDomain}</strong>
      </div>
    </div>
  );
}
```

---

## 🚀 Advanced Features

### Custom Domain Tracking Endpoint

If you want a dedicated endpoint for domain analytics, add this to your `index.js`:

```javascript
// Get domain statistics for a user
app.get('/auth/user-domains/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const userRecord = await getUserRecord(userId);
    
    if (!userRecord) {
      return res.status(404).json({ error: 'User not found' });
    }

    const metadata = userRecord.metadata || {};
    
    res.json({
      success: true,
      userId,
      lastAccessedDomain: metadata.lastAccessedDomain,
      accessedDomains: metadata.accessedDomains || [],
      domainHistory: metadata.domainAccessHistory || [],
      totalDomainsAccessed: (metadata.accessedDomains || []).length,
      totalLogins: metadata.loginCount || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

---

## ✅ What's Already Working

- ✅ Automatic domain capture during login/signup
- ✅ Domain history tracking with timestamps
- ✅ Access count per domain
- ✅ List of unique domains accessed
- ✅ Last accessed domain tracking
- ✅ Works with all auth methods (OAuth, email, phone)
- ✅ Non-blocking (won't fail login if tracking fails)
- ✅ Stored in existing `brmh-users` table

---

## 📝 Notes

- Domain tracking is **automatic** - no additional API calls needed
- Uses the `Origin` or `Referer` HTTP headers
- Falls back to "unknown" if headers are missing
- Data is stored in `metadata.domainAccessHistory`
- Updates happen asynchronously (won't slow down login)
- Compatible with existing user records (adds fields on first login)

---

## 🔧 Testing

### Test Domain Tracking

```bash
# Login from drive.brmh.in
curl -X POST https://brmh.in/auth/login \
  -H "Content-Type: application/json" \
  -H "Origin: https://drive.brmh.in" \
  -d '{
    "username": "baba3@gmail.com",
    "password": "yourpassword"
  }'

# Check user data
curl -X GET "https://brmh.in/crud?tableName=brmh-users&userId=YOUR_USER_ID"

# Look for metadata.domainAccessHistory
```

---

## 🎉 Benefits

1. **User Behavior Insights** - Understand which services are most popular
2. **Cross-Platform Analytics** - See how users move between your subdomains
3. **Activity Tracking** - Monitor user engagement per domain
4. **Security** - Detect unusual access patterns
5. **Feature Usage** - Identify which platforms need more resources
6. **User Segmentation** - Group users by their domain preferences

---

Ready to analyze your user activity across all your domains! 🚀

