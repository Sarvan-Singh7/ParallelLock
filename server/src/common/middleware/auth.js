/**
 * auth.js – Authentication middleware
 *
 * - requireAuth: Enforces a valid JWT in Authorization: Bearer <token>. Returns 401 if missing/invalid.
 * - optionalAuth: Parses JWT if present; attaches user or sets req.user = null without failing.
 */
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { errors } from '../errors.js';

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7).trim();
}

export function requireAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) {
    return next(errors.unauthorized());
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    req.user = {
      id: payload.sub,
      name: payload.name,
    };
    next();
  } catch (_err) {
    next(errors.unauthorized());
  }
}

export function optionalAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    req.user = {
      id: payload.sub,
      name: payload.name,
    };
  } catch (_err) {
    req.user = null;
  }
  next();
}
