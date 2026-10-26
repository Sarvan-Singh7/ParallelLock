import { env } from '../../config/env.js';

/**
 * CORS middleware.
 *
 * Allows requests from CLIENT_ORIGIN only (no wildcard in production).
 * Credentials are supported so the Authorization header can be sent.
 */
export function cors(req, res, next) {
  const origin = req.headers.origin;

  if (origin === env.CLIENT_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Request-Id'
    );
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, DELETE, OPTIONS'
    );
  }

  // Respond to preflight requests immediately.
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
}
