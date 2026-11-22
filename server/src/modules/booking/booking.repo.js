/** booking.repo.js – Database repository for bookings table */
import pool from '../../db/pool.js';

export const bookingRepo = {
  // Load show for hold
  async findShowForHold(showId, client) {
    const { rows } = await client.query(
      `SELECT id, starts_at, (starts_at <= now()) AS is_closed
       FROM shows
       WHERE id = $1`,
      [showId]
    );
    return rows[0] || null;
  },

  // Expire stale user holds
  async expireStaleUserHolds(showId, userId, client) {
    await client.query(
      `UPDATE bookings
       SET status = 'EXPIRED'
       WHERE show_id = $1
         AND user_id = $2
         AND status = 'CREATED'
         AND hold_expires_at <= now()`,
      [showId, userId]
    );
  },

  // Find active user hold
  async findActiveUserHold(showId, userId, client) {
    const { rows } = await client.query(
      `SELECT id, hold_expires_at
       FROM bookings
       WHERE show_id = $1
         AND user_id = $2
         AND status = 'CREATED'
         AND hold_expires_at > now()
       LIMIT 1`,
      [showId, userId]
    );
    return rows[0] || null;
  },

  // Serialize user row
  async lockUserRow(userId, client) {
    const { rows } = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    return rows[0] || null;
  },

  // Find booking by idempotency key
  async findBookingByIdempotencyKey(userId, idempotencyKey, client) {
    const { rows } = await client.query(
      `SELECT id, ref, user_id, show_id, status, seat_ids, total_cents,
              hold_expires_at, paid_at, created_at, idempotency_key
       FROM bookings
       WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, idempotencyKey]
    );
    return rows[0] || null;
  },

  // Insert new booking (CREATED)
  async insertBooking(
    { ref, userId, showId, seatIds, totalCents, holdSeconds, idempotencyKey },
    client
  ) {
    const { rows } = await client.query(
      `INSERT INTO bookings (ref, user_id, show_id, status, seat_ids,
                            total_cents, hold_expires_at, idempotency_key)
       VALUES ($1, $2, $3, 'CREATED', $4, $5,
               now() + ($6 || ' seconds')::interval, $7)
       RETURNING id, ref, user_id, show_id, status, seat_ids, total_cents,
                 hold_expires_at, paid_at, created_at, idempotency_key`,
      [ref, userId, showId, seatIds, totalCents, String(holdSeconds), idempotencyKey || null]
    );
    return rows[0];
  },

  // Lock booking row for update
  async lockBookingForUpdate(bookingId, client) {
    const { rows } = await client.query(
      `SELECT id, ref, user_id, show_id, status, seat_ids, total_cents,
              hold_expires_at, paid_at,
              (hold_expires_at <= now()) AS is_expired
       FROM bookings
       WHERE id = $1
       FOR UPDATE`,
      [bookingId]
    );
    return rows[0] || null;
  },

  // Set status to PAYMENT_PENDING
  async setPaymentPending(bookingId, client) {
    await client.query(
      `UPDATE bookings
       SET status = 'PAYMENT_PENDING'
       WHERE id = $1 AND status = 'CREATED'`,
      [bookingId]
    );
  },

  // Revert PAYMENT_PENDING back to CREATED (on payment failure)
  async revertPaymentPending(bookingId, client) {
    await client.query(
      `UPDATE bookings
       SET status = 'CREATED'
       WHERE id = $1 AND status = 'PAYMENT_PENDING'`,
      [bookingId]
    );
  },

  // Confirm booking (requires PAYMENT_PENDING)
  async confirmBooking(bookingId, client) {
    const { rows } = await client.query(
      `UPDATE bookings
       SET status = 'CONFIRMED',
           paid_at = now()
       WHERE id = $1 AND status = 'PAYMENT_PENDING'
       RETURNING id, ref, status, paid_at`,
      [bookingId]
    );
    return rows[0];
  },

  // Mark EXPIRED (only if still CREATED)
  async markExpired(bookingId, db = pool) {
    await db.query(
      `UPDATE bookings
       SET status = 'EXPIRED'
       WHERE id = $1 AND status = 'CREATED'`,
      [bookingId]
    );
  },

  // Mark CANCELLED (only if still CREATED)
  async markCancelled(bookingId, client) {
    await client.query(
      `UPDATE bookings
       SET status = 'CANCELLED'
       WHERE id = $1 AND status = 'CREATED'`,
      [bookingId]
    );
  },

  // Fetch full booking details
  async findBookingDetails(bookingId, db = pool) {
    const { rows } = await db.query(
      `SELECT b.id, b.ref, b.user_id, b.show_id, b.status, b.seat_ids,
              b.total_cents, b.hold_expires_at, b.paid_at, b.created_at,
              (b.hold_expires_at <= now()) AS is_past_expiry,
              s.id AS s_id, s.starts_at, s.language, s.format,
              sc.name AS screen_name,
              m.id AS movie_id, m.title AS movie_title,
              m.certificate AS movie_certificate,
              m.duration_min AS movie_duration_min,
              m.poster_url AS movie_poster_url,
              t.name AS theater_name, t.address AS theater_address,
              t.city AS theater_city
       FROM bookings b
       JOIN shows s    ON s.id = b.show_id
       JOIN screens sc ON sc.id = s.screen_id
       JOIN movies m   ON m.id = s.movie_id
       JOIN theaters t ON t.id = sc.theater_id
       WHERE b.id = $1`,
      [bookingId]
    );
    return rows[0] || null;
  },

  // List user bookings (newest first)
  async listUserBookings(userId, limit = 50, db = pool) {
    const { rows } = await db.query(
      `SELECT b.id, b.ref, b.user_id, b.show_id, b.status, b.seat_ids,
              b.total_cents, b.hold_expires_at, b.paid_at, b.created_at,
              (b.hold_expires_at <= now()) AS is_past_expiry,
              s.id AS s_id, s.starts_at, s.language, s.format,
              sc.name AS screen_name,
              m.id AS movie_id, m.title AS movie_title,
              m.certificate AS movie_certificate,
              m.duration_min AS movie_duration_min,
              m.poster_url AS movie_poster_url,
              t.name AS theater_name, t.address AS theater_address,
              t.city AS theater_city
       FROM bookings b
       JOIN shows s    ON s.id = b.show_id
       JOIN screens sc ON sc.id = s.screen_id
       JOIN movies m   ON m.id = s.movie_id
       JOIN theaters t ON t.id = sc.theater_id
       WHERE b.user_id = $1
       ORDER BY b.created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return rows;
  },
};