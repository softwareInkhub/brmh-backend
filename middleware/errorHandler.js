// brmh-backend/middleware/errorHandler.js

// CORS configuration (should match index.js)
const allowedOrigins = [
  'https://brmh.in',
  'https://www.brmh.in',
  'https://auth.brmh.in',
  'https://app.brmh.in',
  'https://projectmngnt.vercel.app',
  'https://projectmanagement.brmh.in',
  'https://admin.brmh.in',
  'https://drive.brmh.in',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:4000',
];

const originRegexes = [
  /^https:\/\/([a-z0-9-]+\.)*brmh\.in$/i,
  /^https:\/\/([a-z0-9-]+\.)*vercel\.app$/i,
  /^http:\/\/localhost(?::\d+)?$/i,
];

// Helper function to set CORS headers
function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    if (allowedOrigins.includes(origin) || originRegexes.some(rx => rx.test(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Cookie, Accept');
      res.setHeader('Access-Control-Expose-Headers', 'Set-Cookie, Authorization');
      return true;
    }
  }
  return true; // Allow requests with no origin
}

export function errorHandler(err, req, res, next) {
  // Set CORS headers FIRST, even on errors
  setCorsHeaders(req, res);

  // Default error response
  let status = err.status || 500;
  let message = err.message || 'Internal Server Error';

  // Network error (e.g., ECONNREFUSED, ENOTFOUND, EAI_AGAIN)
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
    status = 503;
    message = 'Internet connection issue or external service unavailable';
  }

  // Validation error (customize as needed)
  if (err.name === 'ValidationError') {
    status = 400;
    message = err.message || 'Validation failed';
  }

  // Log the error (optional: add more details in development)
  console.error('[ErrorHandler]', err);

  // Always send a structured error response
  res.status(status).json({
    success: false,
    error: {
      message,
      code: err.code || undefined,
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    }
  });
} 