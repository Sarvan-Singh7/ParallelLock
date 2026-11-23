/** booking.repo.js – Database repository for bookings table */
import pool from '../../db/pool.js';
import { assertTransition } from './bookingStateMachine.js';

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

  // Insert line-item tickets in booking_items (written in the hold transaction)
  async insertBookingItems(items, client) {
    for (const item of items) {
      await client.query(
        `INSERT INTO booking_items (booking_id, show_id, seat_id, price_cents)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (booking_id, seat_id) DO NOTHING`,
        [item.bookingId, item.showId, item.seatId, item.priceCents]
      );
    }
  },

  // Read ticket line items from booking_items joined with physical seats
  async getBookingItems(bookingId, db = pool) {
    const { rows } = await db.query(
      `SELECT bi.seat_id AS id, bi.price_cents,
              s.row_label, s.seat_label, s.section
       FROM booking_items bi
       JOIN seats s ON s.id = bi.seat_id
       WHERE bi.booking_id = $1
       ORDER BY bi.seat_id ASC`,
      [bookingId]
    );
    return rows.map((r) => ({
      id: String(r.id),
      rowLabel: r.row_label,
      seatLabel: r.seat_label,
      section: r.section,
      priceCents: Number(r.price_cents),
    }));
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
    assertTransition('CREATED', 'PAYMENT_PENDING');
    const { rows } = await client.query(
      `UPDATE bookings
       SET status = 'PAYMENT_PENDING',
           payment_started_at = now(),
           updated_at = now(),
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
    assertTransition('PAYMENT_PENDING', 'CREATED');
    await client.query(
      `UPDATE bookings
       SET status = 'CREATED',
           payment_started_at = NULL,
           updated_at = now()
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
          assertTransition('PAYMENT_PENDING', 'CREATED');
          await client.query(
            `UPDATE bookings
             SET status = 'CREATED', payment_started_at = NULL, updated_at = now()
             WHERE id = $1 AND status = 'PAYMENT_PENDING' AND payment_started_at < now() - interval '2 minutes'`,
            [bookingId]
          );
          row.status = 'CREATED';
          row.payment_started_at = null;
        } else {
          assertTransition('PAYMENT_PENDING', 'EXPIRED');
          await client.query(
            `UPDATE bookings
             SET status = 'EXPIRED', payment_started_at = NULL, updated_at = now()
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

  // Confirm booking (accepts CREATED, PAYMENT_PENDING, or EXPIRED if seats still held)
  async confirmBooking(bookingId, client) {
    const { rows: cur } = await client.query(
      `SELECT status FROM bookings WHERE id = $1 FOR UPDATE`,
      [bookingId]
    );
    if (cur[0]) {
      assertTransition(cur[0].status, 'CONFIRMED');
    }
    const { rows } = await client.query(
      `UPDATE bookings
       SET status = 'CONFIRMED',
           paid_at = now(),
           updated_at = now()
       WHERE id = $1 AND status IN ('CREATED', 'PAYMENT_PENDING', 'EXPIRED')
       RETURNING id, ref, status, paid_at`,
      [bookingId]
    );
    return rows[0];
  },

  // Set status to REFUND_PENDING
  async setRefundPending(bookingId, client) {
    const { rows: cur } = await client.query(
      `SELECT status FROM bookings WHERE id = $1 FOR UPDATE`,
      [bookingId]
    );
    if (cur[0]) {
      assertTransition(cur[0].status, 'REFUND_PENDING');
    }
    const { rows } = await client.query(
      `UPDATE bookings
       SET status = 'REFUND_PENDING',
           updated_at = now()
       WHERE id = $1
       RETURNING id, ref, status`,
      [bookingId]
    );
    return rows[0];
  },

  // Set status to REFUNDED
  async setRefunded(bookingId, client) {
    const { rows: cur } = await client.query(
      `SELECT status FROM bookings WHERE id = $1 FOR UPDATE`,
      [bookingId]
    );
    if (cur[0]) {
      assertTransition(cur[0].status, 'REFUNDED');
    }
    const { rows } = await client.query(
      `UPDATE bookings
       SET status = 'REFUNDED',
           updated_at = now()
       WHERE id = $1 AND status = 'REFUND_PENDING'
       RETURNING id, ref, status`,
      [bookingId]
    );
    return rows[0];
  },

  // Mark EXPIRED (only if still CREATED)
  async markExpired(bookingId, db = pool) {
    assertTransition('CREATED', 'EXPIRED');
    await db.query(
      `UPDATE bookings
       SET status = 'EXPIRED',
           updated_at = now()
       WHERE id = $1 AND status = 'CREATED'`,
      [bookingId]
    );
  },

  // Mark CANCELLED (only if still CREATED)
  async markCancelled(bookingId, client) {
    assertTransition('CREATED', 'CANCELLED');
    await client.query(
      `UPDATE bookings
       SET status = 'CANCELLED',
           updated_at = now()
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
