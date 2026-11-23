/**
 * checkInvariants.js – Database-enforced invariant verification (P2-M4)
 *
 * Verifies system-wide transactional consistency. Every query must return 0 rows:
 * 1. BOOKED seats whose booking is not CONFIRMED.
 * 2. CONFIRMED bookings whose seat count differs from show_seats count.
 * 3. HELD seats whose booking is EXPIRED, CANCELLED, REFUNDED or REFUND_PENDING.
 */
import pool from '../src/db/pool.js';

export async function checkInvariants(dbPool = pool) {
  const violations = [];

  // Query 1: BOOKED seats whose booking is not CONFIRMED
  const q1 = await dbPool.query(`
    SELECT ss.show_id, ss.seat_id, ss.booking_id, b.status AS booking_status
    FROM show_seats ss
    LEFT JOIN bookings b ON b.id = ss.booking_id
    WHERE ss.status = 'BOOKED'
      AND (b.id IS NULL OR b.status != 'CONFIRMED')
  `);
  if (q1.rows.length > 0) {
    violations.push({
      invariant: 'BOOKED_SEATS_WITHOUT_CONFIRMED_BOOKING',
      count: q1.rows.length,
      sample: q1.rows.slice(0, 5),
    });
  }

  // Query 2: CONFIRMED bookings whose seat count differs from show_seats count
  const q2 = await dbPool.query(`
    SELECT b.id, b.seat_ids, array_length(b.seat_ids, 1) AS expected_count,
           COUNT(ss.seat_id) AS actual_booked_count
    FROM bookings b
    LEFT JOIN show_seats ss
      ON ss.show_id = b.show_id
     AND ss.booking_id = b.id
     AND ss.status = 'BOOKED'
    WHERE b.status = 'CONFIRMED'
    GROUP BY b.id, b.seat_ids
    HAVING array_length(b.seat_ids, 1) != COUNT(ss.seat_id)
  `);
  if (q2.rows.length > 0) {
    violations.push({
      invariant: 'CONFIRMED_BOOKINGS_SEAT_COUNT_MISMATCH',
      count: q2.rows.length,
      sample: q2.rows.slice(0, 5),
    });
  }

  // Query 3: HELD seats whose booking is EXPIRED, CANCELLED, REFUNDED or REFUND_PENDING
  const q3 = await dbPool.query(`
    SELECT ss.show_id, ss.seat_id, ss.booking_id, b.status AS booking_status
    FROM show_seats ss
    JOIN bookings b ON b.id = ss.booking_id
    WHERE ss.status = 'HELD'
      AND b.status IN ('EXPIRED', 'CANCELLED', 'REFUNDED', 'REFUND_PENDING')
  `);
  if (q3.rows.length > 0) {
    violations.push({
      invariant: 'HELD_SEATS_FOR_NON_ACTIVE_BOOKINGS',
      count: q3.rows.length,
      sample: q3.rows.slice(0, 5),
    });
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

// When invoked directly from the CLI
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('checkInvariants.js')) {
  try {
    const { passed, violations } = await checkInvariants(pool);
    if (passed) {
      console.log('✅  All invariants hold: 0 violations across all checks.');
      process.exit(0);
    } else {
      console.error('❌  Invariant check failed! Violations found:\n', JSON.stringify(violations, null, 2));
      process.exit(1);
    }
  } catch (err) {
    console.error('❌  Failed to check invariants:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}
