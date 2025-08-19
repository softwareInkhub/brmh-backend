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
- `GET /auth/login` – generate PKCE challenge, redirect to Cognito authorize URL
- `GET /auth/callback` – exchange code for tokens, set secure HttpOnly cookies, redirect to app
- `GET /auth/me` – verify ID token (cookie or Authorization header) and return user claims
- `POST /auth/logout` – clear cookies and redirect to Cognito logout

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