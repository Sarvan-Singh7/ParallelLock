/**
 * sameUserHold.test.js – Concurrency test for same user sending two holds simultaneously
 *
 * Verifies regression fix:
 * Previously, when the same user sent two holds at once, the second failed with 23505
 * (uq_bookings_active_user_show). The service then tried to query findActiveUserHold
 * inside the already-aborted transaction, throwing a 500 error in 25/25 runs.
 *
 * With lockUserRow and catching 23505 without executing queries in the aborted transaction:
 * Exactly one hold wins (201), the other cleanly receives 409 ACTIVE_HOLD_EXISTS,
 * and ZERO 500 Internal Server Errors occur.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { setupTestDb, cleanDb, closeDb, seedTestShow, testPool } from '../helpers/db.js';
import { mintToken } from '../helpers/tokens.js';

describe('Same User Concurrent Holds Regression Test', () => {
  let testData;
  let userToken;
  let userId;

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await cleanDb();
    testData = await seedTestShow();

    const uRes = await testPool.query(`
      INSERT INTO users (name, email, password_hash)
      VALUES ('Concurrent User', 'concurrent.user@test.local', 'hash')
      RETURNING id
    `);

    userId = uRes.rows[0].id;
    userToken = mintToken({ id: userId, name: 'Concurrent User' });
  });

  afterAll(async () => {
    await closeDb();
  });

  it(
    '25 of 25 parallel hold pairs produce exactly one 201 and one 409, with ZERO 500 errors',
    async () => {
      const RUNS = 25;

      for (let i = 0; i < RUNS; i++) {
        // Clean DB before each run
        await cleanDb();
        testData = await seedTestShow();

        const uRes = await testPool.query(`
          INSERT INTO users (name, email, password_hash)
          VALUES ('User ${i}', 'user${i}@test.local', 'hash')
          RETURNING id
        `);
        const token = mintToken({ id: uRes.rows[0].id, name: `User ${i}` });

        const req1 = request(app)
          .post(`/api/v1/shows/${testData.showId}/holds`)
          .set('Authorization', `Bearer ${token}`)
          .send({ seatIds: [testData.seatIds[0]] });

        const req2 = request(app)
          .post(`/api/v1/shows/${testData.showId}/holds`)
          .set('Authorization', `Bearer ${token}`)
          .send({ seatIds: [testData.seatIds[1]] });

        const [res1, res2] = await Promise.all([req1, req2]);

        const statuses = [res1.status, res2.status].sort((a, b) => a - b);

        // Verify zero 500 server errors
        expect(res1.status).not.toBe(500);
        expect(res2.status).not.toBe(500);

        // Exactly one 201 Created and one 409 Conflict
        expect(statuses).toEqual([201, 409]);

        const failedRes = res1.status === 409 ? res1 : res2;
        expect(failedRes.body.error.code).toBe('ACTIVE_HOLD_EXISTS');
      }
    },
    60_000  // 60-second timeout: 25 sequential iterations each with 2 parallel HTTP requests
  );
});
