/**
 * demoParallel.js – Concurrency demonstration against the RUNNING server
 *
 * Demonstrates the core row-locking guarantee:
 * Takes seatId and N (default: 20 parallel requests), mints N tokens,
 * fires N parallel hold requests for that exact seat, prints a summary
 * (201 wins vs 409 rejections) and checks the final HELD row count in Postgres.
 *
 * Usage:
 *   node --env-file=.env scripts/demoParallel.js [showId] [seatId] [N]
 *   npm run demo:parallel
 */
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env.js';

function mintToken(userId, name) {
  return jwt.sign(
    { sub: String(userId), name },
    env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

async function run() {
  const showId = process.argv[2] || '1';
  const N = parseInt(process.argv[4] || process.argv[3] || '20', 10);
  const baseUrl = `http://localhost:${env.PORT || 4000}`;

  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();

  let seatId = process.argv[3] && !isNaN(parseInt(process.argv[3])) && process.argv[4] ? process.argv[3] : null;

  if (!seatId) {
    // Pick the first available seat on this show
    const { rows } = await client.query(
      `SELECT seat_id FROM show_seats
       WHERE show_id = $1 AND status = 'AVAILABLE'
       ORDER BY seat_id ASC LIMIT 1`,
      [showId]
    );
    if (rows.length === 0) {
      console.error(`❌  No available seats found for show ${showId}.`);
      await client.end();
      process.exit(1);
    }
    seatId = rows[0].seat_id;
  }

  console.log(`\n🚀  Firing ${N} parallel hold requests for seat ${seatId} on show ${showId}...`);
  console.log(`Target: ${baseUrl}/api/v1/shows/${showId}/holds\n`);

  // Ensure demo users exist in database to satisfy foreign keys
  for (let i = 1; i <= N; i++) {
    await client.query(
      `INSERT INTO users (id, name, email, password_hash)
       VALUES ($1, $2, $3, 'hash')
       ON CONFLICT (id) DO NOTHING`,
      [20000 + i, `DemoUser_${i}`, `demouser_${20000 + i}@demo.local`]
    );
  }

  const requests = [];
  for (let i = 1; i <= N; i++) {
    const token = mintToken(20000 + i, `DemoUser_${i}`);
    requests.push(
      fetch(`${baseUrl}/api/v1/shows/${showId}/holds`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ seatIds: [Number(seatId)] }),
      }).then(async (res) => {
        const body = await res.json().catch(() => ({}));
        return { status: res.status, body };
      })
    );
  }

  const results = await Promise.all(requests);

  let successCount = 0;
  let rejectedCount = 0;
  let otherCount = 0;

  for (const r of results) {
    if (r.status === 201) successCount++;
    else if (r.status === 409) rejectedCount++;
    else otherCount++;
  }

  console.log('=== Parallel Hold Results ===');
  console.log(`Total parallel attempts: ${N}`);
  console.log(`201 CREATED (Holds won): ${successCount}`);
  console.log(`409 SEAT_UNAVAILABLE:   ${rejectedCount}`);
  if (otherCount > 0) {
    console.log(`Other responses:         ${otherCount}`);
  }

  // Verify in PostgreSQL
  const { rows } = await client.query(
    `SELECT count(*)::int AS count FROM show_seats
     WHERE show_id = $1 AND seat_id = $2 AND status = 'HELD'`,
    [showId, seatId]
  );
  console.log(`\nDatabase verification: Exactly ${rows[0].count} HELD row in show_seats.`);

  if (successCount === 1 && rows[0].count === 1) {
    console.log('✅  GUARANTEE VERIFIED: Exactly one winner, zero double-holds.\n');
  } else {
    console.error('❌  GUARANTEE FAILED: Multiple winners or zero winners.\n');
  }

  await client.end();
}

run().catch((err) => {
  console.error('Demo script error:', err);
  process.exit(1);
});
