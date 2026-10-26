/**
 * expiry.test.js – Integration tests for passive hold expiry
 *
 * Covers:
 * - Hold a seat, set hold_expires_at into the past via direct SQL UPDATE
 * - A second user can immediately hold the seat without any sweeper background job
 * - GET /api/v1/me/bookings reports the first booking as EXPIRED
 * - Attempting to pay for an expired booking returns 410 HOLD_EXPIRED
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { setupTestDb, cleanDb, closeDb, seedTestShow, testPool } from '../helpers/db.js';
import { mintToken } from '../helpers/tokens.js';

describe('Passive Expiry Integration Tests', () => {
  let testData;
  let user1Token;
  let user2Token;

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await cleanDb();
    testData = await seedTestShow();

    const uRes = await testPool.query(`
      INSERT INTO users (name, email, password_hash)
      VALUES
        ('User Expiry 1', 'expiry1@test.local', 'hash'),
        ('User Expiry 2', 'expiry2@test.local', 'hash')
      RETURNING id
    `);

    user1Token = mintToken({ id: uRes.rows[0].id, name: 'User Expiry 1' });
    user2Token = mintToken({ id: uRes.rows[1].id, name: 'User Expiry 2' });
  });

  afterAll(async () => {
    await closeDb();
  });

  it('allows second user to hold expired seat without sweeper, marks old booking EXPIRED, and rejects payment with 410', async () => {
    const seatId = testData.seatIds[0];

    // 1. User 1 holds seat
    const holdRes = await request(app)
      .post(`/api/v1/shows/${testData.showId}/holds`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ seatIds: [seatId] });

    expect(holdRes.status).toBe(201);
    const bookingId = holdRes.body.booking.id;

    // 2. Fast-forward expiry into the past via direct SQL update
    await testPool.query(`
      UPDATE show_seats
      SET hold_expires_at = now() - interval '10 seconds'
      WHERE show_id = $1 AND seat_id = $2
    `, [testData.showId, seatId]);

    await testPool.query(`
      UPDATE bookings
      SET hold_expires_at = now() - interval '10 seconds'
      WHERE id = $1
    `, [bookingId]);

    // 3. User 2 can now hold the exact same seat immediately (passive query-time expiry)
    const user2HoldRes = await request(app)
      .post(`/api/v1/shows/${testData.showId}/holds`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ seatIds: [seatId] });

    expect(user2HoldRes.status).toBe(201);
    expect(user2HoldRes.body.booking.seats[0].id).toBe(String(seatId));

    // 4. User 1's booking is reported as EXPIRED in /me/bookings
    const meRes = await request(app)
      .get('/api/v1/me/bookings')
      .set('Authorization', `Bearer ${user1Token}`);

    expect(meRes.status).toBe(200);
    const oldBooking = meRes.body.bookings.find((b) => b.id === bookingId);
    expect(oldBooking.displayStatus).toBe('EXPIRED');

    // 5. User 1 attempting to pay for the expired booking returns 410 HOLD_EXPIRED
    const payRes = await request(app)
      .post(`/api/v1/bookings/${bookingId}/pay`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ method: 'MOCK' });

    expect(payRes.status).toBe(410);
    expect(payRes.body.error.code).toBe('HOLD_EXPIRED');
  });
});
