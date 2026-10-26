/**
 * seed.js
 *
 * Dev-only seed script. Truncates all tables and re-inserts:
 * - 2 demo users (Alice and Bob) with argon2-hashed password
 * - 2 theaters in Chandigarh with 3 screens total
 * - Standard 96-seat layout per screen (Row C blocked, aisles at col 7)
 * - 5 fictional movies
 * - Shows for today + next 2 days (slots 10:30, 14:00, 19:30, 22:45)
 * - show_seats inventory (active seats only; GOLD = 32000, SILVER = 22000)
 * - Scattered BOOKED and HELD demo seats on the first show
 *
 * Run with: npm run seed
 */
import argon2 from 'argon2';
import pg from 'pg';
import { env } from '../../config/env.js';

async function seed() {
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();

  console.log('🌱  Seeding database...');

  try {
    await client.query('BEGIN');

    // 1. Truncate all tables in dependency order
    await client.query(`
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

    // 2. Demo Users
    const passwordHash = await argon2.hash('Password123');
    const userRes = await client.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES
         ('Alice Smith', 'alice@example.com', $1),
         ('Bob Jones',   'bob@example.com',   $1)
       RETURNING id, email`,
      [passwordHash]
    );
    const [alice, bob] = userRes.rows;

    // 3. Theaters
    const theaterRes = await client.query(`
      INSERT INTO theaters (name, address, city, timezone)
      VALUES
        ('Aster Cinema - Sector 17', 'Sector 17, Central Complex', 'Chandigarh', 'Asia/Kolkata'),
        ('Lumen Pictures - Elante',  'Elante Mall, Industrial Area Phase I', 'Chandigarh', 'Asia/Kolkata')
      RETURNING id, name
    `);
    const [aster, lumen] = theaterRes.rows;

    // 4. Screens
    const screenRes = await client.query(`
      INSERT INTO screens (theater_id, name, format)
      VALUES
        (${aster.id}, 'Screen 1', 'LASER'),
        (${aster.id}, 'Screen 2', '2D'),
        (${lumen.id}, 'Audi 1',   'IMAX')
      RETURNING id, theater_id, name, format
    `);
    const screens = screenRes.rows;

    // 5. Seats for every screen (8 rows A-H, 12 seats each, aisle at col 7)
    // Rows A-F: GOLD (32000 paise). Rows G-H: SILVER (22000 paise).
    // Row C is inactive (is_active = false, blocked).
    const rowLabels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    for (const screen of screens) {
      for (let r = 0; r < rowLabels.length; r++) {
        const rowLabel = rowLabels[r];
        const gridRow = r + 1;
        const section = (r < 6) ? 'GOLD' : 'SILVER';
        const isActive = (rowLabel !== 'C');

        for (let seatNum = 1; seatNum <= 12; seatNum++) {
          const seatLabel = String(seatNum);
          // Col 1-6 for seats 1-6; Col 8-13 for seats 7-12 (Col 7 is the aisle gap)
          const gridCol = (seatNum <= 6) ? seatNum : seatNum + 1;

          await client.query(
            `INSERT INTO seats (screen_id, row_label, seat_label, section, grid_row, grid_col, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [screen.id, rowLabel, seatLabel, section, gridRow, gridCol, isActive]
          );
        }
      }
    }

    // 6. Movies
    const movieRes = await client.query(`
      INSERT INTO movies (title, synopsis, duration_min, certificate, languages, genres, poster_url, release_date)
      VALUES
        ('The Last Orbit', 'A crew stranded beyond lunar orbit races to decipher an alien transmission before life support fails.', 138, 'UA 13+', ARRAY['Hindi', 'English'], ARRAY['Sci-fi', 'Adventure'], NULL, '2026-10-01'),
        ('Where Tides Return', 'An estranged father and daughter reunite on a coastal lighthouse facing imminent demolition.', 124, 'U', ARRAY['Malayalam', 'Hindi'], ARRAY['Drama', 'Adventure'], NULL, '2026-10-05'),
        ('Neon After Midnight', 'A late-night radio host receives frantic calls from a vigilante roaming the monsooned city.', 116, 'A', ARRAY['Hindi'], ARRAY['Thriller', 'Mystery'], NULL, '2026-10-10'),
        ('The Sunday Garden', 'Two rival botanists in old Delhi uncover an heirloom flower that only blooms once every decade.', 128, 'UA 13+', ARRAY['Hindi', 'Punjabi'], ARRAY['Romance', 'Drama'], NULL, '2026-10-15'),
        ('Beyond the Ridge', 'High school runners training in the Shivalik hills uncover an environmental crime threatening their valley.', 110, 'U', ARRAY['English', 'Hindi'], ARRAY['Adventure', 'Drama'], NULL, '2026-10-20')
      RETURNING id, title, languages
    `);
    const movies = movieRes.rows;

    // 7. Shows (today and next 2 days in Asia/Kolkata)
    // Slots: 10:30, 14:00, 19:30, 22:45
    // Round-robin movie assignment, only future shows.
    const now = new Date();
    const timeSlots = ['10:30', '14:00', '19:30', '22:45'];
    let movieIdx = 0;
    const createdShows = [];

    // Get current date components in Asia/Kolkata
    for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
      const d = new Date(now.getTime() + dayOffset * 86400000);
      const dateStr = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD

      for (const slot of timeSlots) {
        const startsAt = new Date(`${dateStr}T${slot}:00+05:30`);
        if (startsAt <= now) {
          continue; // Only future slots
        }

        for (const screen of screens) {
          const movie = movies[movieIdx % movies.length];
          movieIdx++;

          const showRes = await client.query(
            `INSERT INTO shows (movie_id, screen_id, starts_at, language, format)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, movie_id, screen_id, starts_at, language, format`,
            [movie.id, screen.id, startsAt.toISOString(), movie.languages[0], screen.format]
          );
          const show = showRes.rows[0];
          createdShows.push(show);

          // Create show_seats for this show from all ACTIVE seats for this screen.
          // Blocked seats (Row C) have is_active=false, so they receive NO show_seats row.
          await client.query(
            `INSERT INTO show_seats (show_id, seat_id, status, price_cents)
             SELECT $1, s.id, 'AVAILABLE',
                    CASE WHEN s.section = 'GOLD' THEN 32000 ELSE 22000 END
             FROM seats s
             WHERE s.screen_id = $2 AND s.is_active = true`,
            [show.id, screen.id]
          );
        }
      }
    }

    // 8. Scatter realistic BOOKED and HELD seats on the first upcoming show
    if (createdShows.length > 0) {
      const firstShow = createdShows[0];

      // Get seat IDs for Row A seats 5, 6 (GOLD) and Row G seats 3, 4 (SILVER)
      const seatRows = await client.query(
        `SELECT id, row_label, seat_label, section FROM seats
         WHERE screen_id = $1 AND (
           (row_label = 'A' AND seat_label IN ('5', '6')) OR
           (row_label = 'G' AND seat_label IN ('3', '4'))
         )`,
        [firstShow.screen_id]
      );

      const bookedSeats = seatRows.rows.filter(s => s.row_label === 'A');
      const heldSeats   = seatRows.rows.filter(s => s.row_label === 'G');

      // Alice has a confirmed booking for A5 and A6
      if (bookedSeats.length === 2) {
        const totalCents = 32000 * 2;
        const bRes = await client.query(
          `INSERT INTO bookings (ref, user_id, show_id, status, seat_ids, total_cents, hold_expires_at, paid_at)
           VALUES ('PL-DEMO001', $1, $2, 'CONFIRMED', $3, $4, now() + interval '8 minutes', now())
           RETURNING id`,
          [alice.id, firstShow.id, bookedSeats.map(s => s.id), totalCents]
        );
        const bookingId = bRes.rows[0].id;

        await client.query(
          `UPDATE show_seats
           SET status = 'BOOKED', booking_id = $1, hold_expires_at = NULL
           WHERE show_id = $2 AND seat_id = ANY($3)`,
          [bookingId, firstShow.id, bookedSeats.map(s => s.id)]
        );
      }

      // Bob has an active hold for G3 and G4 (valid for 8 minutes)
      if (heldSeats.length === 2) {
        const totalCents = 22000 * 2;
        const holdExpires = new Date(Date.now() + 8 * 60 * 1000);
        const bRes = await client.query(
          `INSERT INTO bookings (ref, user_id, show_id, status, seat_ids, total_cents, hold_expires_at, paid_at)
           VALUES ('PL-DEMO002', $1, $2, 'CREATED', $3, $4, $5, NULL)
           RETURNING id`,
          [bob.id, firstShow.id, heldSeats.map(s => s.id), totalCents, holdExpires.toISOString()]
        );
        const bookingId = bRes.rows[0].id;

        await client.query(
          `UPDATE show_seats
           SET status = 'HELD', booking_id = $1, hold_expires_at = $2
           WHERE show_id = $3 AND seat_id = ANY($4)`,
          [bookingId, holdExpires.toISOString(), firstShow.id, heldSeats.map(s => s.id)]
        );
      }
    }

    await client.query('COMMIT');
    console.log('✅  Database seeded successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌  Seed failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

seed();
