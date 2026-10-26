/**
 * seats.repo.js – Database queries for show seat layout and availability
 */
import pool from '../../db/pool.js';

export const seatsRepo = {
  /**
   * Fetch show metadata including movie title, screen name, and theater name.
   */
  async findShowDetails(showId, db = pool) {
    const { rows } = await db.query(
      `SELECT
         s.id AS show_id,
         s.screen_id,
         s.starts_at,
         s.language,
         s.format,
         m.title AS movie_title,
         t.name  AS theater_name,
         sc.name AS screen_name
       FROM shows s
       JOIN movies m   ON m.id = s.movie_id
       JOIN screens sc ON sc.id = s.screen_id
       JOIN theaters t ON t.id = sc.theater_id
       WHERE s.id = $1`,
      [showId]
    );
    return rows[0] || null;
  },

  /**
   * Fetch distinct pricing sections for active seats in the given screen.
   */
  async findSections(screenId, db = pool) {
    const { rows } = await db.query(
      `SELECT DISTINCT
         s.section AS name,
         CASE WHEN s.section = 'GOLD' THEN 32000 ELSE 22000 END AS price_cents
       FROM seats s
       WHERE s.screen_id = $1 AND s.is_active = true
       ORDER BY price_cents DESC`,
      [screenId]
    );
    return rows;
  },

  /**
   * Fetch all seats for the screen, computing their current status relative to the caller:
   * - No show_seats row => BLOCKED
   * - AVAILABLE or expired HELD => AVAILABLE
   * - Active HELD by caller ($2) => MINE
   * - Other HELD or BOOKED => UNAVAILABLE
   */
  async findSeatsWithStatus(showId, screenId, callerUserId = null, db = pool) {
    const { rows } = await db.query(
      `SELECT
         s.id,
         s.row_label  AS "row",
         s.seat_label AS "label",
         s.section,
         s.grid_row   AS "gridRow",
         s.grid_col   AS "gridCol",
         CASE
           WHEN ss.seat_id IS NULL THEN 'BLOCKED'
           WHEN ss.status = 'AVAILABLE' THEN 'AVAILABLE'
           WHEN ss.status = 'HELD' AND ss.hold_expires_at <= now() THEN 'AVAILABLE'
           WHEN ss.status = 'HELD' AND $3::bigint IS NOT NULL AND b.user_id = $3::bigint AND ss.hold_expires_at > now() THEN 'MINE'
           WHEN ss.status = 'HELD' OR ss.status = 'BOOKED' THEN 'UNAVAILABLE'
           ELSE 'BLOCKED'
         END AS status
       FROM seats s
       LEFT JOIN show_seats ss ON ss.show_id = $1 AND ss.seat_id = s.id
       LEFT JOIN bookings b    ON b.id = ss.booking_id
       WHERE s.screen_id = $2
       ORDER BY s.grid_row ASC, s.grid_col ASC`,
      [showId, screenId, callerUserId ? BigInt(callerUserId) : null]
    );
    return rows;
  },

  /**
   * Check if caller has an active (non-expired) CREATED booking for this show.
   */
  async findActiveUserHold(showId, userId, db = pool) {
    if (!userId) return null;
    const { rows } = await db.query(
      `SELECT id, hold_expires_at
       FROM bookings
       WHERE show_id = $1
         AND user_id = $2
         AND status = 'CREATED'
         AND hold_expires_at > now()
       LIMIT 1`,
      [showId, BigInt(userId)]
    );
    return rows[0] || null;
  },
};
