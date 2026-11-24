/**
 * seedBench.js – Dedicated benchmark database seeder (L1)
 *
 * Seeds:
 * - 200 benchmark users with pre-minted JWT tokens
 * - 1 theater, 1 large screen with 300 active seats (15 rows x 20 cols)
 * - 25 future shows with all 300 seats in AVAILABLE status
 *
 * Exported functions:
 * - seedBenchData(): seeds the DB and returns { users, tokens, showIds, seatIds }
 */
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { env } from '../../src/config/env.js';

export async function seedBenchData() {
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();

  try {
    await client.query('BEGIN');

    // 1. Truncate tables in dependency order
    await client.query(`
      TRUNCATE TABLE
        payment_events,
        payments,
        booking_items,
        show_seats,
        bookings,
        shows,
        movies,
        seats,
        screens,
        theaters,
        users
      RESTART IDENTITY CASCADE;
    `);

    // 2. Insert 200 benchmark users
    const passwordHash = await argon2.hash('BenchPassword123');
    const userValues = [];
    const userParams = [passwordHash];

    for (let i = 1; i <= 200; i++) {
      userParams.push(`Bench User ${i}`, `bench_user_${i}@example.com`);
      const offset = 2 + (i - 1) * 2;
      userValues.push(`($${offset}, $${offset + 1}, $1)`);
    }

    const { rows: userRows } = await client.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ${userValues.join(', ')}
       RETURNING id, name, email`,
      userParams
    );

    // Pre-mint JWT tokens for all 200 users
    const tokens = userRows.map((u) => {
      const token = jwt.sign(
        { sub: String(u.id), id: String(u.id), name: u.name, email: u.email },
        env.JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '2h' }
      );
      return { userId: String(u.id), token };
    });

    // 3. Theater & Screen
    const { rows: tRows } = await client.query(`
      INSERT INTO theaters (name, address, city, timezone)
      VALUES ('Benchmark Arena', 'Sector 82, Tech Zone', 'Chandigarh', 'Asia/Kolkata')
      RETURNING id
    `);
    const theaterId = tRows[0].id;

    const { rows: scRows } = await client.query(`
      INSERT INTO screens (theater_id, name, format)
      VALUES ($1, 'Mega IMAX Auditorium', 'IMAX')
      RETURNING id
    `, [theaterId]);
    const screenId = scRows[0].id;

    // 4. Seats: 15 rows (A through O) x 20 columns = 300 seats
    const rowLabels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];
    const seatValues = [];
    const seatParams = [screenId];
    let pIdx = 2;

    for (let r = 0; r < rowLabels.length; r++) {
      const row = rowLabels[r];
      const section = r < 5 ? 'GOLD' : 'SILVER';
      for (let c = 1; c <= 20; c++) {
        seatParams.push(row, String(c), section, r + 1, c);
        seatValues.push(`($1, $${pIdx}, $${pIdx + 1}, $${pIdx + 2}, $${pIdx + 3}, $${pIdx + 4}, true)`);
        pIdx += 5;
      }
    }

    const { rows: seatRows } = await client.query(`
      INSERT INTO seats (screen_id, row_label, seat_label, section, grid_row, grid_col, is_active)
      VALUES ${seatValues.join(', ')}
      RETURNING id, row_label, seat_label, section
    `, seatParams);

    const seatIds = seatRows.map((s) => Number(s.id));

    // 5. Movie
    const { rows: mRows } = await client.query(`
      INSERT INTO movies (title, synopsis, duration_min, certificate, languages, genres, release_date)
      VALUES (
        'The Quantum Concurrency',
        'A thrilling high-scale movie benchmark experience.',
        150,
        'UA',
        ARRAY['English', 'Hindi'],
        ARRAY['Sci-Fi', 'Thriller'],
        '2026-11-23'
      )
      RETURNING id
    `);
    const movieId = mRows[0].id;

    // 6. 25 Shows (starts_at from now + 1 hour to now + 25 hours)
    const showValues = [];
    const showParams = [movieId, screenId];
    let sIdx = 3;

    for (let h = 1; h <= 25; h++) {
      showParams.push(`now() + interval '${h} hours'`);
      // Use literal interval in SQL
      showValues.push(`($1, $2, now() + interval '${h} hours', 'English', 'IMAX')`);
    }

    const { rows: showRows } = await client.query(`
      INSERT INTO shows (movie_id, screen_id, starts_at, language, format)
      VALUES ${showValues.join(', ')}
      RETURNING id
    `, [movieId, screenId]);

    const showIds = showRows.map((sh) => Number(sh.id));

    // 7. Populate show_seats: 25 shows x 300 seats = 7,500 show_seats
    for (const sId of showIds) {
      const ssValues = [];
      const ssParams = [sId];
      let ssIdx = 2;

      for (const seat of seatRows) {
        const price = seat.section === 'GOLD' ? 35000 : 25000;
        ssParams.push(seat.id, price);
        ssValues.push(`($1, $${ssIdx}, 'AVAILABLE', $${ssIdx + 1})`);
        ssIdx += 2;
      }

      await client.query(`
        INSERT INTO show_seats (show_id, seat_id, status, price_cents)
        VALUES ${ssValues.join(', ')}
      `, ssParams);
    }

    await client.query('COMMIT');

    return {
      users: userRows,
      tokens,
      showIds,
      seatIds,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

// Allow direct CLI execution: node --env-file=.env scripts/bench/seedBench.js
if (process.argv[1] && process.argv[1].endsWith('seedBench.js')) {
  seedBenchData()
    .then((res) => {
      console.log(`✅  Seeded ${res.users.length} users, ${res.showIds.length} shows, ${res.seatIds.length} seats.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌  Seed error:', err);
      process.exit(1);
    });
}
