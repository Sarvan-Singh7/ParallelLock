/**
 * oppositeOrder.test.js – Deadlock prevention concurrency test
 *
 * Requirements:
 * - Two users hold [s1, s2] and [s2, s1] concurrently
 * - 300 iterations, resetting between iterations
 * - No 500 error and no Postgres deadlock error (40P01)
 * - In each iteration, exactly one user wins both seats
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { setupTestDb, cleanDb, closeDb, seedTestShow, testPool } from '../helpers/db.js';
import { mintToken } from '../helpers/tokens.js';

describe('Deadlock Prevention Concurrency Tests (Opposite Order)', () => {
  let testData;
  let user1Token;
  let user2Token;

  beforeAll(async () => {
    await setupTestDb();
    await cleanDb();
    testData = await seedTestShow();

    // Insert two distinct users to satisfy foreign key constraints
    const userRes = await testPool.query(`
      INSERT INTO users (name, email, password_hash)
      VALUES
        ('Deadlock User 1', 'deadlock1@test.local', 'hash'),
        ('Deadlock User 2', 'deadlock2@test.local', 'hash')
      RETURNING id
    `);

    user1Token = mintToken({ id: userRes.rows[0].id, name: 'Deadlock User 1' });
    user2Token = mintToken({ id: userRes.rows[1].id, name: 'Deadlock User 2' });
  });

  afterAll(async () => {
    await closeDb();
  });

  it('runs 300 iterations of [s1, s2] vs [s2, s1] with zero deadlocks and exactly one winner per iteration', async () => {
    const s1 = testData.seatIds[0];
    const s2 = testData.seatIds[1];
    const ITERATIONS = 300;

    for (let iter = 0; iter < ITERATIONS; iter++) {
      // Reset show seats and bookings between iterations
      await testPool.query(`
        UPDATE show_seats
        SET status = 'AVAILABLE', booking_id = NULL, hold_expires_at = NULL
        WHERE show_id = $1 AND seat_id IN ($2, $3)
      `, [testData.showId, s1, s2]);

      await testPool.query(`
        DELETE FROM bookings WHERE show_id = $1
      `, [testData.showId]);

      // User 1 requests [s1, s2]; User 2 requests [s2, s1] simultaneously
      const req1 = request(app)
        .post(`/api/v1/shows/${testData.showId}/holds`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ seatIds: [s1, s2] });

      const req2 = request(app)
        .post(`/api/v1/shows/${testData.showId}/holds`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ seatIds: [s2, s1] });

      const [res1, res2] = await Promise.all([req1, req2]);

      // Check for zero server errors (deadlock 40P01 surfaces as 500)
      expect(res1.status).not.toBe(500);
      expect(res2.status).not.toBe(500);

      // Exactly one user must win (201) and the other must be rejected (409)
      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([201, 409]);
    }
  }, 90000);
});
