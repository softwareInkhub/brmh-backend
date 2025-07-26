// brmh-backend/middleware/errorHandler.js

export function errorHandler(err, req, res, next) {
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