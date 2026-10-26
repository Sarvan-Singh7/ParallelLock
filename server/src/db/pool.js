import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

// A single pool is shared across the whole process.
// Tests import this module after setting process.env.DATABASE_URL to the
const connectionString = (process.env.NODE_ENV === 'test' && env.TEST_DATABASE_URL)
  ? env.TEST_DATABASE_URL
  : env.DATABASE_URL;

const pool = new Pool({ connectionString });

pool.on('error', (err) => {
  // Log unexpected idle-client errors so they surface in the server logs.
  console.error('Unexpected pg pool error', err);
});

export default pool;
