/**
 * idempotency.test.js – Integration and concurrency tests for Idempotency-Key
 *
 * Verifies:
 * 1. Sequential hold with same key -> same booking id, 1 booking row, seats held once, 200 replayed
 * 2. Parallel hold (20 workers) with same key -> exactly 1 booking, all return same booking id, zero 5xx
 * 3. Same key with different seat IDs -> 422 IDEMPOTENCY_KEY_REUSED
 * 4. Two users using the same key string -> two separate bookings
 * 5. Different keys from one user on same show -> second gets 409 ACTIVE_HOLD_EXISTS
 * 6. Pay twice on one booking -> both 200, booking CONFIRMED once, seats BOOKED once
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { setupTestDb, cleanDb, closeDb, seedTestShow, testPool } from '../helpers/db.js';
import { mintToken } from '../helpers/tokens.js';

describe('Idempotency Keys (P2-M1)', () => {
  let testData;
  let user1Token;
  let user2Token;
  let user1Id;
  let user2Id;

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await cleanDb();
    testData = await seedTestShow();

    const uRes = await testPool.query(`
      INSERT INTO users (name, email, password_hash)
      VALUES
        ('Alice Idem', 'alice.idem@test.local', 'hash'),
        ('Bob Idem', 'bob.idem@test.local', 'hash')
      RETURNING id
    `);

    user1Id = uRes.rows[0].id;
    user2Id = uRes.rows[1].id;
    user1Token = mintToken({ id: user1Id, name: 'Alice Idem' });
    user2Token = mintToken({ id: user2Id, name: 'Bob Idem' });
  });

  afterAll(async () => {
    await closeDb();
  });

  it('1. same key twice sequentially -> same booking id, exactly one bookings row, seats held once', async () => {
    const key = 'idem-seq-test-12345';
    const seatsToHold = [testData.seatIds[0], testData.seatIds[1]];

    // First call: 201 Created
    const res1 = await request(app)
      .post(`/api/v1/shows/${testData.showId}/holds`)
      .set('Authorization', `Bearer ${user1Token}`)
      .set('Idempotency-Key', key)
      .send({ seatIds: seatsToHold });

    expect(res1.status).toBe(201);
    expect(res1.headers['idempotency-replayed']).toBeUndefined();
    const bookingId1 = res1.body.booking.id;

    // Second call with same key and same seats: 200 OK with Idempotency-Replayed
    const res2 = await request(app)
      .post(`/api/v1/shows/${testData.showId}/holds`)
      .set('Authorization', `Bearer ${user1Token}`)
      .set('Idempotency-Key', key)
      .send({ seatIds: seatsToHold });

    expect(res2.status).toBe(200);
    expect(res2.headers['idempotency-replayed']).toBe('true');
    expect(res2.body.booking.id).toBe(bookingId1);

    // Verify DB state: exactly 1 booking row exists
    const bCount = await testPool.query(
      'SELECT COUNT(*)::int as count FROM bookings WHERE user_id = $1',
      [user1Id]
    );
    expect(bCount.rows[0].count).toBe(1);

    // Verify seats held
    const sRows = await testPool.query(
      'SELECT status, booking_id FROM show_seats WHERE show_id = $1 AND seat_id = ANY($2::bigint[])',
      [testData.showId, seatsToHold]
    );
    expect(sRows.rows).toHaveLength(2);
    expect(sRows.rows.every((r) => r.status === 'HELD' && String(r.booking_id) === String(bookingId1))).toBe(true);
  });

  it('2. same key sent 20 times in parallel -> exactly one booking, every response returns the same booking id, zero 5xx', async () => {
    const key = 'idem-parallel-key-999';
    const seatsToHold = [testData.seatIds[2], testData.seatIds[3]];

    const promises = Array.from({ length: 20 }, () =>
      request(app)
        .post(`/api/v1/shows/${testData.showId}/holds`)
        .set('Authorization', `Bearer ${user1Token}`)
        .set('Idempotency-Key', key)
        .send({ seatIds: seatsToHold })
    );

    const responses = await Promise.all(promises);

    // Zero 5xx or unhandled errors
    for (const res of responses) {
      expect([200, 201]).toContain(res.status);
      expect(res.body).toHaveProperty('booking');
    }

    // Every response must return the exact same booking id
    const bookingIds = responses.map((r) => r.body.booking.id);
    const uniqueIds = new Set(bookingIds);
    expect(uniqueIds.size).toBe(1);

    // Exactly one 201 Created and nineteen 200 Replayed
    const createdCount = responses.filter((r) => r.status === 201).length;
    const replayedCount = responses.filter(
      (r) => r.status === 200 && r.headers['idempotency-replayed'] === 'true'
    ).length;
    expect(createdCount).toBe(1);
    expect(replayedCount).toBe(19);

    // Database verification: exactly one booking row exists
    const bRes = await testPool.query(
      'SELECT id FROM bookings WHERE user_id = $1 AND idempotency_key = $2',
      [user1Id, key]
    );
    expect(bRes.rows).toHaveLength(1);
  });

  it('3. same key with different seat ids -> 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const key = 'idem-conflict-key-555';

    // First hold: seat 0
    const res1 = await request(app)
      .post(`/api/v1/shows/${testData.showId}/holds`)
      .set('Authorization', `Bearer ${user1Token}`)
      .set('Idempotency-Key', key)
      .send({ seatIds: [testData.seatIds[0]] });

    expect(res1.status).toBe(201);

    // Attempt second hold with same key but different seat: seat 1
    const res2 = await request(app)
      .post(`/api/v1/shows/${testData.showId}/holds`)
      .set('Authorization', `Bearer ${user1Token}`)
      .set('Idempotency-Key', key)
      .send({ seatIds: [testData.seatIds[1]] });

    expect(res2.status).toBe(422);
    expect(res2.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('4. two users using the same key string -> two separate bookings', async () => {
    const sharedKey = 'common-idem-key-777';

    // User 1 holds seat 0
    const res1 = await request(app)
      .post(`/api/v1/shows/${testData.showId}/holds`)
      .set('Authorization', `Bearer ${user1Token}`)
      .set('Idempotency-Key', sharedKey)
      .send({ seatIds: [testData.seatIds[0]] });

    // User 2 holds seat 1 using the same key string
    const res2 = await request(app)
      .post(`/api/v1/shows/${testData.showId}/holds`)
      .set('Authorization', `Bearer ${user2Token}`)
      .set('Idempotency-Key', sharedKey)
      .send({ seatIds: [testData.seatIds[1]] });

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(res1.body.booking.id).not.toBe(res2.body.booking.id);

    // Verify both rows exist in DB with the same idempotency key string but different user_id
    const rows = await testPool.query(
      'SELECT id, user_id FROM bookings WHERE idempotency_key = $1 ORDER BY id ASC',
      [sharedKey]
    );
    expect(rows.rows).toHaveLength(2);
    expect(String(rows.rows[0].user_id)).toBe(String(user1Id));
    expect(String(rows.rows[1].user_id)).toBe(String(user2Id));
  });

  it('5. different keys from one user on the same show -> second gets 409 ACTIVE_HOLD_EXISTS', async () => {
    // Hold 1 with key A
    const res1 = await request(app)
      .post(`/api/v1/shows/${testData.showId}/holds`)
      .set('Authorization', `Bearer ${user1Token}`)
      .set('Idempotency-Key', 'key-user1-A')
      .send({ seatIds: [testData.seatIds[0]] });

    expect(res1.status).toBe(201);

    // Hold 2 with key B for same user on same show
    const res2 = await request(app)
      .post(`/api/v1/shows/${testData.showId}/holds`)
      .set('Authorization', `Bearer ${user1Token}`)
      .set('Idempotency-Key', 'key-user1-B')
      .send({ seatIds: [testData.seatIds[1]] });

    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe('ACTIVE_HOLD_EXISTS');
  });

  it('6. pay twice on one booking -> both 200, booking CONFIRMED once, seats BOOKED once', async () => {
    // Hold seats
    const holdRes = await request(app)
      .post(`/api/v1/shows/${testData.showId}/holds`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ seatIds: [testData.seatIds[0]] });

    const bookingId = holdRes.body.booking.id;

    // First payment: 200 OK
    const payRes1 = await request(app)
      .post(`/api/v1/bookings/${bookingId}/pay`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ method: 'MOCK' });

    expect(payRes1.status).toBe(200);
    expect(payRes1.body.booking.status).toBe('CONFIRMED');
    expect(payRes1.headers['idempotency-replayed']).toBeUndefined();

    // Second payment: 200 OK with Idempotency-Replayed header
    const payRes2 = await request(app)
      .post(`/api/v1/bookings/${bookingId}/pay`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ method: 'MOCK' });

    expect(payRes2.status).toBe(200);
    expect(payRes2.body.booking.status).toBe('CONFIRMED');
    expect(payRes2.headers['idempotency-replayed']).toBe('true');
    expect(payRes2.body.booking.id).toBe(bookingId);

    // DB verification
    const bRow = await testPool.query('SELECT status, paid_at FROM bookings WHERE id = $1', [bookingId]);
    expect(bRow.rows[0].status).toBe('CONFIRMED');
    expect(bRow.rows[0].paid_at).not.toBeNull();

    const sRow = await testPool.query(
      'SELECT status FROM show_seats WHERE show_id = $1 AND seat_id = $2',
      [testData.showId, testData.seatIds[0]]
    );
    expect(sRow.rows[0].status).toBe('BOOKED');
  });
});
