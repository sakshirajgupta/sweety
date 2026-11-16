const pool = require('./db');
const { createApp, calendarToday } = require('./app');
const PORT = process.env.PORT || 4000;
const timeZone = process.env.APP_TIMEZONE || 'Asia/Kolkata';
const app = createApp({ db: pool, jwtSecret: process.env.JWT_SECRET, today: () => calendarToday(timeZone) });

async function start() {
  try {
    await pool.query('SELECT 1');
    const server = app.listen(PORT, () => console.log(`Sweety API is running at http://localhost:${PORT}`));
    server.on('error', () => { console.error('Could not start server. Check whether the port is already in use.'); pool.end(); process.exitCode = 1; });
    const stop = () => server.close(async () => { await pool.end(); });
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    console.error('Database connection failed:', error.code || error.name);
    await pool.end();
    process.exitCode = 1;
  }
}
start();
