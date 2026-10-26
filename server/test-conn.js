// Quick connectivity test — run with: node test-conn.js
import pg from 'pg';

// Test multiple connection strings
const urls = [
  'postgresql://postgres:postgres@localhost:5432/parallellock',
  'postgresql://postgres:postgres@127.0.0.1:5432/parallellock',
];

for (const url of urls) {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    const { rows } = await client.query('SELECT current_database() as db');
    console.log(`✅ [${url}] Connected:`, rows[0]);
    await client.end();
  } catch (err) {
    console.error(`❌ [${url}] Failed: ${err.message}`);
    try { await client.end(); } catch(_) {}
  }
}
