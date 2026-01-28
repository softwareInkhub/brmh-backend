// AWS Amplify Auth setup
import { CognitoUserPool, CognitoUser, AuthenticationDetails, CognitoUserAttribute } from 'amazon-cognito-identity-js';
import { CognitoIdentityProviderClient, InitiateAuthCommand, AdminInitiateAuthCommand, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import crypto from 'crypto';
import jwksClient from 'jwks-rsa';
import jwt from 'jsonwebtoken';
import { PutCommand, GetCommand, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from '../lib/dynamodb-client.js';

// PKCE utility functions
const base64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function createPkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier, 'utf8').digest());
  return { verifier, challenge };
}

// In-memory storage for PKCE verifiers (use Redis in production)
const pkceStore = new Map();

// Clean up expired PKCE entries (older than 10 minutes)
setInterval(() => {
  const now = Date.now();
  let cleanedCount = 0;
  for (const [state, data] of pkceStore.entries()) {
    if (now - data.timestamp > 10 * 60 * 1000) {
      pkceStore.delete(state);
      cleanedCount++;
    }
  }
  if (cleanedCount > 0) {
    console.log(`?? Cleaned up ${cleanedCount} expired PKCE entries`);
  }
}, 5 * 60 * 1000); // Clean every 5 minutes

// OAuth URL generation handler
async function generateOAuthUrlHandler(req, res) {
  try {
    if (!process.env.AWS_COGNITO_DOMAIN || !process.env.AWS_COGNITO_CLIENT_ID || !process.env.AUTH_REDIRECT_URI) {
      return res.status(500).json({ 
        error: 'OAuth configuration missing. Please set AWS_COGNITO_DOMAIN, AWS_COGNITO_CLIENT_ID, and AUTH_REDIRECT_URI environment variables.' 
      });
    }

    const { challenge, verifier } = createPkce();
    const state = crypto.randomBytes(16).toString('hex');
    
    // Get provider from query parameter (e.g., 'Google', 'Facebook', etc.)
    // Normalize provider name to match Cognito's expected format (capitalize first letter)
    let provider = req.query.provider;
    if (provider) {
      provider = provider.charAt(0).toUpperCase() + provider.slice(1).toLowerCase();
    }
    
    console.log('?? Generating OAuth URL with PKCE:');
    console.log('  - Challenge:', challenge);
    console.log('  - Verifier:', verifier);
    console.log('  - State:', state);
    console.log('  - Provider:', provider || 'default');
    
    const authUrl = new URL('/oauth2/authorize', process.env.AWS_COGNITO_DOMAIN);
    authUrl.searchParams.set('client_id', process.env.AWS_COGNITO_CLIENT_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid profile email');
    authUrl.searchParams.set('redirect_uri', process.env.AUTH_REDIRECT_URI);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('state', state);
    
    // If provider is specified, add identity_provider parameter
    // This tells Cognito to use the specified social identity provider
    if (provider) {
      authUrl.searchParams.set('identity_provider', provider);
    } else {
      // Force showing the login screen to avoid the "continue as" page
      authUrl.searchParams.set('prompt', 'login');
    }
    
    // Store verifier with state
    pkceStore.set(state, { verifier, timestamp: Date.now() });
    
    console.log('?? Generated OAuth URL:', authUrl.toString());
    console.log('?? Stored PKCE data for state:', state);
    
    res.json({ 
      authUrl: authUrl.toString(),
      state
    });
  } catch (error) {
    console.error('Error generating OAuth URL:', error);
    res.status(500).json({ error: 'Failed to generate OAuth URL' });
  }
}

// Token exchange handler
async function exchangeTokenHandler(req, res) {
  try {
    const { code, state } = req.body;
    
    console.log('?? Token exchange request:');
    console.log('  - Code:', code ? `${code.substring(0, 10)}...` : 'missing');
    console.log('  - State:', state);
    console.log('  - Available PKCE states:', Array.from(pkceStore.keys()));
    
    if (!code || !state) {
      return res.status(400).json({ error: 'Missing code or state parameter' });
    }
    
    // Retrieve and validate PKCE verifier
    let pkceData = pkceStore.get(state);
    if (!pkceData) {
      // For password change flow, we might not have the original state
      // Try to find any valid PKCE data (less secure but handles password change)
      if (state === 'password-change-flow') {
        // Find any valid PKCE entry (use the first one found)
        const validEntries = Array.from(pkceStore.entries());
        if (validEntries.length > 0) {
          const [validState, validPkceData] = validEntries[0];
          console.log(`Using fallback PKCE data for password change flow: ${validState}`);
          pkceData = validPkceData;
          // Clean up the fallback entry
          pkceStore.delete(validState);
        } else {
          return res.status(400).json({ error: 'No valid PKCE session found for password change flow' });
        }
      } else {
        console.error('? PKCE data not found for state:', state);
        console.error('Available states:', Array.from(pkceStore.keys()));
        return res.status(400).json({ error: 'Invalid or expired state parameter' });
      }
    }
    
    const { verifier } = pkceData;
    console.log('?? Using PKCE verifier:', verifier ? `${verifier.substring(0, 10)}...` : 'missing');
    
    // Exchange code for tokens
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.AWS_COGNITO_CLIENT_ID,
      code,
      redirect_uri: process.env.AUTH_REDIRECT_URI,
      code_verifier: verifier
    });
    
    console.log('?? Token exchange request body:', body.toString());
    console.log('?? Token exchange URL:', `${process.env.AWS_COGNITO_DOMAIN}/oauth2/token`);
    
    const tokenRes = await fetch(`${process.env.AWS_COGNITO_DOMAIN}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    
    if (!tokenRes.ok) {
      const errorData = await tokenRes.text();
      console.error('Token exchange failed:', errorData);
      return res.status(400).json({ error: 'Token exchange failed', details: errorData });
    }
    
    const tokens = await tokenRes.json();

    // Clean up PKCE data
    pkceStore.delete(state);

    // Decode the ID token to get user info and create/update user record
    try {
      if (tokens.id_token) {
        const decoded = jwt.decode(tokens.id_token);
        
        if (decoded && decoded.sub) {
          // Extract domain from origin header
          const origin = req.headers.origin || req.headers.referer;
          const loginDomain = extractDomainFromOrigin(origin);
          
          console.log('[Auth] OAuth login from domain:', loginDomain);
          
          // Check if user exists
          let userRecord = await getUserRecord(decoded.sub);
          
          if (!userRecord) {
            // Create new user record for OAuth sign-in
            console.log('[Auth] Creating user record for OAuth sign-in:', decoded.email);
            
            const userData = {
              sub: decoded.sub,
              username: decoded.name || decoded.email || decoded['cognito:username'],
              email: decoded.email,
              cognitoUsername: decoded['cognito:username'],
              signupMethod: 'oauth',
              verified: decoded.email_verified || true,
              // Add OAuth provider info if available
              oauthProvider: decoded.identities ? JSON.parse(decoded.identities)[0]?.providerName : 'unknown'
            };
            
            await createUserRecord(userData, loginDomain);
          } else {
            // Update last login for existing user with domain tracking
            await updateUserLoginWithDomain(decoded.sub, loginDomain);
          }
        }
      }
    } catch (userRecordError) {
      // Don't fail the login if user record creation fails
      console.error('[Auth] Error managing user record for OAuth:', userRecordError);
    }

    // Set cross-subdomain cookies for SSO
    try {
      const cookieDomain = process.env.COOKIE_DOMAIN || '.brmh.in';
      const isProd = process.env.NODE_ENV === 'production';
      
      // For cross-subdomain cookies in production, we need secure: true and sameSite: 'none'
      const secure = true; // Always true for HTTPS domains
      const sameSite = isProd ? 'none' : 'lax';
      
      const setOpts = (seconds) => ({
        httpOnly: true,
        secure,
        sameSite,
        domain: cookieDomain,
        path: '/',
        maxAge: seconds * 1000
      });
      
      const ttl = tokens.expires_in || 3600;
      console.log('[Auth] Token exchange - setting cookies with options:', { domain: cookieDomain, secure, sameSite });
      
      if (tokens.id_token) res.cookie('id_token', tokens.id_token, setOpts(ttl));
      if (tokens.access_token) res.cookie('access_token', tokens.access_token, setOpts(ttl));
      if (tokens.refresh_token) res.cookie('refresh_token', tokens.refresh_token, setOpts(60 * 60 * 24 * 30));
    } catch (cookieErr) {
      console.error('[Auth] Failed setting token exchange cookies:', cookieErr);
    }

    return res.status(200).json({
      success: true,
      result: {
        idToken: tokens.id_token ? { jwtToken: tokens.id_token } : undefined,
        accessToken: tokens.access_token ? { jwtToken: tokens.access_token } : undefined,
        refreshToken: tokens.refresh_token ? { token: tokens.refresh_token } : undefined,
      }
    });
  } catch (error) {
    console.error('Error exchanging token:', error);
    res.status(500).json({ error: 'Failed to exchange token' });
  }
}

// Refresh token handler
async function refreshTokenHandler(req, res) {
  try {
    const { refresh_token } = req.body;
    
    if (!refresh_token) {
      return res.status(400).json({ error: 'Missing refresh token' });
    }
    
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.AWS_COGNITO_CLIENT_ID,
      refresh_token
    });
    
    const tokenRes = await fetch(`${process.env.AWS_COGNITO_DOMAIN}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    
    if (!tokenRes.ok) {
      const errorData = await tokenRes.text();
      console.error('Token refresh failed:', errorData);
      return res.status(400).json({ error: 'Token refresh failed', details: errorData });
    }
    
    const tokens = await tokenRes.json();

    // Also update cookies when refreshing
    try {
      const cookieDomain = process.env.COOKIE_DOMAIN || '.brmh.in';
      const isProd = process.env.NODE_ENV === 'production';
      
      // For cross-subdomain cookies in production, we need secure: true and sameSite: 'none'
      const secure = true; // Always true for HTTPS domains
      const sameSite = isProd ? 'none' : 'lax';
      
      const setOpts = (seconds) => ({
        httpOnly: true,
        secure,
        sameSite,
        domain: cookieDomain,
        path: '/',
        maxAge: seconds * 1000
      });
      
      const ttl = tokens.expires_in || 3600;
      if (tokens.id_token) res.cookie('id_token', tokens.id_token, setOpts(ttl));
      if (tokens.access_token) res.cookie('access_token', tokens.access_token, setOpts(ttl));
      if (tokens.refresh_token) res.cookie('refresh_token', tokens.refresh_token, setOpts(60 * 60 * 24 * 30));
    } catch (cookieErr) {
      console.error('[Auth] Failed setting refresh cookies:', cookieErr);
    }

    return res.status(200).json({
      success: true,
      result: {
        idToken: tokens.id_token ? { jwtToken: tokens.id_token } : undefined,
        accessToken: tokens.access_token ? { jwtToken: tokens.access_token } : undefined,
        refreshToken: tokens.refresh_token ? { token: tokens.refresh_token } : undefined,
      }
    });
  } catch (error) {
    console.error('Error refreshing token:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
}

// JWT validation utility
let jwks = null;
let getKey = null;

function initializeJwks() {
  if (!process.env.AWS_COGNITO_REGION || !process.env.AWS_COGNITO_USER_POOL_ID) {
    console.warn('JWKS not initialized: missing AWS_COGNITO_REGION or AWS_COGNITO_USER_POOL_ID');
    return;
  }
  
  jwks = jwksClient({ 
    jwksUri: `https://cognito-idp.${process.env.AWS_COGNITO_REGION}.amazonaws.com/${process.env.AWS_COGNITO_USER_POOL_ID}/.well-known/jwks.json` 
  });
  
  getKey = (header, cb) => {
    jwks.getSigningKey(header.kid, (err, key) => cb(err, key.getPublicKey()));
  };
}

// Initialize JWKS on module load
initializeJwks();

// User management functions for DynamoDB
const USERS_TABLE = process.env.USERS_TABLE || 'users';

// Helper function to extract domain from origin header
function extractDomainFromOrigin(origin) {
  if (!origin) return 'unknown';
  try {
    const url = new URL(origin);
    return url.hostname; // e.g., "drive.brmh.in", "admin.brmh.in"
  } catch (error) {
    return origin; // Return as-is if URL parsing fails
  }
}

// Helper function to extract namespace/subdomain from domain
function extractNamespaceFromDomain(domain) {
  if (!domain || domain === 'unknown') return null;
  
  // Extract subdomain from domain like "drive.brmh.in" -> "drive"
  // or "admin.brmh.in" -> "admin"
  const parts = domain.split('.');
  
  // If it's already a subdomain name (no dots), return it
  if (parts.length === 1) return parts[0];
  
  // If it's brmh.in, return null (main domain)
  if (parts.length === 2 && parts[0] === 'brmh') return null;
  
  // If it's subdomain.brmh.in, return subdomain
  if (parts.length >= 3 && parts[parts.length - 2] === 'brmh') {
    return parts[0];
  }
  
  // For localhost or other patterns, return the first part
  return parts[0];
}

// Create user record in DynamoDB
async function createUserRecord(userData, loginDomain = null) {
  try {
    const now = new Date().toISOString();
    const namespace = extractNamespaceFromDomain(loginDomain);
    
    const userRecord = {
      userId: userData.sub || userData.username,
      username: userData.username,
      email: userData.email,
      phoneNumber: userData.phoneNumber,
      cognitoUsername: userData.cognitoUsername,
      createdAt: now,
      updatedAt: now,
      status: 'active',
      // Add any additional metadata
      metadata: {
        signupMethod: userData.signupMethod || 'email',
        verified: userData.verified || false,
        lastLogin: null,
        loginCount: 0,
        // Track domains/subdomains user has accessed
        accessedDomains: loginDomain ? [loginDomain] : [],
        accessedNamespaces: namespace ? [namespace] : [],
        lastAccessedDomain: loginDomain || null,
        lastAccessedNamespace: namespace || null,
        domainAccessHistory: loginDomain ? [{
          domain: loginDomain,
          namespace: namespace,
          firstAccess: now,
          lastAccess: now,
          accessCount: 1
        }] : []
      },
      // Namespace-specific roles and permissions
      namespaceRoles: namespace ? {
        [namespace]: {
          role: 'viewer', // Default role
          permissions: ['read:all'], // Default permissions
          assignedAt: now,
          assignedBy: 'system'
        }
      } : {}
    };

    console.log('[Auth] Creating user record in DynamoDB:', {
      userId: userRecord.userId,
      username: userRecord.username,
      email: userRecord.email
    });

    const command = new PutCommand({
      TableName: USERS_TABLE,
      Item: userRecord
    });

    await docClient.send(command);
    console.log('[Auth] User record created successfully in DynamoDB');
    return userRecord;
  } catch (error) {
    console.error('[Auth] Error creating user record in DynamoDB:', error);
    throw error;
  }
}

// Get user record from DynamoDB
async function getUserRecord(userId) {
  try {
    const command = new GetCommand({
      TableName: USERS_TABLE,
      Key: { userId }
    });

    const response = await docClient.send(command);
    return response.Item;
  } catch (error) {
    console.error('[Auth] Error getting user record from DynamoDB:', error);
    throw error;
  }
}

// Update user record in DynamoDB
async function updateUserRecord(userId, updates) {
  try {
    const updateExpression = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    Object.keys(updates).forEach((key, index) => {
      const attrName = `#attr${index}`;
      const attrValue = `:val${index}`;
      
      updateExpression.push(`${attrName} = ${attrValue}`);
      expressionAttributeNames[attrName] = key;
      expressionAttributeValues[attrValue] = updates[key];
    });

    // Always update the updatedAt timestamp
    updateExpression.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = new Date().toISOString();

    const command = new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { userId },
      UpdateExpression: `SET ${updateExpression.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    });

    const response = await docClient.send(command);
    console.log('[Auth] User record updated successfully in DynamoDB');
    return response.Attributes;
  } catch (error) {
    console.error('[Auth] Error updating user record in DynamoDB:', error);
    throw error;
  }
}

// Update user login with domain tracking and namespace
async function updateUserLoginWithDomain(userId, loginDomain) {
  try {
    const now = new Date().toISOString();
    
    // Get current user record to check existing domain history
    const userRecord = await getUserRecord(userId);
    
    if (!userRecord) {
      console.warn('[Auth] User record not found for domain tracking:', userId);
      return null;
    }

    const namespace = extractNamespaceFromDomain(loginDomain);

    // Initialize metadata if it doesn't exist
    const metadata = userRecord.metadata || {};
    const accessedDomains = metadata.accessedDomains || [];
    const accessedNamespaces = metadata.accessedNamespaces || [];
    const domainAccessHistory = metadata.domainAccessHistory || [];
    const loginCount = (metadata.loginCount || 0) + 1;

    // Add domain to accessed domains list if not already there
    if (loginDomain && !accessedDomains.includes(loginDomain)) {
      accessedDomains.push(loginDomain);
    }

    // Add namespace to accessed namespaces list if not already there
    if (namespace && !accessedNamespaces.includes(namespace)) {
      accessedNamespaces.push(namespace);
    }

    // Update domain access history
    const existingDomainIndex = domainAccessHistory.findIndex(d => d.domain === loginDomain);
    if (existingDomainIndex >= 0) {
      // Update existing domain entry
      domainAccessHistory[existingDomainIndex].lastAccess = now;
      domainAccessHistory[existingDomainIndex].accessCount += 1;
    } else if (loginDomain) {
      // Add new domain entry
      domainAccessHistory.push({
        domain: loginDomain,
        namespace: namespace,
        firstAccess: now,
        lastAccess: now,
        accessCount: 1
      });
    }

    // Initialize namespace roles if accessing a new namespace
    const namespaceRoles = userRecord.namespaceRoles || {};
    if (namespace && !namespaceRoles[namespace]) {
      namespaceRoles[namespace] = {
        role: 'viewer', // Default role for new namespace
        permissions: ['read:all'], // Default permissions
        assignedAt: now,
        assignedBy: 'system'
      };
    }

    // Update the user record
    const updates = {
      'metadata.lastLogin': now,
      'metadata.loginCount': loginCount,
      'metadata.accessedDomains': accessedDomains,
      'metadata.accessedNamespaces': accessedNamespaces,
      'metadata.lastAccessedDomain': loginDomain || metadata.lastAccessedDomain,
      'metadata.lastAccessedNamespace': namespace || metadata.lastAccessedNamespace,
      'metadata.domainAccessHistory': domainAccessHistory,
      'namespaceRoles': namespaceRoles
    };

    return await updateUserRecord(userId, updates);
  } catch (error) {
    console.error('[Auth] Error updating user login with domain:', error);
    throw error;
  }
}

// Delete user record from DynamoDB
async function deleteUserRecord(userId) {
  try {
    const command = new DeleteCommand({
      TableName: USERS_TABLE,
      Key: { userId }
    });

    await docClient.send(command);
    console.log('[Auth] User record deleted successfully from DynamoDB');
  } catch (error) {
    console.error('[Auth] Error deleting user record from DynamoDB:', error);
    throw error;
  }
}

// JWT validation middleware
function validateJwtToken(token) {
  return new Promise((resolve, reject) => {
    if (!getKey) {
      return reject(new Error('JWKS not initialized'));
    }
    
    // First, try to decode to determine token type
    const decoded = jwt.decode(token, { complete: true });
    const tokenUse = decoded?.payload?.token_use;
    
    // For access tokens, don't validate audience (Cognito access tokens don't have client_id as audience)
    // For ID tokens, validate audience
    const verifyOptions = {
      algorithms: ['RS256'],
      issuer: `https://cognito-idp.${process.env.AWS_COGNITO_REGION}.amazonaws.com/${process.env.AWS_COGNITO_USER_POOL_ID}`
    };
    
    // Only add audience check for ID tokens
    if (tokenUse === 'id') {
      verifyOptions.audience = process.env.AWS_COGNITO_CLIENT_ID;
    }
    
    jwt.verify(token, getKey, verifyOptions, (err, decoded) => {
      if (err) {
        reject(err);
      } else {
        resolve(decoded);
      }
    });
  });
}

// Validate token handler
async function validateTokenHandler(req, res) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const decoded = await validateJwtToken(token);
    res.json({ 
      valid: true, 
      user: decoded,
      claims: {
        sub: decoded.sub,
        email: decoded.email,
        name: decoded.name,
        username: decoded['cognito:username']
      }
    });
  } catch (error) {
    console.error('Token validation failed:', error);
    res.status(401).json({ error: 'Invalid token', details: error.message });
  }
}

// Setup user pool only if environment variables are present
let userPool = null;
if (process.env.AWS_COGNITO_USER_POOL_ID && process.env.AWS_COGNITO_CLIENT_ID) {
  const poolData = {
    UserPoolId: process.env.AWS_COGNITO_USER_POOL_ID,
    ClientId: process.env.AWS_COGNITO_CLIENT_ID,
  };
  userPool = new CognitoUserPool(poolData);
} else {
  console.warn('AWS Cognito configuration missing. Auth endpoints will return errors.');
}

// Signup handler
async function signupHandler(req, res) {
  if (!userPool) {
    return res.status(500).json({ 
      success: false, 
      error: 'Authentication service not configured. Please set AWS_COGNITO_USER_POOL_ID and AWS_COGNITO_CLIENT_ID environment variables.' 
    });
  }
  
  const { username, password, email, phone_number } = req.body;

  // Accept either email or phone_number field
  const emailOrPhone = email || phone_number;

  // Enforce required fields and Cognito-safe username
  if (!emailOrPhone || !password) {
    return res.status(400).json({ success: false, error: 'Missing required fields: email or phone_number, and password' });
  }
  
  // Detect if the field contains a phone number (E.164 format: +countrycodephonenumber)
  const isPhoneNumber = /^\+\d{10,15}$/.test(emailOrPhone);
  const displayName = (username || '').toString().trim();
  const sanitized = displayName ? displayName.replace(/\s+/g, '_') : '';
  
  console.log('[Auth] Signup request:', {
    isPhoneNumber,
    emailOrPhone: emailOrPhone ? `${emailOrPhone.substring(0, 5)}...` : 'none',
    hasUsername: !!displayName
  });
  
  // Generate Cognito username
  let cognitoUsername = sanitized;
  if (!cognitoUsername) {
    if (isPhoneNumber) {
      // For phone numbers, use last 10 digits as base for username
      const phoneDigits = emailOrPhone.replace(/\D/g, '');
      cognitoUsername = `user_${phoneDigits.slice(-10)}_${Date.now()}`;
    } else {
      // For emails, use local part
      const local = String(emailOrPhone).split('@')[0].replace(/[^\p{L}\p{M}\p{S}\p{N}\p{P}]/gu, '_');
      cognitoUsername = `${local}_${Date.now()}`;
    }
  }

  // Set the appropriate attributes based on whether it's phone or email
  // Note: Cognito User Pool requires email, so for phone signups we provide a placeholder email
  const userAttributes = [];
  
  if (isPhoneNumber) {
    // For phone number signup, provide both phone and a placeholder email
    userAttributes.push({ Name: 'phone_number', Value: emailOrPhone });
    // Create a placeholder email using the phone number
    const phoneDigits = emailOrPhone.replace(/\D/g, '');
    const placeholderEmail = `${phoneDigits}@phone.brmh.in`;
    userAttributes.push({ Name: 'email', Value: placeholderEmail });
    console.log('[Auth] Phone signup - using placeholder email:', placeholderEmail);
  } else {
    // For email signup, just use the email
    userAttributes.push({ Name: 'email', Value: emailOrPhone });
    console.log('[Auth] Email signup - using email:', emailOrPhone);
  }

  userPool.signUp(cognitoUsername, password, userAttributes, null, async (err, result) => {
    if (err) {
      console.error('[Auth] Signup error:', err);
      // If the derived username still conflicts, generate a new one and retry once
      const msg = (err && err.message) ? String(err.message) : '';
      const needsRetry = /alias|username.*exists|invalid.*username|email format/i.test(msg);
      if (!needsRetry) {
        return res.status(400).json({ success: false, error: err.message });
      }
      const fallbackUsername = `${cognitoUsername}_u${Math.floor(Math.random()*1e6)}`;
      try {
        // Recreate user attributes for fallback signup (in case they need to be regenerated)
        const fallbackUserAttributes = [];
        if (isPhoneNumber) {
          fallbackUserAttributes.push({ Name: 'phone_number', Value: emailOrPhone });
          const phoneDigits = emailOrPhone.replace(/\D/g, '');
          const placeholderEmail = `${phoneDigits}@phone.brmh.in`;
          fallbackUserAttributes.push({ Name: 'email', Value: placeholderEmail });
        } else {
          fallbackUserAttributes.push({ Name: 'email', Value: emailOrPhone });
        }
        
        userPool.signUp(fallbackUsername, password, fallbackUserAttributes, null, async (fallbackErr, fallbackResult) => {
          if (fallbackErr) {
            console.error('[Auth] Signup fallback error:', fallbackErr);
            return res.status(400).json({ success: false, error: fallbackErr.message });
          }
          try {
            // Prepare user data for DynamoDB
            const phoneDigits = isPhoneNumber ? emailOrPhone.replace(/\D/g, '') : null;
            const placeholderEmail = isPhoneNumber ? `${phoneDigits}@phone.brmh.in` : null;
            
            const userData = {
              sub: fallbackResult.userSub,
              username: displayName || fallbackUsername,
              email: isPhoneNumber ? placeholderEmail : emailOrPhone,
              phoneNumber: isPhoneNumber ? emailOrPhone : null,
              cognitoUsername: fallbackUsername,
              signupMethod: isPhoneNumber ? 'phone' : 'email',
              verified: false
            };
            await createUserRecord(userData);
          } catch (dbError) {
            console.error('[Auth] Error creating user record in DynamoDB:', dbError);
          }
          const successMessage = isPhoneNumber 
            ? 'Account created successfully! Please check your phone for verification code.'
            : 'Account created successfully! Please check your email for verification.';
          return res.status(200).json({
            success: true,
            result: fallbackResult,
            message: successMessage
          });
        });
        return; // prevent double response
      } catch (retryErr) {
        console.error('[Auth] Signup retry exception:', retryErr);
        return res.status(400).json({ success: false, error: msg || 'Signup failed' });
      }
    }
    
    try {
      // Extract domain from origin header
      const origin = req.headers.origin || req.headers.referer;
      const signupDomain = extractDomainFromOrigin(origin);
      
      console.log('[Auth] Signup from domain:', signupDomain);
      
      // Prepare user data for DynamoDB
      const phoneDigits = isPhoneNumber ? emailOrPhone.replace(/\D/g, '') : null;
      const placeholderEmail = isPhoneNumber ? `${phoneDigits}@phone.brmh.in` : null;
      
      // Create user record in DynamoDB
      const userData = {
        sub: result.userSub,
        username: displayName || cognitoUsername,
        email: isPhoneNumber ? placeholderEmail : emailOrPhone,
        phoneNumber: isPhoneNumber ? emailOrPhone : null,
        cognitoUsername: cognitoUsername,
        signupMethod: isPhoneNumber ? 'phone' : 'email',
        verified: false
      };
      
      await createUserRecord(userData, signupDomain);
      
      console.log('[Auth] User signup successful:', {
        username,
        userSub: result.userSub,
        method: isPhoneNumber ? 'phone' : 'email'
      });
      
      const successMessage = isPhoneNumber 
        ? 'Account created successfully! Please check your phone for verification code.'
        : 'Account created successfully! Please check your email for verification.';
      
      res.status(200).json({ 
        success: true, 
        result,
        message: successMessage
      });
    } catch (dbError) {
      console.error('[Auth] Error creating user record in DynamoDB:', dbError);
      // Still return success for Cognito signup, but log the DynamoDB error
      res.status(200).json({ 
        success: true, 
        result,
        warning: 'Account created in Cognito but failed to save metadata',
        message: 'Account created successfully! Please check your email for verification.'
      });
    }
  });
}


async function resolveIdentifierForLogin(identifier, client) {
  if (!identifier || !client) {
    return identifier;
  }
  const trimmed = identifier.trim();
  if (!trimmed) {
    return identifier;
  }
  const userPoolId = process.env.AWS_COGNITO_USER_POOL_ID;
  if (!userPoolId) {
    return identifier;
  }

  const sanitize = (value) => value.replace(/["\\]/g, (char) => `\\${char}`);
  const attemptLookup = async (filter) => {
    const command = new ListUsersCommand({
      UserPoolId: userPoolId,
      Filter: filter,
      Limit: 1
    });
    const response = await client.send(command);
    return response?.Users?.[0]?.Username;
  };

  try {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      const username = await attemptLookup(`email = \"${sanitize(trimmed)}\"`);
      if (username) {
        return username;
      }
    }

    const digitsOnly = trimmed.replace(/[^\d+]/g, '');
    if (/^\+?[1-9]\d{6,}$/.test(digitsOnly)) {
      const normalized = digitsOnly.startsWith('+') ? digitsOnly : `+${digitsOnly.replace(/^\+/, '')}`;
      const username = await attemptLookup(`phone_number = \"${sanitize(normalized)}\"`);
      if (username) {
        return username;
      }
    }
  } catch (err) {
    try {
      console.warn('[Auth] Unable to resolve identifier via Cognito listUsers:', err?.message || err);
    } catch {}
  }

  return identifier;
}
// Login handler
async function loginHandler(req, res) {
  try {
    const { username, password } = req.body;
    // Allow login with email, phone, or username
    let identifier = (username || '').toString().trim();
    
    console.log('[Auth] Login attempt:', { username: identifier, hasPassword: !!password });
    
    if (!identifier || !password) {
      return res.status(400).json({ success: false, error: 'Missing username/email/phone or password' });
    }
    
    // If it looks like a phone, format to E.164
    if (/^\+?[\d\s-]*$/.test(identifier)) {
      const digits = identifier.replace(/\D/g, '');
      identifier = `+${digits}`;
    }

    const client = new CognitoIdentityProviderClient({ 
      region: process.env.AWS_COGNITO_REGION || process.env.AWS_REGION || 'us-east-1' 
    });

    // Try to resolve email/phone to cognito username
    try {
      const resolvedIdentifier = await resolveIdentifierForLogin(identifier, client);
      if (resolvedIdentifier && resolvedIdentifier !== identifier) {
        console.log('[Auth] Resolved login identifier', { input: identifier, resolved: resolvedIdentifier });
        identifier = resolvedIdentifier;
      }
    } catch (resolveError) {
      console.warn('[Auth] Could not resolve identifier, using original:', resolveError.message);
    }

    let tokens = null;
    let lastError = null;

    // 1) Try ADMIN_USER_PASSWORD_AUTH first
    try {
      const adminCmd = new AdminInitiateAuthCommand({
        AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
        UserPoolId: process.env.AWS_COGNITO_USER_POOL_ID,
        ClientId: process.env.AWS_COGNITO_CLIENT_ID,
        AuthParameters: { USERNAME: identifier, PASSWORD: password }
      });
      const adminResp = await client.send(adminCmd);
      if (adminResp?.AuthenticationResult) {
        tokens = {
          IdToken: adminResp.AuthenticationResult.IdToken,
          AccessToken: adminResp.AuthenticationResult.AccessToken,
          RefreshToken: adminResp.AuthenticationResult.RefreshToken,
        };
      } else if (adminResp?.ChallengeName) {
        const challengeError = new Error(`Cognito challenge required: ${adminResp.ChallengeName}`);
        challengeError.name = adminResp.ChallengeName;
        lastError = challengeError;
      }
    } catch (adminErr) {
      lastError = adminErr;
    }

    // 2) Try USER_PASSWORD_AUTH if admin flow did not yield tokens
    if (!tokens) {
      try {
        const cmd = new InitiateAuthCommand({
          AuthFlow: 'USER_PASSWORD_AUTH',
          ClientId: process.env.AWS_COGNITO_CLIENT_ID,
          AuthParameters: { USERNAME: identifier, PASSWORD: password }
        });
        const resp = await client.send(cmd);
        if (resp?.AuthenticationResult) {
          tokens = {
            IdToken: resp.AuthenticationResult.IdToken,
            AccessToken: resp.AuthenticationResult.AccessToken,
            RefreshToken: resp.AuthenticationResult.RefreshToken,
          };
        } else if (resp?.ChallengeName) {
          const challengeError = new Error(`Cognito challenge required: ${resp.ChallengeName}`);
          challengeError.name = resp.ChallengeName;
          lastError = challengeError;
        }
      } catch (clientErr) {
        lastError = clientErr;
      }
    }

    if (!tokens) {
      const fallbackError = lastError || new Error('Login failed');
      if (!lastError) {
        fallbackError.name = 'NoTokensError';
      }
      throw fallbackError;
    }

    const idToken = tokens.IdToken || tokens.idToken;
    const accessToken = tokens.AccessToken || tokens.access_token;
    const refreshToken = tokens.RefreshToken || tokens.refresh_token;

    // Optionally update login activity if we can decode id token (non-blocking)
    try {
      if (idToken) {
        const decoded = await validateJwtToken(idToken);
        const userId = decoded.sub;
        
        // Extract domain from origin header
        const origin = req.headers.origin || req.headers.referer;
        const loginDomain = extractDomainFromOrigin(origin);
        
        console.log('[Auth] Custom login from domain:', loginDomain);
        
        // Update login with domain tracking
        await updateUserLoginWithDomain(userId, loginDomain);
      }
    } catch (dbErr) {
      // Silently fail - don't block login if DynamoDB is unavailable
      console.warn('[Auth] Could not update user login metadata:', dbErr.message);
    }

    // Set cookies with consistent options
    try {
      const cookieDomain = process.env.COOKIE_DOMAIN || '.brmh.in';
      const isProd = process.env.NODE_ENV === 'production';
      
      // For cross-subdomain cookies in production, we need secure: true and sameSite: 'none'
      const secure = true; // Always true for HTTPS domains
      const sameSite = isProd ? 'none' : 'lax';
      
      const setOpts = (seconds) => ({
        httpOnly: true,
        secure,
        sameSite,
        domain: cookieDomain,
        path: '/',
        maxAge: seconds * 1000
      });
      
      const ttl = 3600;
      console.log('[Auth] Setting cookies with options:', { domain: cookieDomain, secure, sameSite });
      
      if (idToken) res.cookie('id_token', idToken, setOpts(ttl));
      if (accessToken) res.cookie('access_token', accessToken, setOpts(ttl));
      if (refreshToken) res.cookie('refresh_token', refreshToken, setOpts(60 * 60 * 24 * 30));
    } catch (cookieError) {
      console.error('[Auth] Error setting cookies:', cookieError);
    }

    return res.status(200).json({
      success: true,
      result: {
        idToken: idToken ? { jwtToken: idToken } : undefined,
        accessToken: accessToken ? { jwtToken: accessToken } : undefined,
        refreshToken: refreshToken ? { token: refreshToken } : undefined,
      }
    });
  } catch (err) {
    console.error('[Auth] Login error:', { 
      message: err?.message, 
      name: err?.name, 
      code: err?.Code,
      stack: err?.stack?.split('\n')[0]
    });
    
    const msg = (err && err.message) ? String(err.message) : 'Login failed';
    const code = err?.name || err?.Code || 'UnknownError';
    
    // Fallback to SRP if USER_PASSWORD_AUTH is not allowed for client or returns NotAuthorized
    if (/InvalidParameterException|UserPasswordAuth.*not.*enabled|NotAuthorizedException/i.test(code + ' ' + msg)) {
      try {
        console.log('[Auth] Attempting SRP fallback authentication');
        const user = new CognitoUser({ Username: identifier, Pool: userPool });
        const authDetails = new AuthenticationDetails({ Username: identifier, Password: password });
        return user.authenticateUser(authDetails, {
          onSuccess: async (result) => {
            try {
              const userRecord = await getUserRecord(result.accessToken.payload.sub);
              if (userRecord) {
                await updateUserRecord(result.accessToken.payload.sub, {
                  'metadata.lastLogin': new Date().toISOString(),
                  'metadata.loginCount': (userRecord.metadata?.loginCount || 0) + 1
                });
              }
            } catch (dbErr) {
              // Silently fail - don't block login if DynamoDB is unavailable
              console.warn('[Auth] Could not update user login metadata (SRP):', dbErr.message);
            }

            try {
              const cookieDomain = process.env.COOKIE_DOMAIN || '.brmh.in';
              const isProd = process.env.NODE_ENV === 'production';
              const secure = isProd;
              const sameSite = isProd ? 'none' : 'lax';
              const setOpts = (seconds) => ({
                httpOnly: true,
                secure,
                sameSite,
                domain: cookieDomain,
                path: '/',
                maxAge: seconds * 1000
              });
              const ttl = 3600;
              const idToken = result?.idToken?.jwtToken;
              const accessToken = result?.accessToken?.jwtToken;
              const refreshToken = result?.refreshToken?.token;
              if (idToken) res.cookie('id_token', idToken, setOpts(ttl));
              if (accessToken) res.cookie('access_token', accessToken, setOpts(ttl));
              if (refreshToken) res.cookie('refresh_token', refreshToken, setOpts(60 * 60 * 24 * 30));
            } catch {}

            return res.status(200).json({
              success: true,
              result: {
                idToken: result?.idToken?.jwtToken ? { jwtToken: result.idToken.jwtToken } : undefined,
                accessToken: result?.accessToken?.jwtToken ? { jwtToken: result.accessToken.jwtToken } : undefined,
                refreshToken: result?.refreshToken?.token ? { token: result.refreshToken.token } : undefined,
              }
            });
          },
          onFailure: (srpErr) => {
            const sMsg = (srpErr && srpErr.message) ? String(srpErr.message) : 'Login failed';
            if (/User is not confirmed/i.test(sMsg)) {
              return res.status(403).json({ success: false, error: 'Account not confirmed. Please verify your email.', requiresConfirmation: true });
            }
            return res.status(401).json({ success: false, error: 'Incorrect username or password' });
          },
        });
      } catch (fallbackEx) {
        console.error('[Auth] SRP fallback error:', fallbackEx);
        return res.status(401).json({ success: false, error: 'Incorrect username or password' });
      }
    }
    
    // Check for specific error cases
    if (/not confirmed/i.test(msg)) {
      return res.status(403).json({ 
        success: false, 
        error: 'Account not confirmed. Please verify your email.', 
        requiresConfirmation: true 
      });
    }
    
    // Generic error response
    return res.status(401).json({ 
      success: false, 
      error: 'Incorrect username or password',
      details: process.env.NODE_ENV !== 'production' ? msg : undefined
    });
  }
}
// Phone number signup handler
async function phoneSignupHandler(req, res) {
  if (!userPool) {
    return res.status(500).json({ 
      success: false, 
      error: 'Authentication service not configured. Please set AWS_COGNITO_USER_POOL_ID and AWS_COGNITO_CLIENT_ID environment variables.' 
    });
  }
  
  const { phoneNumber, password, email } = req.body;
  try {
    console.log('[Auth] Phone signup request', {
      phoneNumber,
      hasPassword: Boolean(password),
      hasEmail: Boolean(email)
    });
  } catch {}
  
  // Format phone number to E.164 format if not already
  const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
  
  const attributeList = [
    new CognitoUserAttribute({ Name: 'phone_number', Value: formattedPhone })
  ];
  
  if (email) {
    attributeList.push(new CognitoUserAttribute({ Name: 'email', Value: email }));
  }
  
  // Try signing up using phone as username (works when pool uses phone as username)
  userPool.signUp(formattedPhone, password, attributeList, null, async (err, result) => {
    if (!err) {
      try { 
        console.log('[Auth] Phone signup success (phone as username)', { username: formattedPhone }); 
        
        // Extract domain from origin header
        const origin = req.headers.origin || req.headers.referer;
        const signupDomain = extractDomainFromOrigin(origin);
        
        // Create user record in DynamoDB
        const userData = {
          sub: result.userSub,
          username: formattedPhone,
          phoneNumber: formattedPhone,
          email: email,
          cognitoUsername: formattedPhone,
          signupMethod: 'phone',
          verified: false
        };
        
        await createUserRecord(userData, signupDomain);
        
      } catch (dbError) {
        console.error('[Auth] Error creating user record in DynamoDB:', dbError);
      }
      
      return res.status(200).json({ 
        success: true, 
        result,
        username: formattedPhone,
        message: 'Account created! Please check your phone for verification code.'
      });
    }

    // If pool is configured with phone number as an alias (not username),
    // Cognito rejects phone-looking usernames. Fallback to a generated username
    // while still attaching the phone_number attribute so phone login works.
    const msg = (err && err.message) ? String(err.message) : '';
    const isAliasRejection = /phone number format|alias/i.test(msg);
    if (!isAliasRejection) {
      console.error('Phone signup error:', err);
      return res.status(400).json({ success: false, error: err.message });
    }

    const digits = formattedPhone.replace(/\D/g, '');
    const generatedUsername = `ph_${digits}_${Date.now()}`;
    try { console.log('[Auth] Phone signup falling back to generated username', { generatedUsername }); } catch {}
    userPool.signUp(generatedUsername, password, attributeList, null, async (fallbackErr, fallbackResult) => {
      if (fallbackErr) {
        console.error('Phone signup fallback error:', fallbackErr);
        return res.status(400).json({ success: false, error: fallbackErr.message });
      }
      
      try { 
        console.log('[Auth] Phone signup success (generated username)'); 
        
        // Create user record in DynamoDB
        const userData = {
          sub: fallbackResult.userSub,
          username: generatedUsername,
          phoneNumber: formattedPhone,
          email: email,
          cognitoUsername: generatedUsername,
          signupMethod: 'phone',
          verified: false
        };
        
        await createUserRecord(userData);
        
      } catch (dbError) {
        console.error('[Auth] Error creating user record in DynamoDB:', dbError);
      }
      
      return res.status(200).json({
        success: true,
        result: fallbackResult,
        username: generatedUsername,
        message: 'Account created! Please check your phone for verification code.',
        note: 'Pool uses phone as alias; a username was generated internally.'
      });
    });
  });
}

// Phone number login handler (with OTP)
async function phoneLoginHandler(req, res) {
  if (!userPool) {
    return res.status(500).json({ 
      success: false, 
      error: 'Authentication service not configured. Please set AWS_COGNITO_USER_POOL_ID and AWS_COGNITO_CLIENT_ID environment variables.' 
    });
  }
  
  const { phoneNumber, password, otp } = req.body;
  try {
    console.log('[Auth] Phone login request', {
      phoneNumber,
      hasPassword: Boolean(password),
      hasOtp: Boolean(otp)
    });
  } catch {}
  
  // Format phone number to E.164 format if not already
  const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
  
  const user = new CognitoUser({ Username: formattedPhone, Pool: userPool });
  const authDetails = new AuthenticationDetails({ Username: formattedPhone, Password: password });
  
  user.authenticateUser(authDetails, {
    onSuccess: async (result) => {
      try { 
        console.log('[Auth] Phone login success'); 
        
        // Extract domain from origin header
        const origin = req.headers.origin || req.headers.referer;
        const loginDomain = extractDomainFromOrigin(origin);
        
        console.log('[Auth] Phone login from domain:', loginDomain);
        
        // Update user record with login activity and domain tracking
        await updateUserLoginWithDomain(result.accessToken.payload.sub, loginDomain);
      } catch (dbError) {
        console.error('[Auth] Error updating user login activity:', dbError);
        // Don't fail the login if DynamoDB update fails
      }

      // Set SSO cookies for custom UI login flow
      try {
        const cookieDomain = process.env.COOKIE_DOMAIN || '.brmh.in';
        const isProd = process.env.NODE_ENV === 'production';
        const secure = isProd;
        const sameSite = isProd ? 'none' : 'lax';
        const setOpts = (seconds) => ({
          httpOnly: true,
          secure,
          sameSite,
          domain: cookieDomain,
          path: '/',
          maxAge: seconds * 1000
        });
        const ttl = 3600;
        const idToken = result?.idToken?.jwtToken;
        const accessToken = result?.accessToken?.jwtToken;
        const refreshToken = result?.refreshToken?.token;
        if (idToken) res.cookie('id_token', idToken, setOpts(ttl));
        if (accessToken) res.cookie('access_token', accessToken, setOpts(ttl));
        if (refreshToken) res.cookie('refresh_token', refreshToken, setOpts(60 * 60 * 24 * 30));
      } catch (cookieErr) {
        console.warn('[Auth] Failed setting phone login cookies:', cookieErr);
      }

      res.status(200).json({ success: true });
    },
    onFailure: (err) => {
      res.status(401).json({ success: false, error: err.message });
    },
    newPasswordRequired: (userAttributes, requiredAttributes) => {
      res.status(400).json({ 
        success: false, 
        error: 'New password required',
        requiresNewPassword: true,
        userAttributes,
        requiredAttributes
      });
    }
  });
}

// Verify phone number with OTP
async function verifyPhoneHandler(req, res) {
  if (!userPool) {
    return res.status(500).json({ 
      success: false, 
      error: 'Authentication service not configured. Please set AWS_COGNITO_USER_POOL_ID and AWS_COGNITO_CLIENT_ID environment variables.' 
    });
  }
  
  const { phoneNumber, code, username } = req.body;
  try { console.log('[Auth] Verify phone (OTP) request', { phoneNumber, username, hasCode: Boolean(code) }); } catch {}
  
  // Format phone number to E.164 format if not already
  const formattedPhone = phoneNumber ? (phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`) : undefined;
  const usernameToUse = username || formattedPhone;
  
  const user = new CognitoUser({ Username: usernameToUse, Pool: userPool });
  
  user.confirmRegistration(code, true, async (err, result) => {
    if (err) {
      console.error('Phone verification error:', err);
      return res.status(400).json({ success: false, error: err.message });
    }
    
    try { 
      console.log('[Auth] Verify phone success'); 
      
      // Update user record to mark as verified
      const userRecord = await getUserRecord(usernameToUse);
      if (userRecord) {
        await updateUserRecord(usernameToUse, {
          'metadata.verified': true
        });
      }
    } catch (dbError) {
      console.error('[Auth] Error updating user verification status:', dbError);
      // Don't fail verification if DynamoDB update fails
    }
    
    res.status(200).json({ 
      success: true, 
      result,
      message: 'Phone number verified successfully!'
    });
  });
}

// Resend OTP
async function resendOtpHandler(req, res) {
  if (!userPool) {
    return res.status(500).json({ 
      success: false, 
      error: 'Authentication service not configured. Please set AWS_COGNITO_USER_POOL_ID and AWS_COGNITO_CLIENT_ID environment variables.' 
    });
  }
  
  const { phoneNumber, username } = req.body;
  try { console.log('[Auth] Resend OTP request', { phoneNumber, username }); } catch {}
  
  // Format phone number to E.164 format if not already
  const formattedPhone = phoneNumber ? (phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`) : undefined;
  const usernameToUse = username || formattedPhone;
  
  const user = new CognitoUser({ Username: usernameToUse, Pool: userPool });
  
  user.resendConfirmationCode((err, result) => {
    if (err) {
      console.error('Resend OTP error:', err);
      return res.status(400).json({ success: false, error: err.message });
    }
    try { console.log('[Auth] Resend OTP success'); } catch {}
    res.status(200).json({ 
      success: true, 
      result,
      message: 'OTP resent successfully!'
    });
  });
}

export { signupHandler, loginHandler, phoneSignupHandler, phoneLoginHandler, verifyPhoneHandler, resendOtpHandler };
// Debug endpoint to check PKCE store
async function debugPkceStoreHandler(req, res) {
  try {
    const entries = Array.from(pkceStore.entries()).map(([state, data]) => ({
      state,
      timestamp: data.timestamp,
      age: Date.now() - data.timestamp,
      verifier: data.verifier ? `${data.verifier.substring(0, 10)}...` : 'missing'
    }));
    
    res.json({
      totalEntries: pkceStore.size,
      entries,
      currentTime: Date.now()
    });
  } catch (error) {
    console.error('Error in debug PKCE store:', error);
    res.status(500).json({ error: 'Failed to debug PKCE store' });
  }
}

// Logout handler
async function logoutHandler(req, res) {
  try {
    const { refresh_token } = req.body;
    
    if (refresh_token) {
      // Revoke the refresh token with Cognito
      const body = new URLSearchParams({
        client_id: process.env.AWS_COGNITO_CLIENT_ID,
        token: refresh_token
      });
      
      try {
        await fetch(`${process.env.AWS_COGNITO_DOMAIN}/oauth2/revoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body
        });
      } catch (error) {
        console.warn('Failed to revoke token with Cognito:', error);
        // Continue with logout even if token revocation fails
      }
    }
    
    // Clear any PKCE data for this session
    const clientId = req.headers['x-client-id'];
    if (clientId) {
      for (const [state, data] of pkceStore.entries()) {
        if (data.clientId === clientId) {
          pkceStore.delete(state);
        }
      }
    }
    
    try {
      const opts = { domain: process.env.COOKIE_DOMAIN || '.brmh.in', path: '/' };
      res.clearCookie('id_token', opts);
      res.clearCookie('access_token', opts);
      res.clearCookie('refresh_token', opts);
    } catch {}
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Error during logout:', error);
    res.status(500).json({ error: 'Failed to logout' });
  }
}

// Return Hosted UI logout URL (to clear Cognito cookies)
async function getLogoutUrlHandler(req, res) {
  try {
    if (!process.env.AWS_COGNITO_DOMAIN || !process.env.AWS_COGNITO_CLIENT_ID || (!process.env.AUTH_LOGOUT_REDIRECT_URI && !process.env.AUTH_REDIRECT_URI)) {
      return res.status(500).json({ 
        error: 'OAuth configuration missing. Please set AWS_COGNITO_DOMAIN, AWS_COGNITO_CLIENT_ID, and AUTH_LOGOUT_REDIRECT_URI/AUTH_REDIRECT_URI environment variables.' 
      });
    }

    const logoutUrl = new URL('/logout', process.env.AWS_COGNITO_DOMAIN);
    logoutUrl.searchParams.set('client_id', process.env.AWS_COGNITO_CLIENT_ID);
    logoutUrl.searchParams.set('logout_uri', process.env.AUTH_LOGOUT_REDIRECT_URI || process.env.AUTH_REDIRECT_URI);

    res.json({ logoutUrl: logoutUrl.toString() });
  } catch (error) {
    console.error('Error generating logout URL:', error);
    res.status(500).json({ error: 'Failed to generate logout URL' });
  }
}

// Admin: Create user in both Cognito and DynamoDB
async function adminCreateUserHandler(req, res) {
  try {
    const { username, email, password, phoneNumber, temporaryPassword = false, namespace, role, permissions } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    if (!userPool) {
      return res.status(500).json({
        success: false,
        error: 'Cognito User Pool not configured'
      });
    }

    // Create username from email if not provided
    const displayName = username || email.split('@')[0];
    const sanitized = displayName.replace(/\s+/g, '_').replace(/[^\w-]/g, '_');
    const cognitoUsername = sanitized || `user_${Date.now()}`;

    console.log('[Admin] Creating user in Cognito:', { cognitoUsername, email });

    // Determine password
    const userPassword = password || temporaryPassword ? 
      `Temp${Math.random().toString(36).slice(-8)}!` : 
      `Pass${Math.random().toString(36).slice(-8)}!`;

    // Prepare attributes
    const attributeList = [
      new CognitoUserAttribute({ Name: 'email', Value: email })
    ];

    if (phoneNumber) {
      const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
      attributeList.push(new CognitoUserAttribute({ Name: 'phone_number', Value: formattedPhone }));
    }

    // Create user in Cognito
    return new Promise((resolve, reject) => {
      userPool.signUp(cognitoUsername, userPassword, attributeList, null, async (err, result) => {
        if (err) {
          console.error('[Admin] Cognito signup error:', err);
          return res.status(400).json({
            success: false,
            error: 'Failed to create user in Cognito',
            details: err.message
          });
        }

        console.log('[Admin] User created in Cognito:', result.userSub);

        try {
          // Create user record in DynamoDB
          const userData = {
            sub: result.userSub,
            username: displayName,
            email: email,
            phoneNumber: phoneNumber,
            cognitoUsername: cognitoUsername,
            signupMethod: 'admin',
            verified: false
          };

          const userRecord = await createUserRecord(userData, null);

          // If namespace and role provided, assign them
          if (namespace && role && permissions) {
            const namespaceRoles = userRecord.namespaceRoles || {};
            namespaceRoles[namespace] = {
              role,
              permissions: Array.isArray(permissions) ? permissions : [permissions],
              assignedAt: new Date().toISOString(),
              assignedBy: 'admin'
            };
            await updateUserRecord(result.userSub, { namespaceRoles });
          }

          console.log('[Admin] User record created in DynamoDB');

          return res.status(201).json({
            success: true,
            message: 'User created successfully in both Cognito and DynamoDB',
            user: {
              userId: result.userSub,
              cognitoUsername,
              email,
              phoneNumber,
              temporaryPassword: temporaryPassword ? userPassword : undefined,
              emailVerificationRequired: true
            }
          });
        } catch (dbError) {
          console.error('[Admin] Error creating DynamoDB record:', dbError);
          return res.status(500).json({
            success: false,
            error: 'User created in Cognito but failed to create DynamoDB record',
            details: dbError.message,
            userId: result.userSub
          });
        }
      });
    });
  } catch (error) {
    console.error('[Admin] Error in admin create user:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create user',
      details: error.message
    });
  }
}

// Admin: Confirm user email manually
async function adminConfirmUserHandler(req, res) {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({
        success: false,
        error: 'username (cognitoUsername) is required'
      });
    }

    const client = new CognitoIdentityProviderClient({
      region: process.env.AWS_COGNITO_REGION || process.env.AWS_REGION || 'us-east-1'
    });

    const { AdminConfirmSignUpCommand } = await import('@aws-sdk/client-cognito-identity-provider');

    const command = new AdminConfirmSignUpCommand({
      UserPoolId: process.env.AWS_COGNITO_USER_POOL_ID,
      Username: username
    });

    await client.send(command);

    console.log('[Admin] Confirmed user:', username);

    // Update DynamoDB record
    try {
      const userRecord = await getUserRecord(username);
      if (userRecord) {
        await updateUserRecord(userRecord.userId, {
          'metadata.verified': true
        });
      }
    } catch (dbError) {
      console.warn('[Admin] Could not update DynamoDB verification status:', dbError.message);
    }

    return res.status(200).json({
      success: true,
      message: 'User confirmed successfully'
    });
  } catch (error) {
    console.error('[Admin] Error confirming user:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to confirm user',
      details: error.message
    });
  }
}

// Admin: List all users in Cognito
async function adminListUsersHandler(req, res) {
  try {
    const { limit = 60 } = req.query;

    const client = new CognitoIdentityProviderClient({
      region: process.env.AWS_COGNITO_REGION || process.env.AWS_REGION || 'us-east-1'
    });

    const { ListUsersCommand } = await import('@aws-sdk/client-cognito-identity-provider');

    const command = new ListUsersCommand({
      UserPoolId: process.env.AWS_COGNITO_USER_POOL_ID,
      Limit: parseInt(limit)
    });

    const response = await client.send(command);

    const users = response.Users.map(user => ({
      username: user.Username,
      userStatus: user.UserStatus,
      enabled: user.Enabled,
      userCreateDate: user.UserCreateDate,
      attributes: user.Attributes.reduce((acc, attr) => {
        acc[attr.Name] = attr.Value;
        return acc;
      }, {})
    }));

    return res.status(200).json({
      success: true,
      count: users.length,
      users
    });
  } catch (error) {
    console.error('[Admin] Error listing users:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to list users',
      details: error.message
    });
  }
}

export { 
  generateOAuthUrlHandler, 
  exchangeTokenHandler, 
  refreshTokenHandler, 
  validateTokenHandler,
  validateJwtToken,
  debugPkceStoreHandler,
  logoutHandler,
  getLogoutUrlHandler,
  // User management functions
  createUserRecord,
  getUserRecord,
  updateUserRecord,
  updateUserLoginWithDomain,
  deleteUserRecord,
  extractDomainFromOrigin,
  extractNamespaceFromDomain,
  // Admin functions
  adminCreateUserHandler,
  adminConfirmUserHandler,
  adminListUsersHandler
};
