/**
 * migrate.js
 *
 * Reads every *.sql file from src/db/migrations/ in lexicographic order
 * (so 001_... always runs before 002_...) and runs each one exactly once,
 * recording the filename in the schema_migrations table.
 *
 * Run with: npm run migrate
 */
import fs   from 'node:fs/promises';
import path  from 'node:path';
import { fileURLToPath } from 'node:url';
import pg    from 'pg';
import { env } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function migrate() {
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();

  try {
    // Ensure the tracking table exists before anything else.
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // List all .sql files, sorted so they run in order.
    const files = (await fs.readdir(MIGRATIONS_DIR))
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      // Skip migrations that have already been applied.
      const { rows } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [file]
      );
      if (rows.length > 0) {
        console.log(`  skip  ${file}`);
        continue;
      }

      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        console.log(`  apply ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ERROR in ${file}:`, err.message);
        process.exit(1);
      }
    }

    console.log('✅  Migrations complete.');
  } finally {
    await client.end();
  }
}

migrate().catch(err => {
  console.error('Migration runner failed:', err);
  process.exit(1);
});
