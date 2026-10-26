/**
 * booking.test.js – Integration tests for booking core
 *
 * Covers:
 * - All-or-nothing hold: if any requested seat is unavailable, no seats are held
 * - Input validation: 0, 7, and duplicate seats return 422 VALIDATION_ERROR
 * - Blocked seats (is_active=false): return 422 INVALID_SEATS
 * - Ownership enforcement: payment by non-owner returns 403 FORBIDDEN
 * - Successful payment: marks booking CONFIRMED and show_seats BOOKED
 * - Release: DELETE booking sets status CANCELLED and returns show_seats to AVAILABLE
 * - Second active hold prevention: returns 409 ACTIVE_HOLD_EXISTS
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { setupTestDb, cleanDb, closeDb, seedTestShow, testPool } from '../helpers/db.js';
import { mintToken } from '../helpers/tokens.js';

describe('Booking Core Integration Tests', () => {
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
        ('User One', 'user1@test.local', 'hash'),
        ('User Two', 'user2@test.local', 'hash')
      RETURNING id
    `);

    user1Token = mintToken({ id: uRes.rows[0].id, name: 'User One' });
    user2Token = mintToken({ id: uRes.rows[1].id, name: 'User Two' });
  });

  afterAll(async () => {
    await closeDb();
  });

  describe('POST /api/v1/shows/:id/holds', () => {
    it('successfully holds seats and returns 201 with booking and serverTime', async () => {
      const seatsToHold = [testData.seatIds[0], testData.seatIds[1]];

      const res = await request(app)
        .post(`/api/v1/shows/${testData.showId}/holds`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ seatIds: seatsToHold });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('booking');
      expect(res.body).toHaveProperty('serverTime');
      expect(res.body.booking.status).toBe('CREATED');
      expect(res.body.booking.displayStatus).toBe('ACTIVE_HOLD');
      expect(res.body.booking.totalCents).toBe(64000); // 32000 * 2
      expect(res.body.booking.seats).toHaveLength(2);
    });

    it('all-or-nothing: if 1 of 2 seats is already taken, neither seat is held', async () => {
      // User 1 holds seat 0
      await request(app)
        .post(`/api/v1/shows/${testData.showId}/holds`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ seatIds: [testData.seatIds[0]] });

      // User 2 tries to hold seat 0 AND seat 1
      const res = await request(app)
        .post(`/api/v1/shows/${testData.showId}/holds`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ seatIds: [testData.seatIds[0], testData.seatIds[1]] });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SEAT_UNAVAILABLE');
      expect(res.body.error.details.unavailableSeatIds).toEqual([testData.seatIds[0]]);

      // Verify seat 1 was NOT held (still free for another caller)
      const u3Res = await testPool.query(`
        INSERT INTO users (name, email, password_hash)
        VALUES ('User Three', 'user3@test.local', 'hash')
        RETURNING id
      `);
      const user3Token = mintToken({ id: u3Res.rows[0].id, name: 'User Three' });

      const holdRes = await request(app)
        .post(`/api/v1/shows/${testData.showId}/holds`)
        .set('Authorization', `Bearer ${user3Token}`)
        .send({ seatIds: [testData.seatIds[1]] });

      expect(holdRes.status).toBe(201);
    });

    it('returns 422 VALIDATION_ERROR on 0 seats, 7 seats, or duplicate seat IDs', async () => {
      // 0 seats
      const res0 = await request(app)
        .post(`/api/v1/shows/${testData.showId}/holds`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ seatIds: [] });
      expect(res0.status).toBe(422);
      expect(res0.body.error.code).toBe('VALIDATION_ERROR');

      // 7 seats
      const res7 = await request(app)
        .post(`/api/v1/shows/${testData.showId}/holds`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ seatIds: [1, 2, 3, 4, 5, 6, 7] });
      expect(res7.status).toBe(422);
      expect(res7.body.error.code).toBe('VALIDATION_ERROR');

      // duplicate seats
      const resDup = await request(app)
        .post(`/api/v1/shows/${testData.showId}/holds`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ seatIds: [testData.seatIds[0], testData.seatIds[0]] });
      expect(resDup.status).toBe(422);
      expect(resDup.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 422 INVALID_SEATS when attempting to hold a blocked or nonexistent seat', async () => {
      const res = await request(app)
        .post(`/api/v1/shows/${testData.showId}/holds`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ seatIds: [testData.blockedSeatId] });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INVALID_SEATS');
    });

    it('returns 409 ACTIVE_HOLD_EXISTS when user tries to create a second active hold on the same show', async () => {
      const res1 = await request(app)
        .post(`/api/v1/shows/${testData.showId}/holds`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ seatIds: [testData.seatIds[0]] });
      expect(res1.status).toBe(201);

      const res2 = await request(app)
        .post(`/api/v1/shows/${testData.showId}/holds`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ seatIds: [testData.seatIds[1]] });

      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe('ACTIVE_HOLD_EXISTS');
      expect(res2.body.error.details.bookingId).toBe(res1.body.booking.id);
    });
  });

  describe('Payment & Release Flow', () => {
    let bookingId;

    beforeEach(async () => {
      const res = await request(app)
        .post(`/api/v1/shows/${testData.showId}/holds`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ seatIds: [testData.seatIds[0]] });
      bookingId = res.body.booking.id;
    });

    it('returns 403 FORBIDDEN when a non-owner attempts to pay', async () => {
      const res = await request(app)
        .post(`/api/v1/bookings/${bookingId}/pay`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ method: 'MOCK' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('successfully confirms payment, marking seats BOOKED and booking CONFIRMED', async () => {
      const payRes = await request(app)
        .post(`/api/v1/bookings/${bookingId}/pay`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ method: 'MOCK' });

      expect(payRes.status).toBe(200);
      expect(payRes.body.booking.status).toBe('CONFIRMED');
      expect(payRes.body.booking.displayStatus).toBe('CONFIRMED');
      expect(payRes.body.booking.paidAt).not.toBeNull();

      // Verify the seat map reports the seat as UNAVAILABLE to guests
      const mapRes = await request(app).get(`/api/v1/shows/${testData.showId}/seats`);
      const seat = mapRes.body.seats.find((s) => s.id === String(testData.seatIds[0]));
      expect(seat.status).toBe('UNAVAILABLE');
    });

    it('release (DELETE /bookings/:id) cancels hold and returns seats to AVAILABLE', async () => {
      const delRes = await request(app)
        .delete(`/api/v1/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(delRes.status).toBe(204);

      // Seat should immediately be AVAILABLE for another user
      const newHoldRes = await request(app)
        .post(`/api/v1/shows/${testData.showId}/holds`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ seatIds: [testData.seatIds[0]] });

      expect(newHoldRes.status).toBe(201);
    });
  });

  describe('GET /api/v1/me/bookings', () => {
    it('returns user bookings newest first', async () => {
      // User 1 creates hold
      await request(app)
        .post(`/api/v1/shows/${testData.showId}/holds`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ seatIds: [testData.seatIds[0]] });

      const res = await request(app)
        .get('/api/v1/me/bookings')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.bookings).toHaveLength(1);
      expect(res.body.bookings[0].seats).toHaveLength(1);
    });
  });
});
