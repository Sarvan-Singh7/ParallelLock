/**
 * catalog.repo.js – Database queries for movies and shows catalog
 */
import pool from '../../db/pool.js';

export const catalogRepo = {
  /**
   * Fetch all movies ordered by release date descending.
   */
  async listMovies(db = pool) {
    const { rows } = await db.query(`
      SELECT
        id,
        title,
        synopsis,
        duration_min,
        certificate,
        languages,
        genres,
        poster_url,
        release_date
      FROM movies
      ORDER BY release_date DESC, id ASC
    `);
    return rows;
  },

  /**
   * Find movie by ID.
   */
  async findMovieById(movieId, db = pool) {
    const { rows } = await db.query(
      `SELECT
         id,
         title,
         synopsis,
         duration_min,
         certificate,
         languages,
         genres,
         poster_url,
         release_date
       FROM movies
       WHERE id = $1`,
      [movieId]
    );
    return rows[0] || null;
  },

  /**
   * Fetch upcoming shows for a movie in the next 3 IST days with seat availability counts.
   * freeSeats is computed in a single grouped query: AVAILABLE or expired HELD show_seats.
   */
  async listShowsForMovie(movieId, db = pool) {
    const { rows } = await db.query(
      `SELECT
         s.id AS show_id,
         s.starts_at,
         s.language,
         s.format,
         to_char(s.starts_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS show_date,
         sc.id AS screen_id,
         sc.name AS screen_name,
         t.id AS theater_id,
         t.name AS theater_name,
         t.address AS theater_address,
         t.city AS theater_city,
         count(ss.seat_id)::int AS total_seats,
         count(ss.seat_id) FILTER (
           WHERE ss.status = 'AVAILABLE' OR (ss.status = 'HELD' AND ss.hold_expires_at <= now())
         )::int AS free_seats
       FROM shows s
       JOIN screens sc ON sc.id = s.screen_id
       JOIN theaters t ON t.id = sc.theater_id
       LEFT JOIN show_seats ss ON ss.show_id = s.id
       WHERE s.movie_id = $1
         AND s.starts_at > now()
         AND s.starts_at < (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '3 days') AT TIME ZONE 'Asia/Kolkata'
       GROUP BY s.id, sc.id, t.id
       ORDER BY s.starts_at ASC, t.id ASC, sc.id ASC`,
      [movieId]
    );
    return rows;
  },
};
