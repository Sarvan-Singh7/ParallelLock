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

  // Expire stale user holds (only CREATED holds that passed expiry)
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

  // Find active user hold (CREATED or live PAYMENT_PENDING)
  async findActiveUserHold(showId, userId, client) {
    const { rows } = await client.query(
      `SELECT id, hold_expires_at, status
       FROM bookings
       WHERE show_id = $1
         AND user_id = $2
         AND status IN ('CREATED', 'PAYMENT_PENDING')
         AND (
           (status = 'CREATED' AND hold_expires_at > now())
           OR (status = 'PAYMENT_PENDING' AND payment_started_at > now() - interval '2 minutes')
         )
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
              hold_expires_at, paid_at, payment_started_at, created_at, idempotency_key
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
                 hold_expires_at, paid_at, payment_started_at, created_at, idempotency_key`,
      [ref, userId, showId, seatIds, totalCents, String(holdSeconds), idempotencyKey || null]
    );
    return rows[0];
  },

  // Lock booking row for update
  async lockBookingForUpdate(bookingId, client) {
    const { rows } = await client.query(
      `SELECT id, ref, user_id, show_id, status, seat_ids, total_cents,
              hold_expires_at, paid_at, payment_started_at,
              (hold_expires_at <= now()) AS is_expired
       FROM bookings
       WHERE id = $1
       FOR UPDATE`,
      [bookingId]
    );
    return rows[0] || null;
  },

  // Set status to PAYMENT_PENDING and extend hold by 3 minutes
  async setPaymentPending(bookingId, client) {
    const { rows } = await client.query(
      `UPDATE bookings
       SET status = 'PAYMENT_PENDING',
           payment_started_at = now(),
           hold_expires_at = GREATEST(hold_expires_at, now() + interval '3 minutes')
       WHERE id = $1 AND status = 'CREATED'
       RETURNING id, show_id, seat_ids, hold_expires_at, payment_started_at`,
      [bookingId]
    );
    if (!rows[0]) return null;

    // Extend show_seats in the same transaction
    await client.query(
      `UPDATE show_seats
       SET hold_expires_at = $1
       WHERE show_id = $2 AND booking_id = $3 AND status = 'HELD'`,
      [rows[0].hold_expires_at, rows[0].show_id, bookingId]
    );

    return rows[0];
  },

  // Revert PAYMENT_PENDING back to CREATED (on payment failure)
  async revertPaymentPending(bookingId, client) {
    await client.query(
      `UPDATE bookings
       SET status = 'CREATED',
           payment_started_at = NULL
       WHERE id = $1 AND status = 'PAYMENT_PENDING'`,
      [bookingId]
    );
  },

  // Race-safe lazy crash recovery: reverts stale PAYMENT_PENDING older than 2 minutes
  async recoverStalePaymentPending(bookingId, client) {
    const { rows } = await client.query(
      `SELECT id, show_id, status, hold_expires_at, payment_started_at,
              (hold_expires_at <= now()) AS is_expired
       FROM bookings
       WHERE id = $1
       FOR UPDATE`,
      [bookingId]
    );
    const row = rows[0];
    if (!row) return null;

    if (row.status === 'PAYMENT_PENDING' && row.payment_started_at) {
      const elapsedMs = Date.now() - new Date(row.payment_started_at).getTime();
      if (elapsedMs >= 120_000) {
        if (!row.is_expired) {
          await client.query(
            `UPDATE bookings
             SET status = 'CREATED', payment_started_at = NULL
             WHERE id = $1 AND status = 'PAYMENT_PENDING' AND payment_started_at < now() - interval '2 minutes'`,
            [bookingId]
          );
          row.status = 'CREATED';
          row.payment_started_at = null;
        } else {
          await client.query(
            `UPDATE bookings
             SET status = 'EXPIRED', payment_started_at = NULL
             WHERE id = $1 AND status = 'PAYMENT_PENDING' AND payment_started_at < now() - interval '2 minutes'`,
            [bookingId]
          );
          await client.query(
            `UPDATE show_seats
             SET status = 'AVAILABLE', booking_id = NULL, hold_expires_at = NULL
             WHERE show_id = $1 AND booking_id = $2 AND status = 'HELD'`,
            [row.show_id, bookingId]
          );
          row.status = 'EXPIRED';
          row.payment_started_at = null;
        }
      }
    }
    return row;
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
              b.total_cents, b.hold_expires_at, b.paid_at, b.payment_started_at, b.created_at,
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
              b.total_cents, b.hold_expires_at, b.paid_at, b.payment_started_at, b.created_at,
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
