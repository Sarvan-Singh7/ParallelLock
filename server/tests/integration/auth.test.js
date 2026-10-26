/**
 * auth.test.js – Integration tests for authentication endpoints
 *
 * Covers:
 * - Successful registration (201) and JWT structure
 * - Duplicate email registration (409 EMAIL_TAKEN)
 * - Validation errors (422 VALIDATION_ERROR)
 * - Successful login (200)
 * - Wrong password and unknown email return identical 401 response (INVALID_CREDENTIALS)
 * - Protected endpoint missing token returns 401 (UNAUTHORIZED)
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { setupTestDb, cleanDb, closeDb } from '../helpers/db.js';

describe('Auth Integration Tests (/api/v1/auth)', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await cleanDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  describe('POST /api/v1/auth/register', () => {
    it('registers a new user and returns 201 with JWT token and user info', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Jane Doe',
          email: 'Jane.Doe@example.com',
          password: 'securepassword123',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user).toEqual({
        id: expect.any(String),
        name: 'Jane Doe',
        email: 'jane.doe@example.com', // lowercased
      });
      expect(typeof res.body.token).toBe('string');
    });

    it('returns 409 EMAIL_TAKEN on duplicate email (case-insensitive)', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Jane Doe',
          email: 'jane@example.com',
          password: 'securepassword123',
        });

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Jane Clone',
          email: 'JANE@example.com',
          password: 'anotherpassword123',
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toEqual({
        code: 'EMAIL_TAKEN',
        message: 'An account with this email already exists.',
        details: {},
      });
    });

    it('returns 422 VALIDATION_ERROR when password is fewer than 8 characters', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Short Pass',
          email: 'short@example.com',
          password: 'short',
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toHaveProperty('password');
    });

    it('returns 422 VALIDATION_ERROR on invalid email', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Bad Email',
          email: 'not-an-email',
          password: 'securepassword123',
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toHaveProperty('email');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Registered User',
          email: 'user@example.com',
          password: 'CorrectPassword123',
        });
    });

    it('logs in successfully with valid credentials and returns 200', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'user@example.com',
          password: 'CorrectPassword123',
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user).toEqual({
        id: expect.any(String),
        name: 'Registered User',
        email: 'user@example.com',
      });
    });

    it('returns identical 401 INVALID_CREDENTIALS for wrong password and unknown email', async () => {
      // 1. Wrong password
      const wrongPassRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'user@example.com',
          password: 'WrongPassword999',
        });

      // 2. Unknown email
      const unknownEmailRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'SomePassword123',
        });

      expect(wrongPassRes.status).toBe(401);
      expect(unknownEmailRes.status).toBe(401);

      const expectedError = {
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect.',
        details: {},
      };

      expect(wrongPassRes.body.error).toEqual(expectedError);
      expect(unknownEmailRes.body.error).toEqual(expectedError);
    });
  });

  describe('Auth Middleware (requireAuth, optionalAuth)', () => {
    let testApp;

    beforeAll(async () => {
      const express = (await import('express')).default;
      const { requireAuth, optionalAuth } = await import('../../src/common/middleware/auth.js');
      const { errorHandler } = await import('../../src/common/middleware/errorHandler.js');

      testApp = express();
      testApp.use(express.json());

      testApp.get('/test/protected', requireAuth, (req, res) => {
        res.json({ user: req.user });
      });

      testApp.get('/test/optional', optionalAuth, (req, res) => {
        res.json({ user: req.user });
      });

      testApp.use(errorHandler);
    });

    it('returns 401 UNAUTHORIZED when Authorization header is missing', async () => {
      const res = await request(testApp).get('/test/protected');

      expect(res.status).toBe(401);
      expect(res.body.error).toEqual({
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
        details: {},
      });
    });

    it('returns 401 UNAUTHORIZED when token is malformed or invalid', async () => {
      const res = await request(testApp)
        .get('/test/protected')
        .set('Authorization', 'Bearer invalid.token.signature');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('attaches req.user and passes through when valid token is provided', async () => {
      const { mintToken } = await import('../helpers/tokens.js');
      const token = mintToken({ id: '42', name: 'Alice' });

      const res = await request(testApp)
        .get('/test/protected')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.user).toEqual({ id: '42', name: 'Alice' });
    });

    it('optionalAuth attaches user if valid token present, or null if missing', async () => {
      const { mintToken } = await import('../helpers/tokens.js');
      const token = mintToken({ id: '99', name: 'Bob' });

      const resWithToken = await request(testApp)
        .get('/test/optional')
        .set('Authorization', `Bearer ${token}`);

      expect(resWithToken.status).toBe(200);
      expect(resWithToken.body.user).toEqual({ id: '99', name: 'Bob' });

      const resWithoutToken = await request(testApp).get('/test/optional');
      expect(resWithoutToken.status).toBe(200);
      expect(resWithoutToken.body.user).toBeNull();
    });
  });
});

