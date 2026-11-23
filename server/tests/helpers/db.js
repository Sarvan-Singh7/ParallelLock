/**
 * db.js – Test database helper
 *
 * Provides connection management and setup/teardown functions for the
 * dedicated parallellock_test database.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../../src/config/env.js';
import appPool from '../../src/db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (!env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL environment variable is required to run tests. ' +
    'Refusing to run tests against the main DATABASE_URL to prevent data loss.'
  );
}
const testUrl = env.TEST_DATABASE_URL;

export const testPool = new pg.Pool({ connectionString: testUrl });

export async function setupTestDb() {
  const migrationsDir = path.join(__dirname, '../../src/db/migrations');
  const files = (await fs.readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  await testPool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // If tables existed before migration tracking was added to test db, record 001_schema.sql
  const usersCheck = await testPool.query(`SELECT to_regclass('public.users') as exists;`);
  if (usersCheck.rows[0].exists) {
    await testPool.query(`
      INSERT INTO schema_migrations (filename) VALUES ('001_schema.sql')
      ON CONFLICT (filename) DO NOTHING;
    `);
  }

  for (const file of files) {
    const { rows } = await testPool.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [file]
    );
    if (rows.length === 0) {
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      await testPool.query('BEGIN');
      try {
        await testPool.query(sql);
        await testPool.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file]
        );
        await testPool.query('COMMIT');
      } catch (err) {
        await testPool.query('ROLLBACK');
        throw err;
      }
    }
  }
}

export async function cleanDb() {
  await testPool.query(`
    TRUNCATE TABLE
      payment_events,
      payments,
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
}

export async function seedTestShow(pool = testPool) {
  // Insert test user
  const userRes = await pool.query(`
    INSERT INTO users (name, email, password_hash)
    VALUES ('Alice Test', 'alice.test@example.com', 'hash123')
    RETURNING id
  `);
  const userId = userRes.rows[0].id;

  // Insert theater, screen
  const tRes = await pool.query(`
    INSERT INTO theaters (name, address, city)
    VALUES ('Test Theater', '123 Test St', 'Chandigarh')
    RETURNING id
  `);
  const theaterId = tRes.rows[0].id;

  const sRes = await pool.query(`
    INSERT INTO screens (theater_id, name, format)
    VALUES ($1, 'Test Screen', 'LASER')
    RETURNING id
  `, [theaterId]);
  const screenId = sRes.rows[0].id;

  // Insert active seats (Row A 1-12)
  const seatIds = [];
  for (let i = 1; i <= 12; i++) {
    const res = await pool.query(`
      INSERT INTO seats (screen_id, row_label, seat_label, section, grid_row, grid_col, is_active)
      VALUES ($1, 'A', $2, 'GOLD', 1, $3, true)
      RETURNING id
    `, [screenId, String(i), i]);
    seatIds.push(Number(res.rows[0].id));
  }

  // Insert 1 blocked seat (Row C 1, is_active=false)
  const bRes = await pool.query(`
    INSERT INTO seats (screen_id, row_label, seat_label, section, grid_row, grid_col, is_active)
    VALUES ($1, 'C', '1', 'GOLD', 3, 1, false)
    RETURNING id
  `, [screenId]);
  const blockedSeatId = Number(bRes.rows[0].id);

  // Movie
  const mRes = await pool.query(`
    INSERT INTO movies (title, synopsis, duration_min, certificate, languages, genres, release_date)
    VALUES ('Test Movie', 'Synopsis', 120, 'UA', ARRAY['Hindi'], ARRAY['Drama'], '2026-10-01')
    RETURNING id
  `);
  const movieId = mRes.rows[0].id;

  // ----- Shows that all start today (few minutes apart) -----
  // 1️⃣ First show – starts in 5 minutes
  const showRes1 = await pool.query(`
    INSERT INTO shows (movie_id, screen_id, starts_at, language, format)
    VALUES ($1, $2, now() + interval '5 minutes', 'Hindi', 'LASER')
    RETURNING id
  `, [movieId, screenId]);
  const showId1 = showRes1.rows[0].id;

  // 2️⃣ Second show – starts in 15 minutes
  const showRes2 = await pool.query(`
    INSERT INTO shows (movie_id, screen_id, starts_at, language, format)
    VALUES ($1, $2, now() + interval '15 minutes', 'Hindi', 'LASER')
    RETURNING id
  `, [movieId, screenId]);
  const showId2 = showRes2.rows[0].id;

  // 3️⃣ Third show – starts in 30 minutes
  const showRes3 = await pool.query(`
    INSERT INTO shows (movie_id, screen_id, starts_at, language, format)
    VALUES ($1, $2, now() + interval '30 minutes', 'Hindi', 'LASER')
    RETURNING id
  `, [movieId, screenId]);
  const showId3 = showRes3.rows[0].id;

  // Use the first show for the standard test flow
  const showId = showId1;

  // ----- Populate seats for each show -----
  for (const sId of seatIds) {
    // Show 1
    await pool.query(`
      INSERT INTO show_seats (show_id, seat_id, status, price_cents)
      VALUES ($1, $2, 'AVAILABLE', 32000)
    `, [showId1, sId]);
    // Show 2
    await pool.query(`
      INSERT INTO show_seats (show_id, seat_id, status, price_cents)
      VALUES ($1, $2, 'AVAILABLE', 32000)
    `, [showId2, sId]);
    // Show 3
    await pool.query(`
      INSERT INTO show_seats (show_id, seat_id, status, price_cents)
      VALUES ($1, $2, 'AVAILABLE', 32000)
    `, [showId3, sId]);
  }

  return {
    userId: String(userId),
    theaterId: String(theaterId),
    screenId: String(screenId),
    showId: String(showId),
    seatIds,
    blockedSeatId,
  };
}

export async function closeDb() {
  await testPool.end();
  await appPool.end();
}
