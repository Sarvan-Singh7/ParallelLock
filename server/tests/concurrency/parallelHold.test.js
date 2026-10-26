/**
 * parallelHold.test.js – Massive concurrency stress test for seat holding
 *
 * Requirements:
 * - 100 and then 500 users all POST holds for the same single seat at once
 * - Exactly one 201 response
 * - All other responses 409 SEAT_UNAVAILABLE
 * - Exactly one HELD row in the database
 * - Zero 5xx errors
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { setupTestDb, cleanDb, closeDb, seedTestShow, testPool } from '../helpers/db.js';
import { mintToken } from '../helpers/tokens.js';

describe('Parallel Hold Concurrency Stress Tests', () => {
  let testData;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  async function runParallelHoldTest(numUsers) {
    await cleanDb();
    testData = await seedTestShow();
    const targetSeatId = testData.seatIds[0];

    // Bulk insert numUsers into users table to satisfy foreign key constraint on bookings(user_id)
    const userRows = [];
    for (let i = 1; i <= numUsers; i++) {
      userRows.push(`('User ${i}', 'stress_user_${i}_${Date.now()}@test.local', 'hash')`);
    }

    const insertRes = await testPool.query(`
      INSERT INTO users (name, email, password_hash)
      VALUES ${userRows.join(', ')}
      RETURNING id
    `);

    // Mint tokens directly in-memory (no argon2 hashing overhead)
    const tokens = insertRes.rows.map((row) =>
      mintToken({ id: row.id, name: 'Stress User' })
    );

    // Fire all hold requests concurrently against the single seat
    const promises = tokens.map((token) =>
      request(app)
        .post(`/api/v1/shows/${testData.showId}/holds`)
        .set('Authorization', `Bearer ${token}`)
        .send({ seatIds: [targetSeatId] })
    );

    const responses = await Promise.all(promises);

    const successes = responses.filter((r) => r.status === 201);
    const seatUnavailable = responses.filter(
      (r) => r.status === 409 && r.body?.error?.code === 'SEAT_UNAVAILABLE'
    );
    const serverErrors = responses.filter((r) => r.status >= 500);

    // Exactly one winner
    expect(successes).toHaveLength(1);
    // All other requests get 409 SEAT_UNAVAILABLE
    expect(seatUnavailable).toHaveLength(numUsers - 1);
    // Zero 5xx errors
    expect(serverErrors).toHaveLength(0);

    // Verify DB state: exactly one HELD row for this seat
    const { rows } = await testPool.query(
      `SELECT count(*)::int AS held_count
       FROM show_seats
       WHERE show_id = $1 AND seat_id = $2 AND status = 'HELD'`,
      [testData.showId, targetSeatId]
    );
    expect(rows[0].held_count).toBe(1);
  }

  it('100 parallel users competing for the same single seat: exactly one winner', async () => {
    await runParallelHoldTest(100);
  }, 45000);

  it('500 parallel users competing for the same single seat: exactly one winner', async () => {
    await runParallelHoldTest(500);
  }, 90000);
});
