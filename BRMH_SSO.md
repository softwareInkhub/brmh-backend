## BRMH Single Sign‑On (SSO) – Quick Guide

This document explains how to enable SSO across BRMH apps using Amazon Cognito as the Identity Provider (IdP) with the Authorization Code + PKCE flow and the Hosted UI.

### Architecture
- **IdP**: Amazon Cognito User Pool (+ optional social/SAML IdPs)
- **Flow**: Authorization Code + PKCE via Cognito Hosted UI
- **Tokens**: ID token (user profile), Access token (API), Refresh token (renewal)
- **Session propagation**: Secure HttpOnly cookies (shared on the same apex domain) or bearer tokens

### Prerequisites
- A Cognito User Pool and an App Client (no client secret for SPA/mobile)
- Cognito Hosted UI domain set (e.g., https://your-domain.auth.us-east-1.amazoncognito.com)
- App callback/logout URLs registered for every app

### Required environment variables
- `AWS_COGNITO_REGION`
- `AWS_COGNITO_USER_POOL_ID`
- `AWS_COGNITO_CLIENT_ID`
- `AWS_COGNITO_DOMAIN` (Hosted UI domain URL)
- `AUTH_REDIRECT_URI` (e.g., https://app.yourdomain.com/auth/callback)
- `AUTH_LOGOUT_REDIRECT_URI` (e.g., https://app.yourdomain.com/)

### Backend (Express) – endpoints to implement
Add routes (examples shown in the codebase outline):
- `POST /auth/login` – direct username/password authentication with Cognito
- `POST /auth/signup` – create new user account with Cognito
- `POST /auth/phone/signup` – create account with phone number and SMS OTP
- `POST /auth/phone/login` – login with phone number and password
- `POST /auth/phone/verify` – verify phone number with OTP code
- `POST /auth/phone/resend-otp` – resend OTP to phone number
- `GET /auth/oauth-url` – generate PKCE challenge, redirect to Cognito authorize URL
- `POST /auth/token` – exchange code for tokens (OAuth flow)
- `POST /auth/refresh` – refresh access tokens
- `POST /auth/validate` – verify JWT tokens
- `POST /auth/logout` – revoke tokens and clear session
- `GET /auth/logout-url` – get Cognito Hosted UI logout URL

JWT validation:
- Validate tokens against Cognito JWKS: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`
- Verify `issuer` and `audience` (App Client ID), algorithm `RS256`

Cookies (recommended for web SSO):
- `HttpOnly`, `Secure`, `SameSite=None`, `Domain=.yourdomain.com` (share across subdomains)

### Frontend (Next.js) – integration
- Replace direct username/password flows with redirects:
  - Login button → `GET /auth/login`
  - On app load → call `/auth/me`; if 401, show login
- For different apps under the same apex domain, cookies provide seamless SSO. For different domains, each app still redirects to the Hosted UI (user won’t re‑enter credentials while IdP session is active).

### Cognito configuration checklist
- App Client: no secret, enable `Authorization code grant` and `Implicit code grant` off (prefer code), allow `openid profile email` scopes
- Hosted UI: set domain, callback/logout URLs for all apps
- Optional IdPs: Google/Microsoft/SAML; map attributes to `email`, `name`, etc.

### Phone Number Authentication Setup
To enable phone number authentication with SMS OTP:

1. **User Pool Configuration**:
   - Go to AWS Console → Cognito → User Pools → Your Pool
   - Under "Sign-in experience" → "Username": Select "Phone number" or "Email address or phone number"
   - Under "Security" → "Multi-factor authentication": Enable "SMS text message"
   - Under "Messaging" → "SMS": Configure your SMS settings and SNS for delivery

2. **SMS Configuration**:
   - Set up Amazon SNS for SMS delivery
   - Configure SMS role with appropriate permissions
   - Set SMS spending limit to control costs

3. **Phone Number Format**:
   - Phone numbers must be in E.164 format (e.g., +1234567890)
   - The backend automatically formats phone numbers if needed

### Security best practices
- Use PKCE (required here)
- Short access token lifetime, reasonable ID token lifetime, enable refresh token rotation if desired
- Serve over HTTPS only; set CORS allowlist for your apps
- Store tokens in HttpOnly cookies; avoid localStorage for ID/access tokens

### Multi‑app SSO patterns
- Same apex domain (recommended): share cookies using `Domain=.yourdomain.com`
- Different domains: rely on Cognito session; each app redirects to Hosted UI but user is not prompted again

### Troubleshooting
- 400 “invalid_redirect_uri”: ensure callback/logout URIs match exactly in Cognito
- 401 “Invalid token”: check issuer/audience, JWKS fetch, clock skew
- Cookies not set: verify HTTPS, `SameSite=None`, correct `Domain`
- CORS errors: add your frontend origins to the backend CORS config

### Minimal route flow (summary)
1) `/auth/login` → redirect to Cognito authorize with PKCE challenge
2) `/auth/callback` → exchange `code` for tokens → set cookies → redirect
3) `/auth/me` → verify token → return user
4) Protected APIs use JWT middleware to authorize requests
5) `/auth/logout` → clear cookies → redirect to Cognito logout

With this setup, all BRMH apps authenticate against the same Cognito User Pool and share a single sign‑on experience.










Step-by-step: Enable BRMH SSO with Cognito Hosted UI (Authorization Code + PKCE)
1) Create Cognito User Pool (once)
In AWS Console → Cognito → Create User Pool
Pool name: brmh-users
Attributes: email required; username = email (recommended)
Apps → App clients → Create app client
Name: brmh-web
Do NOT generate a client secret
Allowed OAuth flows: Authorization code grant
Allowed scopes: openid, profile, email
Callback URLs: add every app callback, e.g. https://app.yourdomain.com/auth/callback, https://admin.yourdomain.com/auth/callback
Sign-out URLs: https://app.yourdomain.com/, https://admin.yourdomain.com/
Domain: Set Hosted UI domain, e.g. https://brmh-login.auth.us-east-1.amazoncognito.com
2) Collect values
AWS_COGNITO_REGION: us-east-1 (example)
AWS_COGNITO_USER_POOL_ID: us-east-1_XXXXXXX
AWS_COGNITO_CLIENT_ID: XXXXXXXXXXXXX
AWS_COGNITO_DOMAIN: https://brmh-login.auth.us-east-1.amazoncognito.com
AUTH_REDIRECT_URI: https://app.yourdomain.com/auth/callback
AUTH_LOGOUT_REDIRECT_URI: https://app.yourdomain.com/
3) Set environment variables
Add to your backend .env:

AWS_COGNITO_REGION=us-east-1
AWS_COGNITO_USER_POOL_ID=us-east-1_XXXXXXX
AWS_COGNITO_CLIENT_ID=XXXXXXXXXXXXX
AWS_COGNITO_DOMAIN=https://brmh-login.auth.us-east-1.amazoncognito.com
AUTH_REDIRECT_URI=https://app.yourdomain.com/auth/callback
AUTH_LOGOUT_REDIRECT_URI=https://app.yourdomain.com/
NODE_ENV=production



For local dev, use http://localhost:5001 in redirect URIs and add localhost URLs in Cognito.
4) Add backend auth routes
Implement these routes in your Express server (login → callback → me → logout) using PKCE and HttpOnly cookies:
GET /auth/login (generates PKCE challenge, redirects to Cognito authorize)
GET /auth/callback (exchanges code → tokens; sets cookies id, at, rt)
GET /auth/me (verifies id token, returns user claims)
POST /auth/logout (clears cookies, redirects to Cognito logout)
Cookie flags for production:
HttpOnly, Secure, SameSite=None, Domain=.yourdomain.com
5) Protect APIs
Add JWT middleware that validates the id token from cookie or Authorization header against Cognito JWKS:
Issuer: https://cognito-idp.${AWS_COGNITO_REGION}.amazonaws.com/${AWS_COGNITO_USER_POOL_ID}
Audience: AWS_COGNITO_CLIENT_ID
Apply middleware to routes you want to protect (e.g., /unified/*, /crud, etc.).
6) Frontend integration (Next.js)
Login button: navigate to /auth/login
On app load (layout or top-level page), call /auth/me
If 200 → store user in state
If 401 → show “Login” button
Callback page (e.g., /auth/callback on frontend) can just show a spinner; the backend callback sets cookies then redirects you back to app.
7) Enable SSO across multiple apps
Deploy all apps under the same apex domain (recommended), e.g.:
https://app.yourdomain.com
https://admin.yourdomain.com
Set cookie Domain to .yourdomain.com so both apps share the session.
If using different domains, each app still redirects to the Hosted UI; Cognito session prevents re-prompting for credentials.
8) Local development
Add these callback/logout URIs in Cognito:
Callback: http://localhost:5001/auth/callback
Logout: http://localhost:3000/
Start backend on 5001 and frontend on 3000
Visit http://localhost:3000 → Login → redirects → returns with cookies.
9) Optional: external IdPs
In Cognito → Federation:
Add Google/Microsoft (OAuth) or SAML IdPs
Map email, name attributes
Add their scopes to the Hosted UI
Users can now sign in with corporate or social providers and still get the same BRMH session.
10) Troubleshooting checklist
400 invalid_redirect_uri: Ensure exact URL matches in Cognito
Cookies missing: Must be HTTPS; use SameSite=None; set Domain=.yourdomain.com
401 invalid token: Check issuer/audience, JWKS URL, server clock, algorithm RS256
CORS: Add frontend origins in backend CORS configuration
Mixed content: Use HTTPS everywhere in production
Verification flow
Go to your app → click Login → Cognito login page → after login, redirected to /auth/callback → cookies set → /auth/me returns user → navigate to a protected route and confirm access.
Where to read more in your repo
See brmh-backend/BRMH_SSO.md for the same plan and best practices.
Update brmh-backend/index.js to wire the four auth routes and JWT middleware (as described above).
The old brmh-backend/utils/brmh-auth.js uses direct SRP password auth; for SSO prefer the Hosted UI flow.
If you want, I can add the four auth routes and JWT middleware to index.js for you now.

---

## Integrate BRMH SSO into another app

You have two easy ways to plug another app into the same Cognito-based SSO used here.

### 0) Prerequisites (one-time per app)
- Add the new app’s callback URL and logout URL to the Cognito App Client:
  - Callback URL(s): e.g., `http://localhost:4000/authPage` or `https://yourapp.yourdomain.com/authPage`
  - Sign-out URL(s): e.g., `http://localhost:4000/authPage` or `https://yourapp.yourdomain.com/`
- Ensure the app client has scopes `openid profile email` and flow `Authorization code grant`.

### Option A — Reuse the existing BRMH Auth Service (recommended)
Point your new app’s frontend to the existing backend (`brmh-backend`) which already exposes OAuth endpoints.

Backend must allow the new app’s origin (CORS). Then, in the new app:

1) Configure the base URL
   - `NEXT_PUBLIC_BACKEND_URL=https://<your-brmh-backend-host>:5001` (or `http://localhost:5001` for dev)

2) Login button flow
   - Call: `GET ${BACKEND}/auth/oauth-url` → it returns `{ authUrl, state }`
   - Save `state` in `sessionStorage` and redirect the browser to `authUrl`

3) Callback handler (on your app page e.g., `/authPage`)
   - Read `code` and `state` from the URL
   - Validate `state` equals the saved one (if you store it)
   - Exchange tokens: `POST ${BACKEND}/auth/token` with JSON `{ code, state }`
   - Response contains `{ id_token, access_token, refresh_token, expires_in }`
   - Store tokens (localStorage or secure HttpOnly cookies; cookies are recommended for production)

4) Validate and refresh
   - Validate: `POST ${BACKEND}/auth/validate` with `Authorization: Bearer <access_token>`
   - Refresh: `POST ${BACKEND}/auth/refresh` with JSON `{ refresh_token }`

5) Logout (clears Cognito cookies + local tokens)
   - Revoke token: `POST ${BACKEND}/auth/logout` with `{ refresh_token }`
   - Then get Hosted UI logout URL: `GET ${BACKEND}/auth/logout-url` → `{ logoutUrl }` and redirect the browser to it

That’s it. As long as all apps use the same Cognito User Pool/App Client, users will have a single sign‑on experience. If you use cookies with `Domain=.yourdomain.com`, authenticated sessions can be shared across apps under the same apex domain.

### Option B — Embed the SSO endpoints inside the new app
If the new app has its own backend and you prefer to keep all traffic local to it:

1) Copy the server logic:
   - Reuse `brmh-backend/utils/brmh-auth.js` or mirror its endpoints in your framework
   - Wire routes equivalent to these:
     - `GET /auth/oauth-url` (generate PKCE + authorization URL)
     - `POST /auth/token` (exchange code for tokens)
     - `POST /auth/refresh` (refresh tokens)
     - `POST /auth/validate` (validate JWT using JWKS)
     - `POST /auth/logout` (revoke refresh token)
     - `GET /auth/logout-url` (return Hosted UI logout URL)

2) Set environment variables in the new backend
```
AWS_COGNITO_REGION=us-east-1
AWS_COGNITO_USER_POOL_ID=us-east-1_XXXXXXX
AWS_COGNITO_CLIENT_ID=XXXXXXXXXXXXXXX
AWS_COGNITO_DOMAIN=https://<your-domain>.auth.us-east-1.amazoncognito.com
AUTH_REDIRECT_URI=https://yourapp.yourdomain.com/authPage   # or http://localhost:4000/authPage
```

3) Frontend code is the same as Option A (just point to your new backend base URL)

### Authentication Options

#### Option 1: Direct Login/Signup (Username/Password)
For traditional username/password authentication:

```ts
const API_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5001';

// Login
async function handleLogin(username: string, password: string) {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  
  const data = await response.json();
  if (data.success) {
    // Store tokens
    localStorage.setItem('id_token', data.result.idToken.jwtToken);
    localStorage.setItem('access_token', data.result.accessToken.jwtToken);
    localStorage.setItem('refresh_token', data.result.refreshToken.token);
    return { success: true };
  } else {
    return { success: false, error: data.error };
  }
}

// Signup
async function handleSignup(username: string, password: string, email: string) {
  const response = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, email })
  });
  
  const data = await response.json();
  if (data.success) {
    return { success: true, message: 'Account created! Please check your email for verification.' };
  } else {
    return { success: false, error: data.error };
  }
}
```

#### Option 2: OAuth Login (Hosted UI)
For OAuth flow with Cognito Hosted UI:

```ts
const API_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5001';

async function handleOAuthLogin() {
  const r = await fetch(`${API_BASE_URL}/auth/oauth-url`);
  const { authUrl, state } = await r.json();
  sessionStorage.setItem('oauth_state', state);
  window.location.href = authUrl; // redirect to Cognito Hosted UI
}
```

#### Option 3: Phone Number Authentication (SMS OTP)
For phone number authentication with SMS OTP:

```ts
const API_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5001';

// Phone signup
async function handlePhoneSignup(phoneNumber: string, password: string, email?: string) {
  const response = await fetch(`${API_BASE_URL}/auth/phone/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber, password, email })
  });
  
  const data = await response.json();
  if (data.success) {
    return { success: true, message: 'Account created! Please check your phone for verification code.' };
  } else {
    return { success: false, error: data.error };
  }
}

// Phone login
async function handlePhoneLogin(phoneNumber: string, password: string) {
  const response = await fetch(`${API_BASE_URL}/auth/phone/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber, password })
  });
  
  const data = await response.json();
  if (data.success) {
    // Store tokens
    localStorage.setItem('id_token', data.result.idToken.jwtToken);
    localStorage.setItem('access_token', data.result.accessToken.jwtToken);
    localStorage.setItem('refresh_token', data.result.refreshToken.token);
    return { success: true };
  } else {
    return { success: false, error: data.error };
  }
}

// Verify OTP
async function handleOtpVerification(phoneNumber: string, code: string) {
  const response = await fetch(`${API_BASE_URL}/auth/phone/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber, code })
  });
  
  const data = await response.json();
  if (data.success) {
    return { success: true, message: 'Phone number verified successfully!' };
  } else {
    return { success: false, error: data.error };
  }
}

// Resend OTP
async function handleResendOtp(phoneNumber: string) {
  const response = await fetch(`${API_BASE_URL}/auth/phone/resend-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber })
  });
  
  const data = await response.json();
  if (data.success) {
    return { success: true, message: 'OTP resent successfully!' };
  } else {
    return { success: false, error: data.error };
  }
}
```

Callback (e.g., `/authPage`):
```ts
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  if (!code) return;

  const saved = sessionStorage.getItem('oauth_state');
  // optional strict check: if (saved && state !== saved) { /* show error */ return; }

  fetch(`${API_BASE_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, state: state || saved })
  })
  .then(res => res.json())
  .then(tokens => {
    localStorage.setItem('access_token', tokens.access_token);
    localStorage.setItem('id_token', tokens.id_token);
    localStorage.setItem('refresh_token', tokens.refresh_token);
    localStorage.setItem('token_expires', (Date.now() + tokens.expires_in * 1000).toString());
    sessionStorage.removeItem('oauth_state');
    window.history.replaceState({}, document.title, window.location.pathname);
    // navigate to your app home
  });
}, []);
```

Logout:
```ts
async function handleLogout() {
  const refreshToken = localStorage.getItem('refresh_token');
  if (refreshToken) {
    await fetch(`${API_BASE_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
  }
  const u = await fetch(`${API_BASE_URL}/auth/logout-url`).then(r => r.json());
  localStorage.clear();
  window.location.href = u.logoutUrl; // clears Hosted UI cookies
}
```

### Cross‑app SSO behavior
- Same apex domain with cookies (recommended): set cookies with `Domain=.yourdomain.com` and apps share the session
- Different domains: users will still be SSO’ed because the Cognito Hosted UI session persists; each app redirects to Cognito but usually won’t prompt for credentials again

### Common pitfalls & how to avoid them
- 400 “Invalid challenge transition” on the Hosted UI:
  - Always start the flow by calling your backend `GET /auth/oauth-url` (don’t craft the authorize URL manually)
  - Use the Hosted UI logout to clear cookies before a new test: `GET /auth/logout-url` and open it
  - Don’t restart the backend between generating the URL and exchanging the code (PKCE state is in memory). For multi‑instance deployments, store PKCE state in Redis/Valkey.
- `Invalid or expired state` on callback:
  - Ensure your callback handler sends the same `state` that was generated, or use the saved state as a fallback when Cognito redirects through intermediate pages (e.g., password change)
- `invalid_redirect_uri`:
  - Callback/logout URIs in Cognito must match EXACTLY (scheme, host, port, path)

### Security notes
- Prefer HttpOnly Secure cookies for tokens in production (avoid localStorage for ID/access tokens)
- Validate tokens on the backend using JWKS (issuer and audience checks)
- Use HTTPS everywhere; set CORS allowlist explicitly for your apps

With these steps, you can add BRMH SSO to any app (Next.js, React, SPA, or server‑rendered) in minutes while keeping Cognito as the central identity provider.