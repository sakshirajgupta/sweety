const fs = require('node:fs');
const path = require('node:path');
if (!process.argv.includes('--confirm-sweety')) {
  console.error('Check DATABASE_URL points to the separate Sweety project, then run npm run db:setup -- --confirm-sweety.');
  process.exit(1);
}
const pool = require('../db');
(async () => {
  try {
    await pool.query(fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8'));
    console.log('Sweety tables are ready. Existing data was preserved.');
  } catch (error) {
    console.error('Database setup failed:', error.code || error.name);
    process.exitCode = 1;
  } finally { await pool.end(); }
})();
