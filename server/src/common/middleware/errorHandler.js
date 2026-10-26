import { AppError } from '../errors.js';

/**
 * Central error handler (must be the LAST middleware registered in app.js).
 *
 * Maps AppError instances to the canonical JSON shape:
 *   { error: { code, message, details } }
 *
 * Unrecognised errors are logged with console.error and returned as 500
 * so internal details are never leaked to clients.
 */
export function errorHandler(err, _req, res, _next) {
  if (err instanceof AppError) {
    // Known application error – send the code and message as-is.
    if (err.status === 503) {
      res.setHeader('Retry-After', '1');
    }
    return res.status(err.status).json({
      error: {
        code:    err.code,
        message: err.message,
        details: err.details,
      },
    });
  }

  // Postgres lock-timeout surfaces as error code 55P03.
  if (err.code === '55P03') {
    res.setHeader('Retry-After', '1');
    return res.status(503).json({
      error: {
        code:    'SERVICE_UNAVAILABLE',
        message: 'The service is temporarily busy. Please try again.',
        details: {},
      },
    });
  }

  // Unexpected 5xx – log stack for operators, hide internals from clients.
  console.error('Unhandled error:', err);
  return res.status(500).json({
    error: {
      code:    'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      details: {},
    },
  });
}
