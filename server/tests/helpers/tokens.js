/**
 * tokens.js – Fast JWT minting helper for tests
 *
 * Directly signs tokens with JWT_SECRET without argon2 hashing so that
 * concurrency tests with 500 parallel users remain fast and lightweight.
 */
import jwt from 'jsonwebtoken';
import { env } from '../../src/config/env.js';

export function mintToken(user = {}) {
  const id = user.id ? String(user.id) : '1';
  const name = user.name || 'Test User';
  return jwt.sign(
    { sub: id, name },
    env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '7d' }
  );
}
