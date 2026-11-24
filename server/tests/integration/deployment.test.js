/**
 * deployment.test.js – Integration tests for Milestone D1: Deployment Readiness
 *
 * Verifies:
 * 1. GET /health (process up liveness probe) returns 200 with uptime and status.
 * 2. GET /ready (database readiness probe) returns 200 when DB is responsive.
 * 3. GET /ready returns 503 when the database is unavailable.
 * 4. Production secret check fails fast when development/placeholder secrets are used under NODE_ENV=production.
 */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { execSync } from 'node:child_process';
import app from '../../src/app.js';
import pool from '../../src/db/pool.js';
import { validateProductionSecrets } from '../../src/config/env.js';

describe('Milestone D1: Deployment Readiness', () => {
  // ─── 1. Health Probe (Liveness) ─────────────────────────────────────────────
  it('GET /health returns 200 with status ok and integer uptime', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
    expect(res.body.timestamp).toBeDefined();
    expect(new Date(res.body.timestamp).getTime()).not.toBeNaN();
  });

  // ─── 2. Ready Probe (Readiness) – Healthy ───────────────────────────────────
  it('GET /ready returns 200 with db connected when database is responsive', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.db).toBe('connected');
    expect(res.body.timestamp).toBeDefined();
  });

  // ─── 3. Ready Probe (Readiness) – Unhealthy ─────────────────────────────────
  it('GET /ready returns 503 with not_ready when database query throws', async () => {
    const originalQuery = pool.query;
    // Mock pool.query to simulate database connection loss
    pool.query = vi.fn().mockRejectedValueOnce(new Error('Connection terminated unexpectedly'));

    try {
      const res = await request(app).get('/ready');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('not_ready');
      expect(res.body.db).toBe('disconnected');
      expect(res.body.error).toContain('Connection terminated unexpectedly');
    } finally {
      // Restore original query method
      pool.query = originalQuery;
    }
  });

  // ─── 4. Production Secret Validation ────────────────────────────────────────
  describe('Production Secret Validation', () => {
    it('fails fast when JWT_SECRET is shorter than 32 characters in production', () => {
      const result = validateProductionSecrets({
        NODE_ENV: 'production',
        JWT_SECRET: 'too_short_jwt_secret',
        WEBHOOK_SECRET: 'secure_webhook_secret_key_12345',
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('at least 32 characters long'))).toBe(true);
    });

    it('fails fast when default development JWT_SECRET is used in production', () => {
      const result = validateProductionSecrets({
        NODE_ENV: 'production',
        JWT_SECRET: 'super_secret_development_key_minimum_32_characters_long_12345',
        WEBHOOK_SECRET: 'secure_webhook_secret_key_12345',
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('default/development JWT_SECRET'))).toBe(true);
    });

    it('fails fast when default development WEBHOOK_SECRET is used in production', () => {
      const result = validateProductionSecrets({
        NODE_ENV: 'production',
        JWT_SECRET: 'a_very_secure_and_cryptographically_sound_jwt_key_32_chars',
        WEBHOOK_SECRET: 'at_least_16_chars_random_string',
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('default/development WEBHOOK_SECRET'))).toBe(true);
    });

    it('passes validation when secure non-development secrets are provided in production', () => {
      const result = validateProductionSecrets({
        NODE_ENV: 'production',
        JWT_SECRET: 'a_very_secure_and_cryptographically_sound_jwt_key_32_chars',
        WEBHOOK_SECRET: 'secure_prod_webhook_secret_key_987654321',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('runtime process refuses to start and exits with 1 when booted with dev secrets in production', () => {
      // Execute Node in a subprocess with NODE_ENV=production and dev secret
      try {
        execSync(
          'node -e "import(\'./src/config/env.js\')"',
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              NODE_ENV: 'production',
              JWT_SECRET: 'super_secret_development_key_minimum_32_characters_long_12345',
            },
            stdio: 'pipe',
          }
        );
        // If it didn't throw, fail the test
        expect.unreachable('Process should have failed fast and exited with code 1');
      } catch (err) {
        expect(err.status).toBe(1);
        const stderr = err.stderr ? err.stderr.toString() : '';
        expect(stderr).toContain('Production secret validation failed');
      }
    });
  });
});
