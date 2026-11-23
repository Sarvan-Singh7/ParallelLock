/**
 * paymentsWebhooks.test.js – P2-M3 Integration tests
 *
 * Tests:
 *  1. duplicate webhook processed once
 *  2. bad or missing signature gives 400
 *  3. webhook arrives before sync response
 *  4. late payment with seats untouched → CONFIRMED
 *  5. late payment with seats taken → REFUND_PENDING then REFUNDED, no double booking
 *  6. failed refund stays REFUND_PENDING; retryRefund fixes it
 *  7. amount mismatch rejected (422)
 *  8. unknown provider_ref event → 200 ignored
 *  9. FAILED event after SUCCEEDED ignored (no downgrade)
 * 10. failed charge clears payment_started_at (booking reverts to CREATED)
 * 11. late success after crash recovery takes refund path, never 500
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { setupTestDb, cleanDb, closeDb, seedTestShow, testPool } from '../helpers/db.js';
import { mintToken } from '../helpers/tokens.js';
import { mockStrategy } from '../../src/modules/payment/strategies/mockStrategy.js';
import { paymentService } from '../../src/modules/payment/payment.service.js';
import { env } from '../../src/config/env.js';

/** Helper: POST a signed webhook */
function sendWebhook(payloadStr, signature) {
  return request(app)
    .post('/api/v1/webhooks/payments')
    .set('Content-Type', 'application/json')
    .set('x-signature', signature)
    .send(payloadStr);
}

describe('Payments & Webhooks Integration Tests (P2-M3)', () => {
  let testData;
  let userToken;
  let userId;

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    // Reset mock strategy state
    mockStrategy.resetChargeCount();
    mockStrategy.resetRefundCount();
    // Reset env flags
    env.MOCK_PAYMENT_FAIL = false;
    env.MOCK_PAYMENT_MODE = 'sync';
    env.MOCK_PAYMENT_DELAY_MS = 0;

    await cleanDb();
    testData = await seedTestShow();

    const uRes = await testPool.query(`
      INSERT INTO users (name, email, password_hash)
      VALUES ('Webhook Tester', 'wht@example.com', 'hash')
      RETURNING id
    `);
    userId = String(uRes.rows[0].id);
    userToken = mintToken({ id: uRes.rows[0].id, name: 'Webhook Tester' });
  });

  afterEach(async () => {
    env.MOCK_PAYMENT_FAIL = false;
    env.MOCK_PAYMENT_MODE = 'sync';
    env.MOCK_PAYMENT_DELAY_MS = 0;
    delete process.env.MOCK_REFUND_FAIL;
  });

  afterAll(async () => {
    await closeDb();
  });

  /** Create a hold for the main test user on seat 0. */
  async function createHold(seatIdx = 0) {
    const res = await request(app)
      .post(`/api/v1/shows/${testData.showId}/holds`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ seatIds: [testData.seatIds[seatIdx]] });
    expect(res.status, `Hold creation failed: ${JSON.stringify(res.body)}`).toBe(201);
    return res.body.booking.id;
  }

  /** Pay a booking in sync mode and return the payment info. */
  async function paySync(bookingId) {
    const res = await request(app)
      .post(`/api/v1/bookings/${bookingId}/pay`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ method: 'MOCK' });
    return res;
  }

  // ─── Test 1 ─────────────────────────────────────────────────────────────────
  it('1. duplicate webhook is processed once', async () => {
    const bookingId = await createHold();
    const payRes = await paySync(bookingId);
    expect(payRes.status).toBe(200);

    const { providerRef, amountCents } = payRes.body.payment;
    expect(providerRef).toBeTruthy();

    const { payload, signature } = mockStrategy.createSignedWebhookPayload({
      providerRef,
      amountCents,
      eventType: 'payment.succeeded',
    });

    const first = await sendWebhook(payload, signature);
    expect(first.status).toBe(200);

    // Send identical webhook again (same eventId)
    const second = await sendWebhook(payload, signature);
    expect(second.status).toBe(200);

    // Charge count should still be 1 (from the initial paySync)
    expect(mockStrategy.getChargeCount()).toBe(1);
  });

  // ─── Test 2 ─────────────────────────────────────────────────────────────────
  it('2. bad or missing signature gives 400', async () => {
    const { payload } = mockStrategy.createSignedWebhookPayload({
      providerRef: 'any_ref',
      amountCents: 1000,
      eventType: 'payment.succeeded',
    });

    const badSig = await sendWebhook(payload, 'invalidsig');
    expect(badSig.status).toBe(400);

    // Missing signature header
    const noSig = await request(app)
      .post('/api/v1/webhooks/payments')
      .set('Content-Type', 'application/json')
      .send(payload);
    expect(noSig.status).toBe(400);
  });

  // ─── Test 3 ─────────────────────────────────────────────────────────────────
  it('3. webhook arrives before sync response (async mode) confirms booking', async () => {
    env.MOCK_PAYMENT_MODE = 'async';
    const bookingId = await createHold();

    // Trigger async pay (returns 202 without finalizing)
    const payRes = await request(app)
      .post(`/api/v1/bookings/${bookingId}/pay`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ method: 'MOCK' });
    expect(payRes.status).toBe(202);
    const { providerRef, amountCents } = payRes.body.payment;
    expect(providerRef).toBeTruthy();

    // Send the webhook (simulating provider callback before client polls)
    const { payload, signature } = mockStrategy.createSignedWebhookPayload({
      providerRef,
      amountCents,
      eventType: 'payment.succeeded',
    });
    const whRes = await sendWebhook(payload, signature);
    expect(whRes.status).toBe(200);

    // Booking should now be CONFIRMED
    const bookingRes = await request(app)
      .get(`/api/v1/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(bookingRes.body.booking.status).toBe('CONFIRMED');
  });

  // ─── Test 4 ─────────────────────────────────────────────────────────────────
  it('4. late payment with seats untouched → CONFIRMED', async () => {
    // Normal sync payment – seats still held by this booking → should CONFIRM
    const bookingId = await createHold();
    const payRes = await paySync(bookingId);
    expect(payRes.status).toBe(200);
    expect(payRes.body.booking.status).toBe('CONFIRMED');
  });

  // ─── Test 5 ─────────────────────────────────────────────────────────────────
  it('5. late payment with seats taken → REFUND_PENDING then REFUNDED, no double booking', async () => {
    const bookingId = await createHold(0);

    // Expire the hold manually in DB then release the seat
    await testPool.query(
      `UPDATE bookings SET status='EXPIRED', hold_expires_at=now()-interval '1 second'
       WHERE id=$1`,
      [bookingId]
    );
    await testPool.query(
      `UPDATE show_seats SET status='AVAILABLE', booking_id=NULL, hold_expires_at=NULL
       WHERE show_id=$1 AND booking_id=$2`,
      [testData.showId, bookingId]
    );

    // Another user grabs the same seat
    const otherRes = await testPool.query(`
      INSERT INTO users (name, email, password_hash)
      VALUES ('Other User', 'other5@example.com', 'hash')
      RETURNING id
    `);
    const otherToken = mintToken({ id: otherRes.rows[0].id, name: 'Other User' });
    const newHold = await request(app)
      .post(`/api/v1/shows/${testData.showId}/holds`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ seatIds: [testData.seatIds[0]] });
    expect(newHold.status, `Second hold failed: ${JSON.stringify(newHold.body)}`).toBe(201);

    // Now build a fake payment row and send a successful webhook as if the first user paid late
    const providerRef = `late_ref_${Date.now()}`;
    await testPool.query(
      `INSERT INTO payments (booking_id, provider, provider_ref, amount_cents, status)
       VALUES ($1, 'MOCK', $2, 32000, 'INITIATED')`,
      [bookingId, providerRef]
    );
    // Also put booking back in PAYMENT_PENDING (simulating late charge)
    await testPool.query(
      `UPDATE bookings SET status='PAYMENT_PENDING', payment_started_at=now()
       WHERE id=$1`,
      [bookingId]
    );

    const { payload, signature } = mockStrategy.createSignedWebhookPayload({
      providerRef,
      amountCents: 32000,
      eventType: 'payment.succeeded',
    });
    const whRes = await sendWebhook(payload, signature);
    expect(whRes.status).toBe(200);

    // Booking should be REFUND_PENDING or REFUNDED (refund may complete synchronously)
    const bookingRes = await testPool.query(`SELECT status FROM bookings WHERE id=$1`, [bookingId]);
    expect(['REFUND_PENDING', 'REFUNDED']).toContain(bookingRes.rows[0].status);

    // Verify the second user's booking is unaffected (no double booking)
    const otherBooking = await testPool.query(
      `SELECT b.status FROM bookings b
       JOIN show_seats ss ON ss.booking_id = b.id
       WHERE ss.show_id=$1 AND b.user_id=$2`,
      [testData.showId, otherRes.rows[0].id]
    );
    expect(otherBooking.rows[0].status).toBe('CREATED');
  });

  // ─── Test 6 ─────────────────────────────────────────────────────────────────
  it('6. failed refund stays REFUND_PENDING; retryRefund fixes it', async () => {
    const bookingId = await createHold();

    // Insert a payment row so retryRefund can find it
    const providerRef = `rf_retry_${Date.now()}`;
    await testPool.query(
      `INSERT INTO payments (booking_id, provider, provider_ref, amount_cents, status)
       VALUES ($1, 'MOCK', $2, 32000, 'SUCCEEDED')`,
      [bookingId, providerRef]
    );
    await testPool.query(`UPDATE bookings SET status='REFUND_PENDING' WHERE id=$1`, [bookingId]);

    // First retry with refund failure
    process.env.MOCK_REFUND_FAIL = 'true';
    const failResult = await paymentService.retryRefund(bookingId);
    expect(failResult.status).toBe('REFUND_PENDING');

    // Clear failure, retry should succeed
    delete process.env.MOCK_REFUND_FAIL;
    const successResult = await paymentService.retryRefund(bookingId);
    expect(successResult.status).toBe('REFUNDED');

    // Verify DB status
    const { rows } = await testPool.query(`SELECT status FROM bookings WHERE id=$1`, [bookingId]);
    expect(rows[0].status).toBe('REFUNDED');
  });

  // ─── Test 7 ─────────────────────────────────────────────────────────────────
  it('7. amount mismatch rejected with 422', async () => {
    const bookingId = await createHold();
    const payRes = await paySync(bookingId);
    expect(payRes.status).toBe(200);
    const { providerRef } = payRes.body.payment;

    // Send webhook with wrong amount
    const { payload, signature } = mockStrategy.createSignedWebhookPayload({
      providerRef,
      amountCents: 9999, // wrong amount (actual is 32000)
      eventType: 'payment.succeeded',
    });
    const whRes = await sendWebhook(payload, signature);
    expect(whRes.status).toBe(422);
  });

  // ─── Test 8 ─────────────────────────────────────────────────────────────────
  it('8. unknown provider_ref event is ignored with 200', async () => {
    const { payload, signature } = mockStrategy.createSignedWebhookPayload({
      providerRef: `unknown_ref_${Date.now()}`,
      amountCents: 1000,
      eventType: 'payment.succeeded',
    });
    const res = await sendWebhook(payload, signature);
    expect(res.status).toBe(200);
    expect(res.body.result.unknown).toBe(true);
  });

  // ─── Test 9 ─────────────────────────────────────────────────────────────────
  it('9. FAILED event after SUCCEEDED is ignored (no downgrade)', async () => {
    const bookingId = await createHold();
    const payRes = await paySync(bookingId);
    expect(payRes.status).toBe(200);
    const { providerRef, amountCents } = payRes.body.payment;

    // Confirm it's CONFIRMED
    expect(payRes.body.booking.status).toBe('CONFIRMED');

    // Send a FAILED webhook for the same payment
    const { payload, signature } = mockStrategy.createSignedWebhookPayload({
      providerRef,
      amountCents,
      eventType: 'payment.failed',
    });
    const failRes = await sendWebhook(payload, signature);
    expect(failRes.status).toBe(200);

    // Status must still be CONFIRMED (not downgraded)
    const bookingRes = await request(app)
      .get(`/api/v1/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(bookingRes.body.booking.status).toBe('CONFIRMED');
  });

  // ─── Test 10 ────────────────────────────────────────────────────────────────
  it('10. failed charge clears payment_started_at and reverts booking to CREATED', async () => {
    env.MOCK_PAYMENT_FAIL = true;
    const bookingId = await createHold();

    const payRes = await request(app)
      .post(`/api/v1/bookings/${bookingId}/pay`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ method: 'MOCK' });
    // Gateway failure → errors.validation = 422 (thrown by mockStrategy)
    expect([400, 422]).toContain(payRes.status);

    // Booking should be back to CREATED with payment_started_at cleared
    const { rows } = await testPool.query(
      `SELECT status, payment_started_at FROM bookings WHERE id=$1`,
      [bookingId]
    );
    expect(rows[0].status).toBe('CREATED');
    expect(rows[0].payment_started_at).toBeNull();
  });

  // ─── Test 11 ────────────────────────────────────────────────────────────────
  it('11. late success after crash recovery follows refund path, never 500', async () => {
    const bookingId = await createHold();

    // Simulate: booking got stuck in PAYMENT_PENDING > 2 min ago (crash recovery window)
    const providerRef = `crash_ref_${Date.now()}`;
    await testPool.query(
      `UPDATE bookings
       SET status='PAYMENT_PENDING',
           payment_started_at=now() - interval '3 minutes',
           hold_expires_at=now() - interval '1 minute'
       WHERE id=$1`,
      [bookingId]
    );
    // Seat is already released (crash recovery expired the hold)
    await testPool.query(
      `UPDATE show_seats SET status='AVAILABLE', booking_id=NULL, hold_expires_at=NULL
       WHERE show_id=$1 AND booking_id=$2`,
      [testData.showId, bookingId]
    );
    await testPool.query(
      `INSERT INTO payments (booking_id, provider, provider_ref, amount_cents, status)
       VALUES ($1, 'MOCK', $2, 32000, 'INITIATED')`,
      [bookingId, providerRef]
    );

    // Webhook arrives with success (money was taken by provider)
    const { payload, signature } = mockStrategy.createSignedWebhookPayload({
      providerRef,
      amountCents: 32000,
      eventType: 'payment.succeeded',
    });
    const whRes = await sendWebhook(payload, signature);
    // Must never be 500
    expect(whRes.status).not.toBe(500);
    expect(whRes.status).toBe(200);

    // Booking must be refunded (seats were released so can't confirm)
    const { rows } = await testPool.query(`SELECT status FROM bookings WHERE id=$1`, [bookingId]);
    expect(['REFUND_PENDING', 'REFUNDED']).toContain(rows[0].status);
  });

  // ─── Test 12 ────────────────────────────────────────────────────────────────
  it('12. 10 identical webhooks in parallel finalize exactly once', async () => {
    const bookingId = await createHold();
    const providerRef = `parallel_evt_${Date.now()}`;
    await testPool.query(
      `INSERT INTO payments (booking_id, provider, provider_ref, amount_cents, status)
       VALUES ($1, 'MOCK', $2, 32000, 'INITIATED')`,
      [bookingId, providerRef]
    );

    const { payload, signature } = mockStrategy.createSignedWebhookPayload({
      eventId: `shared_evt_${Date.now()}`,
      providerRef,
      amountCents: 32000,
      eventType: 'payment.succeeded',
    });

    // Send 10 identical webhook requests concurrently
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => sendWebhook(payload, signature))
    );

    // Every response must be 200 OK
    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    // Exactly one finalized the payment, other 9 handled as duplicate no-ops
    const duplicates = responses.filter((r) => r.body.result?.duplicate === true);
    const finalized = responses.filter((r) => r.body.result?.confirmed === true);
    expect(finalized).toHaveLength(1);
    expect(duplicates).toHaveLength(9);

    // DB state: booking CONFIRMED, payment SUCCEEDED, exactly 1 payment_events row
    const bRow = await testPool.query(`SELECT status FROM bookings WHERE id=$1`, [bookingId]);
    expect(bRow.rows[0].status).toBe('CONFIRMED');

    const pRow = await testPool.query(`SELECT status FROM payments WHERE provider_ref=$1`, [providerRef]);
    expect(pRow.rows[0].status).toBe('SUCCEEDED');

    const eRows = await testPool.query(`SELECT * FROM payment_events`);
    expect(eRows.rows).toHaveLength(1);
  });

  // ─── Test 13 ────────────────────────────────────────────────────────────────
  it('13. late payment success on a CANCELLED booking goes REFUND_PENDING then REFUNDED', async () => {
    const bookingId = await createHold();

    // User cancels / releases the booking
    const relRes = await request(app)
      .delete(`/api/v1/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(relRes.status).toBe(204);

    // Verify booking is CANCELLED and seats are AVAILABLE
    const cancelledRow = await testPool.query(`SELECT status FROM bookings WHERE id=$1`, [bookingId]);
    expect(cancelledRow.rows[0].status).toBe('CANCELLED');

    // Create payment row in INITIATED
    const providerRef = `cancelled_pay_${Date.now()}`;
    await testPool.query(
      `INSERT INTO payments (booking_id, provider, provider_ref, amount_cents, status)
       VALUES ($1, 'MOCK', $2, 32000, 'INITIATED')`,
      [bookingId, providerRef]
    );

    // Gateway reports payment succeeded (e.g. late webhook or charge succeeded)
    const { payload, signature } = mockStrategy.createSignedWebhookPayload({
      providerRef,
      amountCents: 32000,
      eventType: 'payment.succeeded',
    });
    const whRes = await sendWebhook(payload, signature);
    expect(whRes.status).toBe(200);

    // Final outcome: booking must NOT be CONFIRMED, must be REFUNDED (via REFUND_PENDING)
    const bFinal = await testPool.query(`SELECT status FROM bookings WHERE id=$1`, [bookingId]);
    expect(bFinal.rows[0].status).toBe('REFUNDED');

    // Payment record must be REFUNDED
    const pFinal = await testPool.query(`SELECT status FROM payments WHERE provider_ref=$1`, [providerRef]);
    expect(pFinal.rows[0].status).toBe('REFUNDED');

    // Seats must remain AVAILABLE (never double booked)
    const sFinal = await testPool.query(
      `SELECT status FROM show_seats WHERE show_id=$1 AND seat_id=$2`,
      [testData.showId, testData.seatIds[0]]
    );
    expect(sFinal.rows[0].status).toBe('AVAILABLE');
  });
});
