/**
 * auditP2M2.test.js – Milestone A0: Audit P2-M2 Concurrency & Crash Recovery Tests
 *
 * Covers:
 * 1. 10 parallel pays on the same booking produce exactly 1 gateway charge (with MOCK_PAYMENT_DELAY_MS)
 * 2. Failed gateway payment reverts booking to CREATED with seats still held
 * 3. DELETE /bookings/:id returns 409 INVALID_STATE while status is PAYMENT_PENDING
 * 4. PAYMENT_PENDING counts as an active hold: prevents second hold on same show (409 ACTIVE_HOLD_EXISTS)
 * 5. Entering PAYMENT_PENDING extends hold by 3 min; seats cannot be stolen by another user after original expiry
 * 6. Lazy crash recovery: stale PAYMENT_PENDING (>2 min) reverts to CREATED (if hold valid) or EXPIRED (if hold expired)
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { setupTestDb, cleanDb, closeDb, seedTestShow, testPool } from '../helpers/db.js';
import { mintToken } from '../helpers/tokens.js';
import { mockStrategy } from '../../src/modules/payment/strategies/mockStrategy.js';
import { env } from '../../src/config/env.js';

describe('Milestone A0: Audit P2-M2 (Payment State & Crash Recovery)', () => {
  let testData;
  let user1Id;
  let user1Token;
  let user2Id;
  let user2Token;

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await cleanDb();
    mockStrategy.resetChargeCount();
    env.MOCK_PAYMENT_FAIL = false;
    env.MOCK_PAYMENT_DELAY_MS = 0;

    testData = await seedTestShow();

    const uRes = await testPool.query(`
      INSERT INTO users (name, email, password_hash)
      VALUES
        ('User One', 'user1@test.local', 'hash'),
        ('User Two', 'user2@test.local', 'hash')
      RETURNING id
    `);

    user1Id = uRes.rows[0].id;
    user2Id = uRes.rows[1].id;
    user1Token = mintToken({ id: user1Id, name: 'User One' });
    user2Token = mintToken({ id: user2Id, name: 'User Two' });
  });

  afterAll(async () => {
    await closeDb();
  });

  it('1. 10 parallel pays give exactly 1 charge under real race window (MOCK_PAYMENT_DELAY_MS=300)', async () => {
    // Hold seats
    const holdRes = await request(app)
      .post(`/api/v1/shows/${testData.showId}/holds`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ seatIds: [testData.seatIds[0]] });

    expect(holdRes.status).toBe(201);
    const bookingId = holdRes.body.booking.id;

    // Introduce 300ms race window to ensure requests truly overlap during gateway execution
    env.MOCK_PAYMENT_DELAY_MS = 300;
    mockStrategy.resetChargeCount();

    const requests = Array.from({ length: 10 }, () =>
      request(app)
        .post(`/api/v1/bookings/${bookingId}/pay`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ method: 'MOCK' })
    );

    const responses = await Promise.all(requests);

    // Reset delay
    env.MOCK_PAYMENT_DELAY_MS = 0;

    // Verify charge count: EXACTLY ONE charge fired
    expect(mockStrategy.getChargeCount()).toBe(1);

    // Verify responses: zero 5xx, exactly 1 winner (200 CONFIRMED), losers receive 409 INVALID_STATE or 200 replayed
    const statuses = responses.map((r) => r.status);
    expect(statuses.every((s) => s === 200 || s === 409)).toBe(true);

    const confirmed = responses.filter((r) => r.status === 200 && r.body.booking?.status === 'CONFIRMED');
    expect(confirmed.length).toBeGreaterThanOrEqual(1);

    // Verify DB state: booking CONFIRMED and seat BOOKED exactly once
    const bRow = await testPool.query('SELECT status, paid_at FROM bookings WHERE id = $1', [bookingId]);
    expect(bRow.rows[0].status).toBe('CONFIRMED');
    expect(bRow.rows[0].paid_at).not.toBeNull();

    const sRow = await testPool.query(
      'SELECT status FROM show_seats WHERE show_id = $1 AND seat_id = $2',
      [testData.showId, testData.seatIds[0]]
    );
    expect(sRow.rows[0].status).toBe('BOOKED');
  });

  it('2. failed payment charge returns booking to CREATED with seats still held', async () => {
    const holdRes = await request(app)
      .post(`/api/v1/shows/${testData.showId}/holds`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ seatIds: [testData.seatIds[0]] });

    const bookingId = holdRes.body.booking.id;

    // Simulate gateway failure
    env.MOCK_PAYMENT_FAIL = true;

    const payRes = await request(app)
      .post(`/api/v1/bookings/${bookingId}/pay`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ method: 'MOCK' });

    expect(payRes.status).toBe(422);

    // Verify DB state reverted to CREATED with seats still HELD
    const bRow = await testPool.query(
      'SELECT status, payment_started_at, hold_expires_at FROM bookings WHERE id = $1',
      [bookingId]
    );
    expect(bRow.rows[0].status).toBe('CREATED');
    expect(bRow.rows[0].payment_started_at).toBeNull();

    const sRow = await testPool.query(
      'SELECT status, booking_id FROM show_seats WHERE show_id = $1 AND seat_id = $2',
      [testData.showId, testData.seatIds[0]]
    );
    expect(sRow.rows[0].status).toBe('HELD');
    expect(String(sRow.rows[0].booking_id)).toBe(String(bookingId));
  });

  it('3. DELETE /bookings/:id returns 409 INVALID_STATE while PAYMENT_PENDING', async () => {
    const holdRes = await request(app)
      .post(`/api/v1/shows/${testData.showId}/holds`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ seatIds: [testData.seatIds[0]] });

    const bookingId = holdRes.body.booking.id;

    // Set status to PAYMENT_PENDING
    await testPool.query(
      `UPDATE bookings
       SET status = 'PAYMENT_PENDING', payment_started_at = now()
       WHERE id = $1`,
      [bookingId]
    );

    const delRes = await request(app)
      .delete(`/api/v1/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${user1Token}`);

    expect(delRes.status).toBe(409);
    expect(delRes.body.error.code).toBe('INVALID_STATE');
    expect(delRes.body.error.message).toMatch(/cannot release booking while payment is processing/i);
  });

  it('4. PAYMENT_PENDING counts as active booking and blocks second hold on same show', async () => {
    const holdRes = await request(app)
      .post(`/api/v1/shows/${testData.showId}/holds`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ seatIds: [testData.seatIds[0]] });

    const bookingId = holdRes.body.booking.id;

    // Flip to PAYMENT_PENDING
    await testPool.query(
      `UPDATE bookings
       SET status = 'PAYMENT_PENDING', payment_started_at = now()
       WHERE id = $1`,
      [bookingId]
    );

    // User 1 tries to hold a second seat on the same show
    const secondHoldRes = await request(app)
      .post(`/api/v1/shows/${testData.showId}/holds`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ seatIds: [testData.seatIds[1]] });

    expect(secondHoldRes.status).toBe(409);
    expect(secondHoldRes.body.error.code).toBe('ACTIVE_HOLD_EXISTS');
  });

  it('5. user A pays near end of hold; user B tries to hold same seats after original expiry and gets 409', async () => {
    // User A holds seat
    const holdRes = await request(app)
      .post(`/api/v1/shows/${testData.showId}/holds`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ seatIds: [testData.seatIds[0]] });

    const bookingId = holdRes.body.booking.id;

    // Simulate User A starting payment: enters PAYMENT_PENDING (hold extended by 3 min)
    // To test edge case: set original hold to past, but PAYMENT_PENDING within 2 minutes
    await testPool.query(
      `UPDATE bookings
       SET status = 'PAYMENT_PENDING',
           payment_started_at = now(),
           hold_expires_at = now() - interval '5 seconds'
       WHERE id = $1`,
      [bookingId]
    );
    await testPool.query(
      `UPDATE show_seats
       SET hold_expires_at = now() - interval '5 seconds'
       WHERE show_id = $1 AND booking_id = $2`,
      [testData.showId, bookingId]
    );

    // User B attempts to hold the same seat after original expiry
    const userBHoldRes = await request(app)
      .post(`/api/v1/shows/${testData.showId}/holds`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ seatIds: [testData.seatIds[0]] });

    // Must be rejected with 409 SEAT_UNAVAILABLE because booking is actively PAYMENT_PENDING
    expect(userBHoldRes.status).toBe(409);
    expect(userBHoldRes.body.error.code).toBe('SEAT_UNAVAILABLE');
    expect(userBHoldRes.body.error.details.unavailableSeatIds).toEqual([testData.seatIds[0]]);
  });

  it('6a. lazy crash recovery: stale PAYMENT_PENDING (>2 min) with valid hold reverts to CREATED', async () => {
    const holdRes = await request(app)
      .post(`/api/v1/shows/${testData.showId}/holds`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ seatIds: [testData.seatIds[0]] });

    const bookingId = holdRes.body.booking.id;

    // Simulate crash: PAYMENT_PENDING started 3 minutes ago, but hold still valid for 5 more minutes
    await testPool.query(
      `UPDATE bookings
       SET status = 'PAYMENT_PENDING',
           payment_started_at = now() - interval '3 minutes',
           hold_expires_at = now() + interval '5 minutes'
       WHERE id = $1`,
      [bookingId]
    );

    // User reads booking
    const getRes = await request(app)
      .get(`/api/v1/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${user1Token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.booking.status).toBe('CREATED');
    expect(getRes.body.booking.displayStatus).toBe('ACTIVE_HOLD');

    // Verify DB update
    const bRow = await testPool.query(
      'SELECT status, payment_started_at FROM bookings WHERE id = $1',
      [bookingId]
    );
    expect(bRow.rows[0].status).toBe('CREATED');
    expect(bRow.rows[0].payment_started_at).toBeNull();
  });

  it('6b. lazy crash recovery: stale PAYMENT_PENDING (>2 min) with expired hold marks EXPIRED & releases seats', async () => {
    const holdRes = await request(app)
      .post(`/api/v1/shows/${testData.showId}/holds`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ seatIds: [testData.seatIds[0]] });

    const bookingId = holdRes.body.booking.id;

    // Simulate crash: PAYMENT_PENDING started 3 minutes ago AND hold has expired
    await testPool.query(
      `UPDATE bookings
       SET status = 'PAYMENT_PENDING',
           payment_started_at = now() - interval '3 minutes',
           hold_expires_at = now() - interval '10 seconds'
       WHERE id = $1`,
      [bookingId]
    );
    await testPool.query(
      `UPDATE show_seats
       SET hold_expires_at = now() - interval '10 seconds'
       WHERE show_id = $1 AND booking_id = $2`,
      [testData.showId, bookingId]
    );

    // User reads booking
    const getRes = await request(app)
      .get(`/api/v1/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${user1Token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.booking.status).toBe('EXPIRED');
    expect(getRes.body.booking.displayStatus).toBe('EXPIRED');

    // Verify seats released back to AVAILABLE
    const sRow = await testPool.query(
      'SELECT status, booking_id, hold_expires_at FROM show_seats WHERE show_id = $1 AND seat_id = $2',
      [testData.showId, testData.seatIds[0]]
    );
    expect(sRow.rows[0].status).toBe('AVAILABLE');
    expect(sRow.rows[0].booking_id).toBeNull();
  });
});
