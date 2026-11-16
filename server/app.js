const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const SLOTS = {
  morning: 'Morning (fasting)',
  after_breakfast: 'After breakfast',
  after_lunch: 'After lunch',
  after_dinner: 'After dinner',
};

function calendarToday(timeZone = 'Asia/Kolkata') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function readingError({ date, slot, value }, today) {
  if (value === undefined || value === null || value === '') return 'Please enter a glucose value.';
  if (!Number.isInteger(value) || value < 40 || value > 600) return 'Value must be a whole number between 40 and 600 mg/dl.';
  if (!isDate(date)) return 'Please enter a valid date (YYYY-MM-DD).';
  if (date > today) return 'Date cannot be in the future.';
  if (typeof slot !== 'string' || !Object.hasOwn(SLOTS, slot)) return 'Please select one of the four reading slots.';
  return null;
}

function dateText(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
function publicReading(row) {
  return { id: row.id, date: dateText(row.reading_date), slot: row.slot, value: row.value };
}
function report(rows) {
  const values = rows.map(row => row.value);
  return {
    count: values.length,
    highest: values.length ? Math.max(...values) : null,
    lowest: values.length ? Math.min(...values) : null,
    average: values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)) : null,
  };
}

function createApp({ db, jwtSecret, today = () => calendarToday(), logger = console }) {
  if (!jwtSecret || Buffer.byteLength(jwtSecret) < 32) throw new Error('JWT_SECRET must be at least 32 bytes.');
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  const body = req => req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const fail = (res, status, message) => res.status(status).json({ message });
  const validId = value => /^[1-9]\d*$/.test(value) && Number(value) <= 2147483647;
  const serverError = (res, error, message) => {
    // Log only the error code, never connection strings, passwords or SQL parameters.
    logger.error('Request failed:', error.code || error.name);
    return fail(res, 500, message);
  };

  function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return fail(res, 401, 'Please log in to continue.');
    try {
      const claims = jwt.verify(header.slice(7), jwtSecret, { algorithms: ['HS256'] });
      if (!Number.isSafeInteger(claims.userId) || claims.userId < 1) throw new Error('Invalid identity');
      req.userId = claims.userId;
      next();
    } catch {
      return fail(res, 401, 'Your login is invalid or expired. Please log in again.');
    }
  }

  app.get('/', (req, res) => res.send('Sweety API is running.'));
  app.post('/api/auth/register', async (req, res) => {
    const { name, email, password } = body(req);
    if ([name, email, password].some(value => typeof value !== 'string' || !value.trim())) return fail(res, 400, 'Name, email and password are required.');
    if (name.trim().length > 100) return fail(res, 400, 'Name must be 100 characters or fewer.');
    if (email.trim().length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return fail(res, 400, 'Please enter a valid email address.');
    if (password.length < 8) return fail(res, 400, 'Password must be at least 8 characters long.');
    if (Buffer.byteLength(password, 'utf8') > 72) return fail(res, 400, 'Password must be 72 bytes or fewer.');
    try {
      const hash = await bcrypt.hash(password, 10);
      const result = await db.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, created_at',
        [name.trim(), email.trim().toLowerCase(), hash]
      );
      return res.status(201).json({ message: 'Account created successfully.', user: result.rows[0] });
    } catch (error) {
      if (error.code === '23505') return fail(res, 409, 'An account with this email already exists.');
      return serverError(res, error, 'Unable to process registration. Please try again.');
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = body(req);
    if ([email, password].some(value => typeof value !== 'string' || !value.trim())) return fail(res, 400, 'Email and password are required.');
    if (Buffer.byteLength(password, 'utf8') > 72) return fail(res, 401, 'Invalid email or password.');
    try {
      const result = await db.query('SELECT id, name, email, password_hash FROM users WHERE email = $1', [email.trim().toLowerCase()]);
      const user = result.rows[0];
      if (!user || !(await bcrypt.compare(password, user.password_hash))) return fail(res, 401, 'Invalid email or password.');
      const token = jwt.sign({ userId: user.id }, jwtSecret, { algorithm: 'HS256', expiresIn: '1h' });
      return res.json({ message: 'Login successful.', token, user: { id: user.id, name: user.name, email: user.email } });
    } catch (error) {
      return serverError(res, error, 'Unable to log in. Please try again.');
    }
  });

  app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
      const result = await db.query('SELECT id, name, email FROM users WHERE id = $1', [req.userId]);
      if (!result.rowCount) return fail(res, 401, 'Please log in with an existing account.');
      return res.json({ user: result.rows[0], userId: req.userId });
    } catch (error) {
      return serverError(res, error, 'Unable to load account.');
    }
  });

  function writeError(res, error, slot) {
    if (error.code === '23505') return fail(res, 409, `You already have a ${SLOTS[slot]} reading for this date.`);
    if (error.code === '23503') return fail(res, 401, 'Please log in with an existing account.');
    return serverError(res, error, 'Unable to save reading. Please try again.');
  }

  app.post('/api/readings', requireAuth, async (req, res) => {
    const reading = body(req);
    const error = readingError(reading, today());
    if (error) return fail(res, 400, error);
    try {
      // Four permitted slots plus UNIQUE(user_id, reading_date, slot) enforce
      // the four-reading limit even when requests arrive simultaneously.
      const result = await db.query(
        'INSERT INTO readings (user_id, reading_date, slot, value) VALUES ($1, $2, $3, $4) RETURNING id, reading_date, slot, value',
        [req.userId, reading.date, reading.slot, reading.value]
      );
      return res.status(201).json({ message: 'Reading saved successfully.', reading: publicReading(result.rows[0]) });
    } catch (error) {
      return writeError(res, error, reading.slot);
    }
  });

  app.get('/api/readings', requireAuth, async (req, res) => {
    if (req.query.date !== undefined && !isDate(req.query.date)) return fail(res, 400, 'Please enter a valid date (YYYY-MM-DD).');
    try {
      const params = [req.userId];
      let sql = 'SELECT id, reading_date, slot, value FROM readings WHERE user_id = $1';
      if (req.query.date !== undefined) { params.push(req.query.date); sql += ' AND reading_date = $2'; }
      const result = await db.query(sql, params);
      const readings = result.rows.map(publicReading).sort((a, b) => b.date.localeCompare(a.date) || Object.keys(SLOTS).indexOf(a.slot) - Object.keys(SLOTS).indexOf(b.slot));
      return res.json({ message: readings.length ? 'Readings retrieved successfully.' : 'No readings recorded yet.', readings });
    } catch (error) {
      return serverError(res, error, 'Unable to load readings. Please try again.');
    }
  });

  app.patch('/api/readings/:id', requireAuth, async (req, res) => {
    if (!validId(req.params.id)) return fail(res, 400, 'Please provide a valid reading ID.');
    let slot;
    try {
      const found = await db.query('SELECT id, reading_date, slot, value FROM readings WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
      if (!found.rowCount) return fail(res, 404, 'Reading not found.');
      const current = publicReading(found.rows[0]);
      const input = body(req);
      const reading = {
        date: Object.hasOwn(input, 'date') ? input.date : current.date,
        slot: Object.hasOwn(input, 'slot') ? input.slot : current.slot,
        value: Object.hasOwn(input, 'value') ? input.value : current.value,
      };
      slot = reading.slot;
      const error = readingError(reading, today());
      if (error) return fail(res, 400, error);
      // Only update supplied fields. Never write omitted fields from the old
      // snapshot, because another request may have changed them meanwhile.
      // Column names come from this fixed map; user values stay parameterized.
      const columns = { date: 'reading_date', slot: 'slot', value: 'value' };
      const fields = Object.keys(columns).filter(key => Object.hasOwn(input, key));
      if (fields.length === 0) return fail(res, 400, 'Please provide a date, slot or value to update.');
      const params = fields.map(key => reading[key]);
      const assignments = fields.map((key, index) => `${columns[key]} = $${index + 1}`);
      params.push(req.params.id, req.userId);
      const result = await db.query(
        `UPDATE readings SET ${assignments.join(', ')} WHERE id = $${fields.length + 1} AND user_id = $${fields.length + 2} RETURNING id, reading_date, slot, value`,
        params
      );
      if (!result.rowCount) return fail(res, 404, 'Reading not found.');
      return res.json({ message: 'Reading updated successfully.', reading: publicReading(result.rows[0]) });
    } catch (error) {
      return writeError(res, error, slot);
    }
  });

  app.delete('/api/readings/:id', requireAuth, async (req, res) => {
    if (!validId(req.params.id)) return fail(res, 400, 'Please provide a valid reading ID.');
    try {
      const result = await db.query('DELETE FROM readings WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.userId]);
      if (!result.rowCount) return fail(res, 404, 'Reading not found.');
      return res.json({ message: 'Reading deleted successfully.' });
    } catch (error) {
      return serverError(res, error, 'Unable to delete reading. Please try again.');
    }
  });

  app.get('/api/reports', requireAuth, async (req, res) => {
    const date = req.query.date || today();
    if (!isDate(date)) return fail(res, 400, 'Please enter a valid date (YYYY-MM-DD).');
    if (date > today()) return fail(res, 400, 'Date cannot be in the future.');
    const monthStart = `${date.slice(0, 7)}-01`;
    const lastMonthEnd = new Date(`${monthStart}T00:00:00Z`);
    lastMonthEnd.setUTCDate(0);
    const previousEnd = lastMonthEnd.toISOString().slice(0, 10);
    const previousStart = `${previousEnd.slice(0, 7)}-01`;
    try {
      const result = await db.query('SELECT id, reading_date, slot, value FROM readings WHERE user_id = $1 AND reading_date >= $2 AND reading_date <= $3', [req.userId, previousStart, date]);
      const rows = result.rows.map(publicReading);
      const dailyRows = rows.filter(row => row.date === date).sort((a, b) => Object.keys(SLOTS).indexOf(a.slot) - Object.keys(SLOTS).indexOf(b.slot));
      return res.json({
        selectedDate: date,
        daily: { start: date, end: date, ...report(dailyRows), readings: dailyRows },
        monthToDate: { start: monthStart, end: date, ...report(rows.filter(row => row.date >= monthStart)) },
        monthly: { start: previousStart, end: previousEnd, ...report(rows.filter(row => row.date <= previousEnd)) },
      });
    } catch (error) {
      return serverError(res, error, 'Unable to load reports. Please try again.');
    }
  });

  app.use((req, res) => fail(res, 404, 'API route not found.'));
  app.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') return fail(res, 400, 'Please send valid JSON.');
    if (error.type === 'entity.too.large') return fail(res, 413, 'Request is too large.');
    return serverError(res, error, 'Something went wrong. Please try again.');
  });
  return app;
}

module.exports = { createApp, calendarToday, isDate };
