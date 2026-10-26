/**
 * auth.repo.js – Database access for users table
 *
 * Repository layer: strictly SQL queries, no business logic.
 */
import pool from '../../db/pool.js';
import { errors } from '../../common/errors.js';

export const authRepo = {
  /**
   * Find a user by their lowercase email.
   */
  async findByEmail(email, db = pool) {
    const { rows } = await db.query(
      `SELECT id, name, email, password_hash, created_at
       FROM users
       WHERE email = $1`,
      [email]
    );
    return rows[0] || null;
  },

  /**
   * Find a user by their ID.
   */
  async findById(id, db = pool) {
    const { rows } = await db.query(
      `SELECT id, name, email, created_at
       FROM users
       WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  },

  /**
   * Insert a new user. Catches unique constraint violations on email (23505)
   * and maps to EMAIL_TAKEN AppError.
   */
  async createUser({ name, email, passwordHash }, db = pool) {
    try {
      const { rows } = await db.query(
        `INSERT INTO users (name, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, name, email, created_at`,
        [name, email, passwordHash]
      );
      return rows[0];
    } catch (err) {
      if (err.code === '23505') {
        throw errors.emailTaken();
      }
      throw err;
    }
  },
};
