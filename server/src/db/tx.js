import pool from './pool.js';

/**
 * withTransaction(fn)
 *
 * Acquires a client from the pool, begins a transaction, calls fn(client),
 * commits on success, rolls back on any error, then releases the client.
 *
 * Usage:
 *   const result = await withTransaction(async (client) => {
 *     const { rows } = await client.query('SELECT ...', [...]);
 *     return rows;
 *   });
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
