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
const testUrl = env.TEST_DATABASE_URL || env.DATABASE_URL;

export const testPool = new pg.Pool({ connectionString: testUrl });

export async function setupTestDb() {
  const schemaPath = path.join(__dirname, '../../src/db/migrations/001_schema.sql');
  const schemaSql = await fs.readFile(schemaPath, 'utf8');

  // Check if tables already exist
  const res = await testPool.query(`
    SELECT to_regclass('public.users') as exists;
  `);

  if (!res.rows[0].exists) {
    await testPool.query(schemaSql);
  }
}

export async function cleanDb() {
  await testPool.query(`
    TRUNCATE TABLE
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

  // Future show
  const showRes = await pool.query(`
    INSERT INTO shows (movie_id, screen_id, starts_at, language, format)
    VALUES ($1, $2, now() + interval '2 hours', 'Hindi', 'LASER')
    RETURNING id
  `, [movieId, screenId]);
  const showId = showRes.rows[0].id;

  // Inventory for active seats
  for (const sId of seatIds) {
    await pool.query(`
      INSERT INTO show_seats (show_id, seat_id, status, price_cents)
      VALUES ($1, $2, 'AVAILABLE', 32000)
    `, [showId, sId]);
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
