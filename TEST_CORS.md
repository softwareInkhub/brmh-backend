# 🧪 CORS Testing Guide

Deploy se pehle CORS fix ko test karne ka complete guide.

## 📋 Prerequisites

1. **Backend dependencies installed:**
   ```bash
   cd brmh-backend
   npm install
   ```

2. **Environment variables set:**
   ```bash
   # .env file should have at least:
   PORT=5001
   NODE_ENV=development
   ```

## 🚀 Method 1: Automated Test Script

### Step 1: Start Backend

```bash
cd brmh-backend

# Terminal 1: Start backend
npm run dev
# OR
npm start
```

**Expected output:**
```
Server listening on port 5001
```

### Step 2: Run Test Script

**New Terminal:**
```bash
cd brmh-backend

# Run the test script
node test-cors.js

# OR with custom backend URL
API_BASE_URL=http://localhost:5001 node test-cors.js
```

**Expected output:**
```
🧪 Testing CORS Configuration

Backend URL: http://localhost:5001
Test Origin: https://auth.brmh.in

============================================================
TEST 1: Health Check (should have CORS headers)
============================================================
✅ GET /health
   Status: 200
   CORS Headers: ✅ All present

============================================================
TEST 2: Auth Health Check
============================================================
✅ GET /auth/health
   Status: 200
   CORS Headers: ✅ All present

...
```

## 🔧 Method 2: Manual Testing with curl

### Test 1: Health Check with CORS

```bash
curl -i -X GET http://localhost:5001/health \
  -H "Origin: https://auth.brmh.in" \
  -H "Access-Control-Request-Method: GET"
```

**Check for these headers in response:**
```
Access-Control-Allow-Origin: https://auth.brmh.in
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, Cookie
```

### Test 2: OPTIONS Preflight Request

```bash
curl -i -X OPTIONS http://localhost:5001/auth/login \
  -H "Origin: https://auth.brmh.in" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type"
```

**Expected:**
- Status: `204 No Content`
- All CORS headers present

### Test 3: Login Error (Should have CORS headers)

```bash
curl -i -X POST http://localhost:5001/auth/login \
  -H "Origin: https://auth.brmh.in" \
  -H "Content-Type: application/json" \
  -d '{"username":"invalid@test.com","password":"wrong"}'
```

**Expected:**
- Status: `401` or `400`
- **IMPORTANT:** CORS headers should still be present even on error!

### Test 4: Missing Fields Error (400)

```bash
curl -i -X POST http://localhost:5001/auth/login \
  -H "Origin: https://auth.brmh.in" \
  -H "Content-Type: application/json" \
  -d '{"username":""}'
```

**Expected:**
- Status: `400`
- CORS headers present

### Test 5: 404 Error (Should have CORS headers)

```bash
curl -i -X GET http://localhost:5001/non-existent-endpoint \
  -H "Origin: https://auth.brmh.in"
```

**Expected:**
- Status: `404`
- CORS headers present

## 🌐 Method 3: Browser Testing

### Step 1: Start Backend
```bash
cd brmh-backend
npm run dev
```

### Step 2: Start Frontend (if available)
```bash
cd auth-brmh
npm run dev
```

### Step 3: Test in Browser Console

1. **Open browser:** http://localhost:3000 (or your frontend port)

2. **Open Developer Tools (F12)** → Console tab

3. **Test login request:**
   ```javascript
   fetch('http://localhost:5001/auth/login', {
     method: 'POST',
     headers: {
       'Content-Type': 'application/json',
     },
     credentials: 'include',
     body: JSON.stringify({
       username: 'test@example.com',
       password: 'wrongpassword'
     })
   })
   .then(res => {
     console.log('Status:', res.status);
     console.log('CORS Headers:', {
       'Access-Control-Allow-Origin': res.headers.get('Access-Control-Allow-Origin'),
       'Access-Control-Allow-Credentials': res.headers.get('Access-Control-Allow-Credentials')
     });
     return res.json();
   })
   .then(data => console.log('Response:', data))
   .catch(err => console.error('Error:', err));
   ```

4. **Check Network Tab:**
   - Open Network tab in DevTools
   - Look for the `/auth/login` request
   - Check Response Headers section
   - Verify CORS headers are present even on error responses

## ✅ Success Criteria

All tests should pass if CORS is configured correctly:

- ✅ **200 responses** have CORS headers
- ✅ **400/401/404/500 error responses** have CORS headers
- ✅ **OPTIONS preflight** returns 204 with CORS headers
- ✅ **No CORS errors** in browser console
- ✅ **errorHandler** sets CORS headers on all errors

## 🐛 Troubleshooting

### Issue: CORS headers missing on errors

**Solution:** Check that `errorHandler` is registered in `index.js`:
```javascript
// Should be after all routes, before app.listen
app.use(errorHandler);
```

### Issue: OPTIONS returns 403

**Solution:** Check that OPTIONS handler is before routes:
```javascript
app.options('/auth/*', (req, res) => {
  // ... CORS headers
  res.status(200).end();
});
```

### Issue: Backend not starting

**Check:**
```bash
# Check if port is in use
lsof -i :5001  # Mac/Linux
netstat -ano | findstr :5001  # Windows

# Check logs
npm run dev
```

## 📝 Quick Test Checklist

- [ ] Backend starts without errors
- [ ] Health check returns CORS headers
- [ ] OPTIONS preflight returns 204 with CORS headers
- [ ] Login error (401) returns CORS headers
- [ ] Missing fields error (400) returns CORS headers
- [ ] 404 error returns CORS headers
- [ ] Browser console shows no CORS errors

## 🚀 After Testing

Once all tests pass locally:

1. **Commit changes:**
   ```bash
   git add brmh-backend/middleware/errorHandler.js
   git add brmh-backend/index.js
   git commit -m "Fix CORS headers in error responses"
   ```

2. **Deploy to production**

3. **Test in production** with the same curl commands (replace `localhost:5001` with `https://brmh.in`)

