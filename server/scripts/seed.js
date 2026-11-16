if (!process.argv.includes('--confirm-sweety')) {
  console.error('Check DATABASE_URL points to the separate Sweety project, then run npm run seed -- --confirm-sweety.');
  process.exit(1);
}
const pool = require('../db');
const bcrypt = require('bcrypt');
const { calendarToday } = require('../app');
(async () => {
  let client;
  try {
    const email = (process.env.DEMO_EMAIL || 'demo@sweety.example').trim().toLowerCase();
    const password = process.env.DEMO_PASSWORD || 'SweetyDemo123!';
    if (password.length < 8 || Buffer.byteLength(password) > 72) throw new Error('Invalid demo password');
    client = await pool.connect();
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount) {
      await client.query('ROLLBACK');
      console.log('Demo account already exists; no data or password was changed.');
      return;
    }
    const hash = await bcrypt.hash(password, 10);
    const user = await client.query('INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id', ['Sweety Demo', email, hash]);
    const today = calendarToday(process.env.APP_TIMEZONE || 'Asia/Kolkata');
    const slots = ['morning', 'after_breakfast', 'after_lunch', 'after_dinner'];
    for (let day = 0; day < 45; day++) {
      const date = new Date(`${today}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() - day);
      for (let slot = 0; slot < (day % 3 === 0 ? 2 : 4); slot++) {
        await client.query('INSERT INTO readings (user_id, reading_date, slot, value) VALUES ($1, $2, $3, $4)', [user.rows[0].id, date.toISOString().slice(0, 10), slots[slot], 90 + ((day * 7 + slot * 19) % 95)]);
      }
    }
    await client.query('COMMIT');
    console.log('Created a demo account with 45 days of fictional readings. Credentials are the DEMO_EMAIL / DEMO_PASSWORD defaults or your .env settings.');
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('Seed failed:', error.code || error.name);
    process.exitCode = 1;
  } finally { if (client) client.release(); await pool.end(); }
})();
