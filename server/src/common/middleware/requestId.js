import { randomUUID } from 'node:crypto';

/**
 * Attaches a unique X-Request-Id to every request and response.
 * Reuses an existing header value if the upstream proxy sent one.
 */
export function requestId(req, res, next) {
  const id = req.headers['x-request-id'] || randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
