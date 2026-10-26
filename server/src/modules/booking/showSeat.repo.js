/**
 * showSeat.repo.js – Repository for show_seats table operations
 *
 * Implements row-level locking for concurrency control.
 */
import pool from '../../db/pool.js';

export const showSeatRepo = {
  /**
   * Locks requested show_seats in ascending seat_id order to prevent deadlocks.
   * Checks whether each seat is free: AVAILABLE or HELD-but-expired.
   */
  async lockSeatsForHold(showId, seatIds, client) {
    const { rows } = await client.query(
      `SELECT
         seat_id,
         price_cents,
         (status = 'AVAILABLE' OR (status = 'HELD' AND hold_expires_at <= now())) AS is_free
       FROM show_seats
       WHERE show_id = $1 AND seat_id = ANY($2::bigint[])
       ORDER BY seat_id ASC
       FOR UPDATE`,
      [showId, seatIds]
    );
    return rows;
  },

  /**
   * Updates locked show_seats to HELD with booking_id and hold_expires_at.
   */
  async markHeld(showId, seatIds, bookingId, holdExpiresAt, client) {
    const { rowCount } = await client.query(
      `UPDATE show_seats
       SET status = 'HELD',
           booking_id = $1,
           hold_expires_at = $2
       WHERE show_id = $3 AND seat_id = ANY($4::bigint[])`,
      [bookingId, holdExpiresAt, showId, seatIds]
    );
    return rowCount;
  },

  /**
   * Finalizes seats to BOOKED status during payment.
   * Matches only rows that are currently HELD under this booking_id and show_id.
   */
  async markBooked(showId, bookingId, client) {
    const { rowCount } = await client.query(
      `UPDATE show_seats
       SET status = 'BOOKED',
           hold_expires_at = NULL
       WHERE show_id = $1 AND booking_id = $2 AND status = 'HELD'`,
      [showId, bookingId]
    );
    return rowCount;
  },

  /**
   * Releases still-HELD show_seats back to AVAILABLE upon cancellation.
   */
  async releaseHeldSeats(showId, bookingId, client) {
    const { rowCount } = await client.query(
      `UPDATE show_seats
       SET status = 'AVAILABLE',
           booking_id = NULL,
           hold_expires_at = NULL
       WHERE show_id = $1 AND booking_id = $2 AND status = 'HELD'`,
      [showId, bookingId]
    );
    return rowCount;
  },

  /**
   * Load seat details (row, label, section, price) for a booking's seat_ids.
   */
  async getSeatsForBooking(showId, seatIds, db = pool) {
    const { rows } = await db.query(
      `SELECT
         s.id,
         s.row_label   AS "row",
         s.seat_label  AS "label",
         s.section,
         ss.price_cents AS "priceCents"
       FROM seats s
       JOIN show_seats ss ON ss.seat_id = s.id AND ss.show_id = $1
       WHERE s.id = ANY($2::bigint[])
       ORDER BY s.grid_row ASC, s.grid_col ASC`,
      [showId, seatIds]
    );
    return rows.map((r) => ({
      id: String(r.id),
      row: r.row,
      label: r.label,
      section: r.section,
      priceCents: Number(r.priceCents),
    }));
  },
};
