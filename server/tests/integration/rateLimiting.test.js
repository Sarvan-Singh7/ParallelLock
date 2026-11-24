/**
 * rateLimiting.test.js – Rate Limiting Integration Tests (Milestone R1)
 *
 * Verifies:
 * 1. Limiter is disabled by default under test environment.
 * 2. Holds: 11th hold from one user within 1 minute gets 429; window resets after clock advances.
 * 3. NAT Test: 50 different users sharing the same IP each hold a seat; all succeed with 0 429s.
 * 4. User Isolation: One user hitting the limit does not affect another user.
 * 5. Login Failures Only: 40 successful logins from one IP all succeed.
 * 6. Login Brute-force Barrier: 10 failed logins for one email gets 429; another email from same IP is unaffected.
 * 7. Zero Information Leak: 429 for existing vs non-existing email is byte-identical.
 * 8. Success Resets Email Failure Counter: Successful login clears previous failures.
 * 9. Headers & Retry-After: 429 returns integer Retry-After, limit, remaining, and reset headers.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { setupTestDb, cleanDb, closeDb, testPool } from '../helpers/db.js';
import { mintToken } from '../helpers/tokens.js';
import { defaultRateLimitStore } from '../../src/common/middleware/rateLimitStore.js';

describe('Milestone R1: Sliding-Window Rate Limiting', () => {
  let mockTime;
  let showId;
  let seatIds = [];

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await cleanDb();

    // Setup injectable mock clock
    mockTime = 1_700_000_000_000;
    defaultRateLimitStore.now = () => mockTime;
    defaultRateLimitStore.hits.clear();

    // Seed test theater, screen, 60 seats, movie, and show
    const tRes = await testPool.query(`
      INSERT INTO theaters (name, address, city)
      VALUES ('RL Theater', '123 Test St', 'Chandigarh')
      RETURNING id
    `);
    const theaterId = tRes.rows[0].id;

    const sRes = await testPool.query(`
      INSERT INTO screens (theater_id, name, format)
      VALUES ($1, 'RL Screen', 'LASER')
      RETURNING id
    `, [theaterId]);
    const screenId = sRes.rows[0].id;

    seatIds = [];
    for (let i = 1; i <= 60; i++) {
      const rowLabel = String.fromCharCode(65 + Math.floor((i - 1) / 10)); // A, B, C...
      const seatLabel = String(((i - 1) % 10) + 1);
      const res = await testPool.query(`
        INSERT INTO seats (screen_id, row_label, seat_label, section, grid_row, grid_col, is_active)
        VALUES ($1, $2, $3, 'GOLD', 1, $4, true)
        RETURNING id
      `, [screenId, rowLabel, seatLabel, i]);
      seatIds.push(Number(res.rows[0].id));
    }

    const mRes = await testPool.query(`
      INSERT INTO movies (title, synopsis, duration_min, certificate, languages, genres, release_date)
      VALUES ('RL Movie', 'Synopsis', 120, 'UA', ARRAY['Hindi'], ARRAY['Drama'], '2026-11-24')
      RETURNING id
    `);
    const movieId = mRes.rows[0].id;

    const shRes = await testPool.query(`
      INSERT INTO shows (movie_id, screen_id, starts_at, language, format)
      VALUES ($1, $2, now() + interval '2 hours', 'Hindi', 'LASER')
      RETURNING id
    `, [movieId, screenId]);
    showId = shRes.rows[0].id;

    for (const sId of seatIds) {
      await testPool.query(`
        INSERT INTO show_seats (show_id, seat_id, status, price_cents)
        VALUES ($1, $2, 'AVAILABLE', 32000)
      `, [showId, sId]);
    }
  });

  afterAll(async () => {
    delete process.env.ENABLE_RATE_LIMITER;
    defaultRateLimitStore.now = () => Date.now();
    defaultRateLimitStore.destroy();
    await closeDb();
  });

  // ─── 1. Default Test Isolation ───────────────────────────────────────────────
  it('limiter is OFF under tests by default unless explicitly enabled', async () => {
    delete process.env.ENABLE_RATE_LIMITER;

    // Create a test user
    const uRes = await testPool.query(`
      INSERT INTO users (name, email, password_hash)
      VALUES ('Alice', 'alice_off@example.com', 'hash')
      RETURNING id
    `);
    const token = mintToken({ id: uRes.rows[0].id, name: 'Alice' });

    // Make 12 holds without rate limiting (releasing or using different shows to avoid 409)
    for (let i = 0; i < 12; i++) {
      const res = await request(app)
        .post(`/api/v1/shows/${showId}/holds`)
        .set('Authorization', `Bearer ${token}`)
        .send({ seatIds: [seatIds[i]] });
      // When limiter is OFF, none of them receive 429
      expect(res.status).not.toBe(429);
      expect(res.headers['retry-after']).toBeUndefined();
    }
  });

  // ─── 2. Holds Rate Limiter & Window Reset ────────────────────────────────────
  it('holds: 11th hold from one user within a minute gets 429; window resets after clock advances', async () => {
    process.env.ENABLE_RATE_LIMITER = 'true';

    const uRes = await testPool.query(`
      INSERT INTO users (name, email, password_hash)
      VALUES ('Bob', 'bob_rl@example.com', 'hash')
      RETURNING id
    `);
    const token = mintToken({ id: uRes.rows[0].id, name: 'Bob' });

    // Send 10 holds (the allowed limit), releasing each so next hold is not blocked by ACTIVE_HOLD_EXISTS
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post(`/api/v1/shows/${showId}/holds`)
        .set('Authorization', `Bearer ${token}`)
        .send({ seatIds: [seatIds[i]] });
      expect(res.status).toBe(201);
      expect(res.headers['x-ratelimit-limit']).toBe('10');
      expect(res.headers['x-ratelimit-remaining']).toBe(String(10 - (i + 1)));

      // Release hold so user can make another hold on this show
      await request(app)
        .delete(`/api/v1/bookings/${res.body.booking.id}`)
        .set('Authorization', `Bearer ${token}`);
    }

    // 11th hold within the same minute: rejected with 429
    const limitedRes = await request(app)
      .post(`/api/v1/shows/${showId}/holds`)
      .set('Authorization', `Bearer ${token}`)
      .send({ seatIds: [seatIds[10]] });

    expect(limitedRes.status).toBe(429);
    expect(limitedRes.body).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please try again later.',
        details: {},
      },
    });
    expect(limitedRes.headers['retry-after']).toMatch(/^\d+$/);
    expect(parseInt(limitedRes.headers['retry-after'], 10)).toBeGreaterThan(0);
    expect(limitedRes.headers['x-ratelimit-remaining']).toBe('0');

    // Advance injectable clock by 61 seconds (window expires)
    mockTime += 61_000;

    // 12th hold after window reset succeeds
    const resetRes = await request(app)
      .post(`/api/v1/shows/${showId}/holds`)
      .set('Authorization', `Bearer ${token}`)
      .send({ seatIds: [seatIds[11]] });
    expect(resetRes.status).toBe(201);
    expect(resetRes.headers['x-ratelimit-remaining']).toBe('9');
  });

  // ─── 3. Campus NAT Shared IP Test ───────────────────────────────────────────
  it('50 DIFFERENT users sharing the SAME IP each make a hold and all succeed with no 429 (NAT test)', async () => {
    process.env.ENABLE_RATE_LIMITER = 'true';

    const sharedIp = '198.51.100.42'; // Simulated shared university WiFi NAT IP

    // Create 50 distinct user tokens
    const tokens = [];
    for (let i = 1; i <= 50; i++) {
      const uRes = await testPool.query(`
        INSERT INTO users (name, email, password_hash)
        VALUES ($1, $2, 'hash')
        RETURNING id
      `, [`Student ${i}`, `student_${i}@university.edu`]);
      tokens.push(mintToken({ id: uRes.rows[0].id, name: `Student ${i}` }));
    }

    // All 50 users hold seats from the exact same IP
    for (let i = 0; i < 50; i++) {
      const res = await request(app)
        .post(`/api/v1/shows/${showId}/holds`)
        .set('Authorization', `Bearer ${tokens[i]}`)
        .set('X-Forwarded-For', sharedIp)
        .send({ seatIds: [seatIds[i]] });

      expect(res.status).toBe(201);
      expect(res.headers['x-ratelimit-limit']).toBe('10');
      // Each user is on their 1st request -> remaining is 9
      expect(res.headers['x-ratelimit-remaining']).toBe('9');
    }
  });

  // ─── 4. User Isolation ───────────────────────────────────────────────────────
  it('one user reaching the hold limit does not affect another user', async () => {
    process.env.ENABLE_RATE_LIMITER = 'true';

    const u1 = await testPool.query(`INSERT INTO users (name, email, password_hash) VALUES ('User 1', 'u1@example.com', 'h') RETURNING id`);
    const u2 = await testPool.query(`INSERT INTO users (name, email, password_hash) VALUES ('User 2', 'u2@example.com', 'h') RETURNING id`);
    const token1 = mintToken({ id: u1.rows[0].id, name: 'User 1' });
    const token2 = mintToken({ id: u2.rows[0].id, name: 'User 2' });

    // User 1 exhausts their 10 holds
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post(`/api/v1/shows/${showId}/holds`)
        .set('Authorization', `Bearer ${token1}`)
        .send({ seatIds: [seatIds[i]] });
    }

    // User 1 is rate limited
    const res1 = await request(app)
      .post(`/api/v1/shows/${showId}/holds`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ seatIds: [seatIds[10]] });
    expect(res1.status).toBe(429);

    // User 2 is completely unaffected
    const res2 = await request(app)
      .post(`/api/v1/shows/${showId}/holds`)
      .set('Authorization', `Bearer ${token2}`)
      .send({ seatIds: [seatIds[11]] });
    expect(res2.status).toBe(201);
  });

  // ─── 5. Login Failures Only (Successful Logins Ignored) ─────────────────────
  it('40 successful logins from one IP all succeed without hitting rate limit', async () => {
    process.env.ENABLE_RATE_LIMITER = 'true';

    // Register a valid user
    await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Valid User', email: 'valid@example.com', password: 'Password123' });

    const sharedIp = '203.0.113.88';

    for (let i = 0; i < 40; i++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', sharedIp)
        .send({ email: 'valid@example.com', password: 'Password123' });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
    }
  });

  // ─── 6. Login Brute-force Barrier (Dual Key: IP & Email) ────────────────────
  it('10 failed logins for one email triggers 429; another email from the same IP is unaffected', async () => {
    process.env.ENABLE_RATE_LIMITER = 'true';

    const sharedIp = '203.0.113.55';
    const targetEmail = 'target@example.com';

    // Send 10 failed logins for targetEmail
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', sharedIp)
        .send({ email: targetEmail, password: 'WrongPassword!' });
      expect(res.status).toBe(401);
    }

    // 11th failed login for targetEmail gets 429
    const blockedRes = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', sharedIp)
      .send({ email: targetEmail, password: 'WrongPassword!' });

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers['retry-after']).toMatch(/^\d+$/);
    expect(blockedRes.body.error.code).toBe('RATE_LIMITED');

    // A different email from the same IP is NOT blocked (only 10 failures on IP, below the 60 limit)
    const otherRes = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', sharedIp)
      .send({ email: 'innocent@example.com', password: 'WrongPassword!' });

    expect(otherRes.status).toBe(401); // 401 Invalid credentials, NOT 429!
  });

  // ─── 7. Zero Information Leak ───────────────────────────────────────────────
  it('429 response for an existing email and a non-existing email are byte-identical', async () => {
    process.env.ENABLE_RATE_LIMITER = 'true';

    // Register existing user
    await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Real User', email: 'real@example.com', password: 'Password123' });

    // Trigger 10 failures on real user
    for (let i = 0; i < 10; i++) {
      await request(app).post('/api/v1/auth/login').send({ email: 'real@example.com', password: 'bad' });
    }
    const real429 = await request(app).post('/api/v1/auth/login').send({ email: 'real@example.com', password: 'bad' });

    // Trigger 10 failures on ghost user
    for (let i = 0; i < 10; i++) {
      await request(app).post('/api/v1/auth/login').send({ email: 'ghost_nonexistent@example.com', password: 'bad' });
    }
    const ghost429 = await request(app).post('/api/v1/auth/login').send({ email: 'ghost_nonexistent@example.com', password: 'bad' });

    expect(real429.status).toBe(429);
    expect(ghost429.status).toBe(429);

    // Byte-identical bodies
    expect(JSON.stringify(real429.body)).toBe(JSON.stringify(ghost429.body));
    expect(real429.body).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please try again later.',
        details: {},
      },
    });

    // Headers verification
    expect(real429.headers['retry-after']).toBe(ghost429.headers['retry-after']);
    expect(real429.headers['x-ratelimit-limit']).toBe('10');
    expect(ghost429.headers['x-ratelimit-limit']).toBe('10');
  });

  // ─── 8. Successful Login Resets Email Failure Counter ───────────────────────
  it('a successful login resets the email failure counter', async () => {
    process.env.ENABLE_RATE_LIMITER = 'true';

    await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Charlie', email: 'charlie@example.com', password: 'CorrectPassword1' });

    // 8 failed logins (below limit of 10)
    for (let i = 0; i < 8; i++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'charlie@example.com', password: 'wrong' });
      expect(res.status).toBe(401);
    }

    // Successful login resets the counter
    const successRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'charlie@example.com', password: 'CorrectPassword1' });
    expect(successRes.status).toBe(200);

    // Send 8 more failed logins: if counter was not reset, 8+8=16 would have triggered 429
    for (let i = 0; i < 8; i++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'charlie@example.com', password: 'wrong' });
      expect(res.status).toBe(401); // Still 401, NOT 429!
    }
  });

  // ─── 9. Retry-After Header Format ───────────────────────────────────────────
  it('Retry-After is present and a positive integer', async () => {
    process.env.ENABLE_RATE_LIMITER = 'true';

    for (let i = 0; i < 10; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'retry_after_test@example.com', password: 'bad' });
    }

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'retry_after_test@example.com', password: 'bad' });

    expect(res.status).toBe(429);
    const retryAfter = res.headers['retry-after'];
    expect(retryAfter).toBeDefined();
    expect(retryAfter).toMatch(/^\d+$/);
    const retryAfterSec = parseInt(retryAfter, 10);
    expect(retryAfterSec).toBeGreaterThan(0);
    expect(Number.isInteger(retryAfterSec)).toBe(true);
  });
});
