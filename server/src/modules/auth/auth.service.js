/**
 * auth.service.js – Business logic for authentication
 *
 * Handles password hashing with Argon2, JWT issuance, and credential verification.
 */
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { errors } from '../../common/errors.js';
import { authRepo } from './auth.repo.js';

function signToken(user) {
  return jwt.sign(
    { sub: String(user.id), name: user.name },
    env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '7d' }
  );
}

export const authService = {
  async register({ name, email, password }) {
    const passwordHash = await argon2.hash(password);
    const user = await authRepo.createUser({
      name,
      email: email.toLowerCase(),
      passwordHash,
    });

    const token = signToken(user);
    return {
      token,
      user: {
        id: String(user.id),
        name: user.name,
        email: user.email,
      },
    };
  },

  async login({ email, password }) {
    const user = await authRepo.findByEmail(email.toLowerCase());
    if (!user) {
      // Must not leak whether email or password was wrong
      throw errors.invalidCreds();
    }

    const isValid = await argon2.verify(user.password_hash, password);
    if (!isValid) {
      throw errors.invalidCreds();
    }

    const token = signToken(user);
    return {
      token,
      user: {
        id: String(user.id),
        name: user.name,
        email: user.email,
      },
    };
  },
};
