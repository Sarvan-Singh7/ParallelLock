/**
 * ============================================================================
 * ⚠️  DEMO ONLY – DELIBERATELY LOCK-FREE (UNSAFE) CONCURRENCY RACE CONDITION  ⚠️
 * ============================================================================
 *
 * This script demonstrates the classic "check-then-act" race condition that
 * occurs when an application checks seat availability and then updates it
 * WITHOUT row-level locks (FOR UPDATE).
 *
 * Each worker:
 *   1. Reads seat status with a standard SELECT (no lock)
 *   2. Pauses 5ms (simulating async processing or network latency)
 *   3. Blindly issues UPDATE show_seats SET status = 'HELD'
 *
 * Because there is no lock, multiple workers observe status='AVAILABLE'
 * simultaneously, and both issue the UPDATE. This proves why ParallelLock's
 * ordered 'SELECT ... FOR UPDATE' in a single transaction is necessary.
 *
 * NEVER imported or used by the main application.
 *
 * Run with: npm run demo:unsafe
 */
import pg from 'pg';
import { env } from '../src/config/env.js';

async function run() {
  const N = parseInt(process.argv[2] || '10', 10);
  const showId = 1;

  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

  // Pick an available seat and reset it
  const { rows } = await pool.query(
    `SELECT seat_id FROM show_seats WHERE show_id = $1 AND status = 'AVAILABLE' LIMIT 1`,
    [showId]
  );
  if (rows.length === 0) {
    console.error('No available seats found.');
    await pool.end();
    return;
  }
  const seatId = rows[0].seat_id;

  console.log(`\n⚠️  Simulating LOCK-FREE race condition with ${N} parallel workers on seat ${seatId}...\n`);

    // Ensure a demo booking exists for the workers to attach
    let demoBookingRes = await pool.query(`SELECT id FROM bookings LIMIT 1`);
    let demoBookingId;
    if (demoBookingRes.rows.length === 0) {
      const uRes = await pool.query(`SELECT id FROM users LIMIT 1`);
      const bRes = await pool.query(
        `INSERT INTO bookings (ref, user_id, show_id, status, seat_ids, total_cents, hold_expires_at)
         VALUES ('PL-UNSAFE01', $1, $2, 'CREATED', ARRAY[$3::bigint], 32000, now() + interval '8 minutes')
         RETURNING id`,
        [uRes.rows[0].id, showId, seatId]
      );
      demoBookingId = bRes.rows[0].id;
    } else {
      demoBookingId = demoBookingRes.rows[0].id;
    }

    let startBarrier = false;

    async function unsafeWorker(workerId) {
      const client = await pool.connect();
      try {
        while (!startBarrier) {
          await new Promise((r) => setImmediate(r));
        }

        // 1. Check availability (NO FOR UPDATE, NO TRANSACTION)
        const res = await client.query(
          `SELECT status FROM show_seats WHERE show_id = $1 AND seat_id = $2`,
          [showId, seatId]
        );

        const status = res.rows[0]?.status;

        // 2. Artificial 10ms pause (window where another process reads the same status)
        await new Promise((resolve) => setTimeout(resolve, 10));

        // 3. Blind update if it was available during check
        if (status === 'AVAILABLE') {
          await client.query(
            `UPDATE show_seats
             SET status = 'HELD', booking_id = $3, hold_expires_at = now() + interval '8 minutes'
             WHERE show_id = $1 AND seat_id = $2`,
            [showId, seatId, demoBookingId]
          );
          return { workerId, success: true };
        }
        return { workerId, success: false };
      } finally {
        client.release();
      }
    }

    const tasks = [];
    for (let i = 1; i <= N; i++) {
      tasks.push(unsafeWorker(i));
    }

    // Brief pause to let all workers connect and reach barrier
    await new Promise((r) => setTimeout(r, 60));
    startBarrier = true;

  const results = await Promise.all(tasks);
  const winners = results.filter((r) => r.success);

  console.log('=== Unsafe (Lock-Free) Simulation Results ===');
  console.log(`Total parallel attempts: ${N}`);
  console.log(`Workers that believed they secured the seat: ${winners.length}`);
  console.log(`Successful worker IDs: ${winners.map((w) => w.workerId).join(', ')}`);

  if (winners.length > 1) {
    console.log(`\n🚨 RACE CONDITION REPRODUCED: ${winners.length} users simultaneously held the SAME seat!`);
    console.log(`This is the fatal double-booking flaw that ParallelLock's 'SELECT ... FOR UPDATE' prevents.\n`);
  } else {
    console.log('\n(No collision this run – increase N or rerun to observe the race).\n');
  }

  // Restore seat to AVAILABLE
  await pool.query(
    `UPDATE show_seats SET status = 'AVAILABLE', booking_id = NULL, hold_expires_at = NULL WHERE show_id = $1 AND seat_id = $2`,
    [showId, seatId]
  );

  await pool.end();
}

run().catch(console.error);
