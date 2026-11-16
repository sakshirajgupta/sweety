const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { newDb } = require('pg-mem');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { createApp, isDate, calendarToday } = require('../app');
const secret = 'test-only-secret-never-used-in-the-real-app-12345';
let db, app;
beforeEach(async () => {
  const memory = newDb();
  // pg-mem does not implement identity syntax; SERIAL is its equivalent here.
  const schema = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8').replaceAll('INTEGER GENERATED ALWAYS AS IDENTITY', 'SERIAL');
  memory.public.none(schema);
  const { Pool } = memory.adapters.createPg();
  db = new Pool();
  app = createApp({ db, jwtSecret: secret, today: () => '2026-10-15', logger: { error() {} } });
});
afterEach(async () => db.end());
async function account(email = 'patient@example.com') {
  const registered = await request(app).post('/api/auth/register').send({ name: 'Patient', email, password: 'Password123!' });
  assert.equal(registered.status, 201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Password123!' });
  assert.equal(login.status, 200);
  return { user: registered.body.user, token: login.body.token };
}
const auth = token => `Bearer ${token}`;
async function add(token, data = {}) {
  return request(app).post('/api/readings').set('Authorization', auth(token)).send({ date: '2026-10-15', slot: 'morning', value: 120, ...data });
}

test('registration hashes passwords, normalizes email, and rejects duplicates', async () => {
  const { user } = await account(' PATIENT@EXAMPLE.COM ');
  assert.equal(user.email, 'patient@example.com');
  assert.equal(user.password_hash, undefined);
  const stored = await db.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
  assert.notEqual(stored.rows[0].password_hash, 'Password123!');
  assert.equal(await bcrypt.compare('Password123!', stored.rows[0].password_hash), true);
  const duplicate = await request(app).post('/api/auth/register').send({ name: 'Other', email: 'PATIENT@example.com', password: 'Password123!' });
  assert.equal(duplicate.status, 409);
});

test('registration rejects missing fields, malformed email, short and oversized passwords', async () => {
  for (const body of [{}, { name: ' ', email: 'a@b.com', password: 'Password123!' }, { name: 'Patient', email: 'bad', password: 'Password123!' }, { name: 'Patient', email: 'a@b.com', password: 'short' }, { name: 'Patient', email: 'a@b.com', password: 'x'.repeat(73) }, { name: 'Patient', email: 'a@b.com', password: '🌸'.repeat(20) }]) {
    assert.equal((await request(app).post('/api/auth/register').send(body)).status, 400);
  }
});

test('login verifies credentials and signs an expiring token without password details', async () => {
  const { user, token } = await account();
  const claims = jwt.verify(token, secret, { algorithms: ['HS256'] });
  assert.equal(claims.userId, user.id);
  assert.equal(claims.exp - claims.iat, 3600);
  for (const email of ['patient@example.com', 'unknown@example.com']) {
    assert.equal((await request(app).post('/api/auth/login').send({ email, password: 'WrongPassword' })).status, 401);
  }
});

test('protected routes reject missing, altered, expired and invalid-identity tokens', async () => {
  const { token } = await account();
  const invalid = [null, token + 'altered', jwt.sign({ userId: 1 }, secret, { expiresIn: -1 }), jwt.sign({ userId: '1' }, secret)];
  for (const candidate of invalid) {
    let req = request(app).get('/api/readings');
    if (candidate) req = req.set('Authorization', auth(candidate));
    assert.equal((await req).status, 401);
  }
});

test('reading creation enforces values, real dates, future dates and slots', async () => {
  const { token } = await account();
  for (const value of [null, '', 39, 601, 120.5, '120']) assert.equal((await add(token, { value })).status, 400);
  for (const date of ['2026-02-30', '2026-13-01', '2026-10-16', '0000-01-01', 'bad']) assert.equal((await add(token, { date })).status, 400);
  assert.equal((await add(token, { slot: 'evening' })).status, 400);
  assert.equal((await add(token, { value: 40 })).status, 201);
  assert.equal((await add(token, { slot: 'after_breakfast', value: 600 })).status, 201);
});

test('only four slots per day, duplicates rejected, same slot on another date allowed', async () => {
  const { token } = await account();
  for (const slot of ['morning', 'after_breakfast', 'after_lunch', 'after_dinner']) assert.equal((await add(token, { slot })).status, 201);
  assert.equal((await add(token)).status, 409);
  assert.equal((await add(token, { date: '2026-10-14' })).status, 201);
  const list = await request(app).get('/api/readings?date=2026-10-15').set('Authorization', auth(token));
  assert.equal(list.body.readings.length, 4);
  assert.deepEqual(list.body.readings.map(row => row.slot), ['morning', 'after_breakfast', 'after_lunch', 'after_dinner']);
});

test('users cannot view, edit, delete or report on another user readings', async () => {
  const first = await account();
  const second = await account('other@example.com');
  const created = await add(first.token);
  const id = created.body.reading.id;
  assert.equal((await request(app).get('/api/readings').set('Authorization', auth(second.token))).body.readings.length, 0);
  assert.equal((await request(app).patch(`/api/readings/${id}`).set('Authorization', auth(second.token)).send({ value: 130 })).status, 404);
  assert.equal((await request(app).delete(`/api/readings/${id}`).set('Authorization', auth(second.token))).status, 404);
  assert.equal((await request(app).get('/api/reports?date=2026-10-15').set('Authorization', auth(second.token))).body.daily.count, 0);
});

test('partial edits retain other fields and reject duplicate slots and future dates', async () => {
  const { token } = await account();
  const created = await add(token);
  const id = created.body.reading.id;
  await add(token, { slot: 'after_lunch' });
  const edit = await request(app).patch(`/api/readings/${id}`).set('Authorization', auth(token)).send({ value: 125 });
  assert.equal(edit.status, 200);
  assert.deepEqual(edit.body.reading, { id, date: '2026-10-15', slot: 'morning', value: 125 });
  assert.equal((await request(app).patch(`/api/readings/${id}`).set('Authorization', auth(token)).send({ slot: 'after_lunch' })).status, 409);
  assert.equal((await request(app).patch(`/api/readings/${id}`).set('Authorization', auth(token)).send({ date: '2026-10-16' })).status, 400);
});

test('delete removes only the requested owned reading and handles missing IDs', async () => {
  const { token } = await account();
  const created = await add(token);
  const route = `/api/readings/${created.body.reading.id}`;
  assert.equal((await request(app).delete(route).set('Authorization', auth(token))).status, 200);
  assert.equal((await request(app).delete(route).set('Authorization', auth(token))).status, 404);
  assert.equal((await request(app).get('/api/readings').set('Authorization', auth(token))).body.readings.length, 0);
  assert.equal((await request(app).delete('/api/readings/abc').set('Authorization', auth(token))).status, 400);
});

test('reports use inclusive boundaries, individual-reading averages and previous month', async () => {
  const { token } = await account();
  for (const row of [
    { date: '2026-08-31', value: 600 },
    { date: '2026-09-01', value: 80 },
    { date: '2026-09-30', value: 120 },
    { date: '2026-10-01', value: 90 },
    { date: '2026-10-15', value: 100 },
    { date: '2026-10-15', slot: 'after_lunch', value: 140 },
  ]) assert.equal((await add(token, row)).status, 201);
  const response = await request(app).get('/api/reports?date=2026-10-15').set('Authorization', auth(token));
  assert.equal(response.status, 200);
  const { daily, monthToDate, monthly } = response.body;
  assert.equal(daily.count, 2); assert.equal(daily.highest, 140); assert.equal(daily.lowest, 100); assert.equal(daily.average, 120);
  assert.equal(daily.readings.length, 2);
  assert.equal(monthToDate.count, 3); assert.equal(monthToDate.average, 110);
  assert.equal(monthly.start, '2026-09-01'); assert.equal(monthly.end, '2026-09-30'); assert.equal(monthly.count, 2); assert.equal(monthly.average, 100);
  // Selected date must exclude later readings in the same month.
  const earlier = await request(app).get('/api/reports?date=2026-10-01').set('Authorization', auth(token));
  assert.equal(earlier.body.monthToDate.count, 1);
});

test('reports round average, return empty values and handle January and leap years', async () => {
  const { token } = await account();
  for (const [slot, value] of [['morning', 100], ['after_lunch', 101], ['after_dinner', 100]]) await add(token, { slot, value });
  const response = await request(app).get('/api/reports?date=2026-10-15').set('Authorization', auth(token));
  assert.equal(response.body.daily.average, 100.3);
  for (const [date, start, end] of [['2026-01-15', '2025-12-01', '2025-12-31'], ['2024-03-15', '2024-02-01', '2024-02-29']]) {
    const result = await request(app).get(`/api/reports?date=${date}`).set('Authorization', auth(token));
    assert.equal(result.body.monthly.start, start); assert.equal(result.body.monthly.end, end);
    assert.equal(result.body.daily.count, 0); assert.equal(result.body.daily.average, null);
  }
  assert.equal((await request(app).get('/api/reports?date=2026-10-16').set('Authorization', auth(token))).status, 400);
});

test('bad JSON and invalid date filters return understandable errors', async () => {
  const { token } = await account();
  assert.equal((await request(app).get('/api/readings?date=bad').set('Authorization', auth(token))).status, 400);
  assert.equal((await request(app).post('/api/auth/register').set('Content-Type', 'application/json').send('{')).status, 400);
  assert.equal((await request(app).get('/not-a-route')).status, 404);
  assert.equal(isDate('2024-02-29'), true); assert.equal(isDate('2026-02-29'), false);
  assert.match(calendarToday('Asia/Kolkata'), /^\d{4}-\d{2}-\d{2}$/);
});


test('PostgreSQL calendar dates stay unchanged in API responses, reports and partial edits', async () => {
  const dateTypes = require('../date-types');
  const { types } = require('pg');
  const parseDate = dateTypes.getTypeParser(types.builtins.DATE, 'text');
  assert.equal(parseDate('2026-10-15'), '2026-10-15');
  assert.equal(parseDate('2026-01-01'), '2026-01-01');
  assert.equal(parseDate('2024-02-29'), '2024-02-29');
  assert.equal(dateTypes.getTypeParser(types.builtins.INT4, 'text')('120'), 120);
  assert.ok(dateTypes.getTypeParser(types.builtins.TIMESTAMPTZ, 'text')('2026-10-15 12:00:00+00') instanceof Date);

  // pg-mem bypasses pg's wire parser. Adapt DATE results to the production
  // wire representation explicitly, so this test exercises the fixed path.
  const wireDb = {
    async query(sql, params) {
      const result = await db.query(sql, params);
      return { ...result, rows: result.rows.map(row => ({
        ...row,
        ...(row.reading_date !== undefined ? {
          reading_date: parseDate(row.reading_date instanceof Date
            ? row.reading_date.toISOString().slice(0, 10) : row.reading_date),
        } : {}),
      })) };
    },
  };
  app = createApp({ db: wireDb, jwtSecret: secret, today: () => '2026-10-15', logger: { error() {} } });
  const { token } = await account();
  const created = await add(token);
  assert.equal(created.status, 201);
  assert.equal(created.body.reading.date, '2026-10-15');
  const list = await request(app).get('/api/readings?date=2026-10-15').set('Authorization', auth(token));
  assert.equal(list.body.readings[0].date, '2026-10-15');
  const report = await request(app).get('/api/reports?date=2026-10-15').set('Authorization', auth(token));
  assert.equal(report.body.daily.count, 1);
  assert.equal(report.body.daily.readings[0].date, '2026-10-15');
  const edited = await request(app).patch(`/api/readings/${created.body.reading.id}`).set('Authorization', auth(token)).send({ value: 125 });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.reading.date, '2026-10-15');
  assert.equal(edited.body.reading.value, 125);
});

test('edge cases: non-numeric values and unexpected slot types are rejected', async () => {
  const { token } = await account();
  for (const value of [true, false, [], {}, -1, 0, 1000000000]) assert.equal((await add(token, { value })).status, 400);
  for (const slot of [null, {}, [], '__proto__', 'constructor', 'MORNING']) assert.equal((await add(token, { slot })).status, 400);
});

test('edge cases: simultaneous duplicate requests save exactly one reading', async () => {
  const { token } = await account();
  const responses = await Promise.all([add(token), add(token), add(token)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409, 409]);
  const list = await request(app).get('/api/readings').set('Authorization', auth(token));
  assert.equal(list.body.readings.length, 1);
});

test('edge cases: filling a day does not block another date and self-edit remains allowed', async () => {
  const { token } = await account();
  let morning;
  for (const slot of ['morning', 'after_breakfast', 'after_lunch', 'after_dinner']) {
    const added = await add(token, { slot });
    assert.equal(added.status, 201);
    if (slot === 'morning') morning = added.body.reading;
  }
  const edit = await request(app).patch(`/api/readings/${morning.id}`).set('Authorization', auth(token)).send({ value: 125 });
  assert.equal(edit.status, 200);
  assert.equal((await add(token, { date: '2026-10-14' })).status, 201);
});

test('edge cases: client-provided owner ID cannot reassign a reading', async () => {
  const first = await account();
  const second = await account('second@example.com');
  const created = await add(first.token, { user_id: second.user.id, userId: second.user.id });
  assert.equal(created.status, 201);
  const changed = await request(app).patch(`/api/readings/${created.body.reading.id}`).set('Authorization', auth(first.token)).send({ user_id: second.user.id, value: 130 });
  assert.equal(changed.status, 200);
  const list = await request(app).get('/api/readings').set('Authorization', auth(second.token));
  assert.equal(list.body.readings.length, 0);
});

test('edge cases: malformed date filters, ID bounds and oversized requests', async () => {
  const { token } = await account();
  for (const id of ['0', '-1', '1.5', '2147483648', 'abc']) {
    assert.equal((await request(app).delete(`/api/readings/${id}`).set('Authorization', auth(token))).status, 400);
  }
  assert.equal((await request(app).get('/api/readings?date=2026-10-15&date=2026-10-14').set('Authorization', auth(token))).status, 400);
  assert.equal((await request(app).get('/api/reports?date=not-a-date').set('Authorization', auth(token))).status, 400);
  assert.equal((await request(app).post('/api/auth/register').send({ name: 'x'.repeat(20000) })).status, 413);
});

test('edge cases: report summaries change after edits and deletions', async () => {
  const { token } = await account();
  const first = await add(token, { value: 100 });
  await add(token, { slot: 'after_lunch', value: 150 });
  const summaries = () => request(app).get('/api/reports?date=2026-10-15').set('Authorization', auth(token));
  assert.equal((await summaries()).body.daily.average, 125);
  await request(app).patch(`/api/readings/${first.body.reading.id}`).set('Authorization', auth(token)).send({ value: 120 });
  assert.equal((await summaries()).body.daily.average, 135);
  await request(app).delete(`/api/readings/${first.body.reading.id}`).set('Authorization', auth(token));
  const daily = (await summaries()).body.daily;
  assert.equal(daily.count, 1); assert.equal(daily.average, 150); assert.equal(daily.lowest, 150); assert.equal(daily.highest, 150);
});

test('edge cases: database failures return safe errors without leaking details', async () => {
  const failing = createApp({ db: { async query() { const error = new Error('private connection information'); error.code = 'TEST_FAILURE'; throw error; } }, jwtSecret: secret, today: () => '2026-10-15', logger: { error() {} } });
  const token = jwt.sign({ userId: 1 }, secret, { expiresIn: '1h' });
  for (const route of ['/api/readings', '/api/reports?date=2026-10-15', '/api/auth/me']) {
    const response = await request(failing).get(route).set('Authorization', auth(token));
    assert.equal(response.status, 500);
    assert.equal(JSON.stringify(response.body).includes('private connection information'), false);
  }
});

test('SW-005: concurrent partial edits preserve independent changes', async () => {
  const { token } = await account();
  const created = await add(token, { value: 120 });
  const id = created.body.reading.id;
  let count = 0;
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const concurrentDb = {
    async query(sql, params) {
      const result = await db.query(sql, params);
      if (sql.startsWith('SELECT id, reading_date, slot, value FROM readings WHERE id =')) {
        count++;
        if (count === 2) release();
        await barrier;
      }
      return result;
    },
  };
  const concurrentApp = createApp({ db: concurrentDb, jwtSecret: secret, today: () => '2026-10-15', logger: { error() {} } });
  const responses = await Promise.all([
    request(concurrentApp).patch(`/api/readings/${id}`).set('Authorization', auth(token)).send({ value: 125 }),
    request(concurrentApp).patch(`/api/readings/${id}`).set('Authorization', auth(token)).send({ slot: 'after_lunch' }),
  ]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  const row = (await db.query('SELECT slot, value FROM readings WHERE id = $1', [id])).rows[0];
  assert.deepEqual(row, { slot: 'after_lunch', value: 125 });
});
