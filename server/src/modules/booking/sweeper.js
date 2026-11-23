/**
 * sweeper.js – Background housekeeping sweeper for stale holds & refund retries (P2-M4)
 *
 * Guarantees:
 * - Purely housekeeping (correctness holds completely even if sweeper is stopped).
 * - Guarded by PostgreSQL advisory lock (pg_try_advisory_lock): only 1 node runs at a time.
 * - Processes up to 200 rows per batch using SELECT ... FOR UPDATE SKIP LOCKED.
 * - Actions:
 *    (a) Expires stale CREATED bookings and releases HELD seats.
 *    (b) Recovers stale PAYMENT_PENDING (>2 min with no gateway response).
 *    (c) Retries REFUND_PENDING bookings older than 1 minute (with max retry limit).
 */
import pool from '../../db/pool.js';
import { env } from '../../config/env.js';
import { assertTransition } from './bookingStateMachine.js';
import { paymentService } from '../payment/payment.service.js';

export const SWEEPER_ADVISORY_LOCK_ID = 8829104;
const MAX_REFUND_RETRIES = 5;

let sweeperInterval = null;

export const sweeper = {
  /**
   * Run one sweep iteration.
   * Can be executed manually in tests or on a scheduled timer.
   */
  async runOnce(dbPool = pool) {
    const client = await dbPool.connect();
    let lockAcquired = false;

    try {
      // 1. Acquire advisory lock (non-blocking)
      const lockRes = await client.query(
        'SELECT pg_try_advisory_lock($1) AS acquired',
        [SWEEPER_ADVISORY_LOCK_ID]
      );
      lockAcquired = Boolean(lockRes.rows[0]?.acquired);

      if (!lockAcquired) {
        return { ran: false, reason: 'LOCKED' };
      }

      const stats = {
        expiredHolds: 0,
        recoveredPayments: 0,
        retriedRefunds: 0,
      };

      // ── (a) Expire stale CREATED bookings in batches of 200 ─────────────
      await client.query('BEGIN');
      try {
        const { rows: staleHolds } = await client.query(
          `SELECT id, show_id, status
           FROM bookings
           WHERE status = 'CREATED' AND hold_expires_at <= now()
           ORDER BY id
           LIMIT 200
           FOR UPDATE SKIP LOCKED`
        );

        for (const b of staleHolds) {
          assertTransition(b.status, 'EXPIRED');
          await client.query(
            `UPDATE bookings
             SET status = 'EXPIRED', updated_at = now()
             WHERE id = $1`,
            [b.id]
          );
          await client.query(
            `UPDATE show_seats
             SET status = 'AVAILABLE', booking_id = NULL, hold_expires_at = NULL
             WHERE show_id = $1 AND booking_id = $2 AND status = 'HELD'`,
            [b.show_id, b.id]
          );
          stats.expiredHolds++;
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }

      // ── (b) Recover stale PAYMENT_PENDING (>2 minutes) ───────────────────
      await client.query('BEGIN');
      try {
        const { rows: stalePending } = await client.query(
          `SELECT id, show_id, status, hold_expires_at,
                  (hold_expires_at <= now()) AS is_expired
           FROM bookings
           WHERE status = 'PAYMENT_PENDING'
             AND payment_started_at < now() - interval '2 minutes'
           ORDER BY id
           LIMIT 200
           FOR UPDATE SKIP LOCKED`
        );

        for (const b of stalePending) {
          if (!b.is_expired) {
            // Hold is still valid -> revert to CREATED so customer can retry
            assertTransition('PAYMENT_PENDING', 'CREATED');
            await client.query(
              `UPDATE bookings
               SET status = 'CREATED', payment_started_at = NULL, updated_at = now()
               WHERE id = $1`,
              [b.id]
            );
          } else {
            // Hold already expired -> mark EXPIRED and release seats
            assertTransition('PAYMENT_PENDING', 'EXPIRED');
            await client.query(
              `UPDATE bookings
               SET status = 'EXPIRED', payment_started_at = NULL, updated_at = now()
               WHERE id = $1`,
              [b.id]
            );
            await client.query(
              `UPDATE show_seats
               SET status = 'AVAILABLE', booking_id = NULL, hold_expires_at = NULL
               WHERE show_id = $1 AND booking_id = $2 AND status = 'HELD'`,
              [b.show_id, b.id]
            );
          }
          stats.recoveredPayments++;
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }

      // ── (c) Retry REFUND_PENDING older than 1 minute (max 5 attempts) ───
      const { rows: pendingRefunds } = await client.query(
        `SELECT id, refund_attempts
         FROM bookings
         WHERE status = 'REFUND_PENDING'
           AND updated_at < now() - interval '1 minute'
           AND refund_attempts < $1
         ORDER BY id
         LIMIT 200`,
        [MAX_REFUND_RETRIES]
      );

      for (const b of pendingRefunds) {
        // Execute refund outside transaction locks to prevent blocking
        try {
          const res = await paymentService.retryRefund(b.id);
          if (res?.status === 'REFUNDED') {
            stats.retriedRefunds++;
          } else {
            // Failed retry returned non-REFUNDED status -> record attempt
            const { rows: updated } = await client.query(
              `UPDATE bookings
               SET refund_attempts = refund_attempts + 1, updated_at = now()
               WHERE id = $1
               RETURNING refund_attempts`,
              [b.id]
            );
            const attempts = updated[0]?.refund_attempts;
            if (attempts >= MAX_REFUND_RETRIES) {
              console.warn(`[Sweeper] Max refund attempts (${MAX_REFUND_RETRIES}) reached for booking ${b.id}. Stopping retries; manual intervention required.`);
            }
          }
        } catch (err) {
          // If refund call throws error, record attempt
          const { rows: updated } = await client.query(
            `UPDATE bookings
             SET refund_attempts = refund_attempts + 1, updated_at = now()
             WHERE id = $1
             RETURNING refund_attempts`,
            [b.id]
          );
          const attempts = updated[0]?.refund_attempts;
          if (attempts >= MAX_REFUND_RETRIES) {
            console.warn(`[Sweeper] Max refund attempts (${MAX_REFUND_RETRIES}) reached for booking ${b.id}. Stopping retries; manual intervention required.`);
          }
        }
      }

      return { ran: true, stats };
    } finally {
      if (lockAcquired) {
        try {
          await client.query('SELECT pg_advisory_unlock($1)', [SWEEPER_ADVISORY_LOCK_ID]);
        } catch {
          // Ignore unlock errors during teardown
        }
      }
      client.release();
    }
  },

  /**
   * Start scheduled recurring background sweeper.
   */
  startSweeper(intervalMs = env.SWEEPER_INTERVAL_MS, dbPool = pool) {
    if (sweeperInterval) return;
    sweeperInterval = setInterval(() => {
      this.runOnce(dbPool).catch((err) => {
        console.error('Sweeper error:', err.message);
      });
    }, intervalMs);

    if (sweeperInterval?.unref) {
      sweeperInterval.unref();
    }
  },

  /**
   * Stop scheduled recurring background sweeper.
   */
  stopSweeper() {
    if (sweeperInterval) {
      clearInterval(sweeperInterval);
      sweeperInterval = null;
    }
  },
};
