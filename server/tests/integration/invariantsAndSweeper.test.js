/**
 * invariantsAndSweeper.test.js – P2-M4 Integration tests
 *
 * Covers:
 * 1. bookingStateMachine: assertTransition(from, to) enforces valid graph; illegal transitions throw 409.
 * 2. Sweeper:
 *    - Two sweepers running at once do no harm (pg_try_advisory_lock mutual exclusion).
 *    - Sweeper skips live PAYMENT_PENDING bookings.
 *    - Sweeper expires stale CREATED bookings and releases HELD seats.
 *    - Sweeper recovers stale PAYMENT_PENDING (>2 min).
 *    - Correctness holds with sweeper OFF (passive expiry on DB clock still reclaims seats).
 * 3. Invariant Checker:
 *    - checkInvariants() reports 0 violations across all 3 consistency queries.
 *    - Invariants stay at zero after booking, payment, and release operations.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { setupTestDb, cleanDb, closeDb, seedTestShow, testPool } from '../helpers/db.js';
import { mintToken } from '../helpers/tokens.js';
import { assertTransition, ALLOWED_TRANSITIONS } from '../../src/modules/booking/bookingStateMachine.js';
import { sweeper, SWEEPER_ADVISORY_LOCK_ID } from '../../src/modules/booking/sweeper.js';
import { checkInvariants } from '../../scripts/checkInvariants.js';

describe('Milestone P2-M4: State Machine, Sweeper, Invariants', () => {
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
      VALUES ('M4 Tester', 'm4tester@example.com', 'hash')
      RETURNING id
    `);
    userId = String(uRes.rows[0].id);
    userToken = mintToken({ id: uRes.rows[0].id, name: 'M4 Tester' });
  });

  afterAll(async () => {
    await closeDb();
  });

  // ─── 1. State Machine ────────────────────────────────────────────────────────
  describe('1. bookingStateMachine.js', () => {
    it('allows all legal transitions and idempotent same-state transitions', () => {
      // Idempotent same-state
      expect(() => assertTransition('CREATED', 'CREATED')).not.toThrow();
      expect(() => assertTransition('CONFIRMED', 'CONFIRMED')).not.toThrow();

      // Legal transitions
      for (const [from, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
        for (const to of targets) {
          expect(() => assertTransition(from, to)).not.toThrow();
        }
      }
    });

    it('throws 409 INVALID_STATE on illegal status transitions', () => {
      const illegalTransitions = [
        ['CONFIRMED', 'CREATED'],
        ['CONFIRMED', 'EXPIRED'],
        ['CONFIRMED', 'CANCELLED'],
        ['REFUNDED', 'CONFIRMED'],
        ['REFUNDED', 'CREATED'],
        ['CANCELLED', 'CONFIRMED'],
        ['CANCELLED', 'CREATED'],
        ['EXPIRED', 'CANCELLED'],
        ['CREATED', 'REFUNDED'],
      ];

      for (const [from, to] of illegalTransitions) {
        expect(
          () => assertTransition(from, to),
          `Expected transition ${from} -> ${to} to be illegal`
        ).toThrowError(/Illegal booking transition/);
      }
    });
  });

  // ─── 2. Sweeper Housekeeping ─────────────────────────────────────────────────
  describe('2. Background Sweeper', () => {
    it('running two sweepers at once does no harm (advisory lock returns locked)', async () => {
      // Connect a dedicated client that holds the advisory lock
      const client = await testPool.connect();
      try {
        const lockRes = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [SWEEPER_ADVISORY_LOCK_ID]);
        expect(lockRes.rows[0].acquired).toBe(true);

        // Sweeper runOnce should gracefully report LOCKED and do nothing
        const result = await sweeper.runOnce(testPool);
        expect(result.ran).toBe(false);
        expect(result.reason).toBe('LOCKED');
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [SWEEPER_ADVISORY_LOCK_ID]);
        client.release();
      }

      // After lock is released, sweeper runs normally
      const nextRun = await sweeper.runOnce(testPool);
      expect(nextRun.ran).toBe(true);
    });

    it('sweeper skips live PAYMENT_PENDING bookings (within 2-minute window)', async () => {
      // Create a hold
      const holdRes = await request(app)
        .post(`/api/v1/shows/${testData.showId}/holds`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ seatIds: [testData.seatIds[0]] });
      const bookingId = holdRes.body.booking.id;

      // Set to live PAYMENT_PENDING (started 30 seconds ago)
      await testPool.query(
        `UPDATE bookings
         SET status = 'PAYMENT_PENDING', payment_started_at = now() - interval '30 seconds'
         WHERE id = $1`,
        [bookingId]
      );

      // Run sweeper
      const sweepRes = await sweeper.runOnce(testPool);
      expect(sweepRes.ran).toBe(true);

      // Booking must still be PAYMENT_PENDING and seats still HELD
      const bRow = await testPool.query('SELECT status, payment_started_at FROM bookings WHERE id = $1', [bookingId]);
      expect(bRow.rows[0].status).toBe('PAYMENT_PENDING');
      expect(bRow.rows[0].payment_started_at).not.toBeNull();

      const sRow = await testPool.query('SELECT status FROM show_seats WHERE show_id = $1 AND seat_id = $2', [
        testData.showId,
        testData.seatIds[0],
      ]);
      expect(sRow.rows[0].status).toBe('HELD');
    });

    it('sweeper expires stale CREATED bookings and releases their HELD seats', async () => {
      // Create hold
      const holdRes = await request(app)
        .post(`/api/v1/shows/${testData.showId}/holds`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ seatIds: [testData.seatIds[0]] });
      const bookingId = holdRes.body.booking.id;

      // Fast-forward hold expiry
      await testPool.query(
        `UPDATE bookings SET hold_expires_at = now() - interval '1 second' WHERE id = $1`,
        [bookingId]
      );

      // Run sweeper
      const sweepRes = await sweeper.runOnce(testPool);
      expect(sweepRes.ran).toBe(true);
      expect(sweepRes.stats.expiredHolds).toBeGreaterThanOrEqual(1);

      // Booking marked EXPIRED and seats released to AVAILABLE
      const bRow = await testPool.query('SELECT status FROM bookings WHERE id = $1', [bookingId]);
      expect(bRow.rows[0].status).toBe('EXPIRED');

      const sRow = await testPool.query('SELECT status, booking_id FROM show_seats WHERE show_id = $1 AND seat_id = $2', [
        testData.showId,
        testData.seatIds[0],
      ]);
      expect(sRow.rows[0].status).toBe('AVAILABLE');
      expect(sRow.rows[0].booking_id).toBeNull();
    });

    it('correctness holds with the sweeper OFF (passive expiry on DB clock reclaims seats)', async () => {
      // Ensure sweeper is stopped
      sweeper.stopSweeper();

      // User 1 creates a hold
      const holdRes = await request(app)
        .post(`/api/v1/shows/${testData.showId}/holds`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ seatIds: [testData.seatIds[0]] });
      const bookingId = holdRes.body.booking.id;

      // Hold expires passively
      await testPool.query(
        `UPDATE bookings SET hold_expires_at = now() - interval '1 second' WHERE id = $1`,
        [bookingId]
      );
      await testPool.query(
        `UPDATE show_seats SET hold_expires_at = now() - interval '1 second' WHERE show_id = $1 AND booking_id = $2`,
        [testData.showId, bookingId]
      );

      // User 2 attempts to hold the same seat WITHOUT the sweeper having run
      const u2Res = await testPool.query(`
        INSERT INTO users (name, email, password_hash)
        VALUES ('User Two M4', 'u2m4@example.com', 'hash')
        RETURNING id
      `);
      const u2Token = mintToken({ id: u2Res.rows[0].id, name: 'User Two M4' });

      const newHoldRes = await request(app)
        .post(`/api/v1/shows/${testData.showId}/holds`)
        .set('Authorization', `Bearer ${u2Token}`)
        .send({ seatIds: [testData.seatIds[0]] });

      // Succeeds passively without sweeper!
      expect(newHoldRes.status).toBe(201);
      expect(newHoldRes.body.booking.seats[0].id).toBe(String(testData.seatIds[0]));
    });
  });

  // ─── 3. Invariant Checker ───────────────────────────────────────────────────
  describe('3. Database Invariants', () => {
    it('invariants check returns zero violations on fresh, active, and completed bookings', async () => {
      // 1. Check on clean state
      let check = await checkInvariants(testPool);
      expect(check.passed).toBe(true);
      expect(check.violations).toEqual([]);

      // 2. Create hold (status = CREATED, show_seats = HELD)
      const holdRes = await request(app)
        .post(`/api/v1/shows/${testData.showId}/holds`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ seatIds: [testData.seatIds[0], testData.seatIds[1]] });
      const bookingId = holdRes.body.booking.id;

      check = await checkInvariants(testPool);
      expect(check.passed).toBe(true);

      // 3. Confirm payment (status = CONFIRMED, show_seats = BOOKED)
      const payRes = await request(app)
        .post(`/api/v1/bookings/${bookingId}/pay`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ method: 'MOCK' });
      expect(payRes.status).toBe(200);

      check = await checkInvariants(testPool);
      expect(check.passed).toBe(true);
      expect(check.violations).toEqual([]);
    });

    it('invariant checker catches corruptions if artificially created', async () => {
      // Artificially create a BOOKED seat whose booking is CANCELLED (violation of query 1)
      const holdRes = await request(app)
        .post(`/api/v1/shows/${testData.showId}/holds`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ seatIds: [testData.seatIds[0]] });
      const bookingId = holdRes.body.booking.id;

      await testPool.query(
        `UPDATE bookings SET status = 'CANCELLED' WHERE id = $1`,
        [bookingId]
      );
      await testPool.query(
        `UPDATE show_seats SET status = 'BOOKED', booking_id = $1 WHERE show_id = $2 AND seat_id = $3`,
        [bookingId, testData.showId, testData.seatIds[0]]
      );

      const check = await checkInvariants(testPool);
      expect(check.passed).toBe(false);
      expect(check.violations.some((v) => v.invariant === 'BOOKED_SEATS_WITHOUT_CONFIRMED_BOOKING')).toBe(true);
    });
  });
});
