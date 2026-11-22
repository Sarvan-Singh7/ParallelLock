/**
 * payReleaseRace.test.js – Concurrency test for Pay and Release race conditions
 *
 * Verifies regression fix:
 * Previously, sending Pay and Release at the exact same moment could leave the
 * booking CANCELLED while the seats remained BOOKED (corrupted state in 32 of 40 runs).
 *
 * With row-level locking (lockBookingForUpdate) in releaseBooking and conditional updates
 * (WHERE status = 'CREATED'):
 * Exactly one operation wins the state transition. The database state is ALWAYS
 * consistent: either CONFIRMED + BOOKED, or CANCELLED + AVAILABLE.
 * ZERO corruptions across 40 runs.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { setupTestDb, cleanDb, closeDb, seedTestShow, testPool } from '../helpers/db.js';
import { mintToken } from '../helpers/tokens.js';

describe('Pay and Release Race Condition Tests', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  it(
    '40 concurrent pay and release runs produce ZERO corrupted states',
    async () => {
      const RUNS = 40;

      for (let i = 0; i < RUNS; i++) {
        await cleanDb();
        const testData = await seedTestShow();

        const uRes = await testPool.query(`
          INSERT INTO users (name, email, password_hash)
          VALUES ('Racer ${i}', 'racer${i}@test.local', 'hash')
          RETURNING id
        `);
        const token = mintToken({ id: uRes.rows[0].id, name: `Racer ${i}` });

        // 1. Create a hold
        const holdRes = await request(app)
          .post(`/api/v1/shows/${testData.showId}/holds`)
          .set('Authorization', `Bearer ${token}`)
          .send({ seatIds: [testData.seatIds[0]] });

        expect(holdRes.status).toBe(201);
        const bookingId = holdRes.body.booking.id;

        // 2. Fire Pay and Release at the exact same moment
        const payReq = request(app)
          .post(`/api/v1/bookings/${bookingId}/pay`)
          .set('Authorization', `Bearer ${token}`)
          .send({ method: 'MOCK' });

        const releaseReq = request(app)
          .delete(`/api/v1/bookings/${bookingId}`)
          .set('Authorization', `Bearer ${token}`);

        const [payRes, releaseRes] = await Promise.all([payReq, releaseReq]);

        // Verify no 500 internal server errors
        expect(payRes.status).not.toBe(500);
        expect(releaseRes.status).not.toBe(500);

        // Verify database consistency: NO CORRUPTED MIX
        const bRow = await testPool.query(
          'SELECT status FROM bookings WHERE id = $1',
          [bookingId]
        );
        const bookingStatus = bRow.rows[0].status;

        const sRow = await testPool.query(
          'SELECT status FROM show_seats WHERE show_id = $1 AND seat_id = $2',
          [testData.showId, testData.seatIds[0]]
        );
        const seatStatus = sRow.rows[0].status;

        // Invariant:
        // If booking is CONFIRMED -> seat must be BOOKED
        // If booking is CANCELLED -> seat must be AVAILABLE
        if (bookingStatus === 'CONFIRMED') {
          expect(seatStatus).toBe('BOOKED');
        } else if (bookingStatus === 'CANCELLED') {
          expect(seatStatus).toBe('AVAILABLE');
        } else {
          throw new Error(`Unexpected booking status after race: ${bookingStatus}`);
        }
      }
    },
    120_000  // 120-second timeout: 40 sequential iterations each with parallel HTTP requests
  );
});
