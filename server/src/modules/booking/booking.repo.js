/**
 * booking.repo.js – Database repository for bookings table
 */
import pool from '../../db/pool.js';

export const bookingRepo = {
  /**
   * Load show to verify existence and check if it has already started.
   */
  async findShowForHold(showId, client) {
    const { rows } = await client.query(
      `SELECT id, starts_at, (starts_at <= now()) AS is_closed
       FROM shows
       WHERE id = $1`,
      [showId]
    );
    return rows[0] || null;
  },

  /**
   * Mark caller's own stale bookings for this show as EXPIRED.
   */
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

  /**
   * Check for an existing, still-active CREATED hold for this caller on this show.
   */
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

  /**
   * Insert a new booking record with status 'CREATED'.
   */
  async insertBooking({ ref, userId, showId, seatIds, totalCents, holdExpiresAt }, client) {
    const { rows } = await client.query(
      `INSERT INTO bookings (ref, user_id, show_id, status, seat_ids, total_cents, hold_expires_at)
       VALUES ($1, $2, $3, 'CREATED', $4, $5, $6)
       RETURNING id, ref, user_id, show_id, status, seat_ids, total_cents, hold_expires_at, paid_at, created_at`,
      [ref, userId, showId, seatIds, totalCents, holdExpiresAt]
    );
    return rows[0];
  },

  /**
   * Lock booking row for payment finalization.
   */
  async lockBookingForUpdate(bookingId, client) {
    const { rows } = await client.query(
      `SELECT
         id,
         ref,
         user_id,
         show_id,
         status,
         seat_ids,
         total_cents,
         hold_expires_at,
         paid_at,
         (hold_expires_at <= now()) AS is_expired
       FROM bookings
       WHERE id = $1
       FOR UPDATE`,
      [bookingId]
    );
    return rows[0] || null;
  },

  /**
   * Update booking status to CONFIRMED and record paid_at timestamp.
   */
  async confirmBooking(bookingId, client) {
    const { rows } = await client.query(
      `UPDATE bookings
       SET status = 'CONFIRMED',
           paid_at = now()
       WHERE id = $1
       RETURNING id, ref, status, paid_at`,
      [bookingId]
    );
    return rows[0];
  },

  /**
   * Mark a booking EXPIRED.
   */
  async markExpired(bookingId, db = pool) {
    await db.query(
      `UPDATE bookings
       SET status = 'EXPIRED'
       WHERE id = $1`,
      [bookingId]
    );
  },

  /**
   * Mark a booking CANCELLED.
   */
  async markCancelled(bookingId, client) {
    await client.query(
      `UPDATE bookings
       SET status = 'CANCELLED'
       WHERE id = $1`,
      [bookingId]
    );
  },

  /**
   * Fetch full booking details with show, movie, screen, and theater info.
   */
  async findBookingDetails(bookingId, db = pool) {
    const { rows } = await db.query(
      `SELECT
         b.id,
         b.ref,
         b.user_id,
         b.show_id,
         b.status,
         b.seat_ids,
         b.total_cents,
         b.hold_expires_at,
         b.paid_at,
         b.created_at,
         (b.hold_expires_at <= now()) AS is_past_expiry,
         s.id AS s_id,
         s.starts_at,
         s.language,
         s.format,
         sc.name AS screen_name,
         m.id AS movie_id,
         m.title AS movie_title,
         m.certificate AS movie_certificate,
         m.duration_min AS movie_duration_min,
         m.poster_url AS movie_poster_url,
         t.name AS theater_name,
         t.address AS theater_address,
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

  /**
   * List all bookings for a user, newest first.
   */
  async listUserBookings(userId, limit = 50, db = pool) {
    const { rows } = await db.query(
      `SELECT
         b.id,
         b.ref,
         b.user_id,
         b.show_id,
         b.status,
         b.seat_ids,
         b.total_cents,
         b.hold_expires_at,
         b.paid_at,
         b.created_at,
         (b.hold_expires_at <= now()) AS is_past_expiry,
         s.id AS s_id,
         s.starts_at,
         s.language,
         s.format,
         sc.name AS screen_name,
         m.id AS movie_id,
         m.title AS movie_title,
         m.certificate AS movie_certificate,
         m.duration_min AS movie_duration_min,
         m.poster_url AS movie_poster_url,
         t.name AS theater_name,
         t.address AS theater_address,
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
