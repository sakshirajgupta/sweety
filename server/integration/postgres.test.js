const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const request = require('supertest');
const { createApp } = require('../app');
const dateTypes = require('../date-types');

// Intentionally do not import db.js or dotenv. Never accept a production URL.
const url = new URL(process.env.SWEETY_TEST_DATABASE_URL || 'postgresql://sweety_test:sweety_test@127.0.0.1:5432/sweety_test');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/sweety_test' || url.username !== 'sweety_test') {
  throw new Error('Integration tests require a loopback sweety_test database and sweety_test role. External databases are forbidden.');
}
const schema = `test_${randomBytes(12).toString('hex')}`;
const admin = new Pool({ connectionString: url.toString() });
const db = new Pool({ connectionString: url.toString(), types: dateTypes, options: `-c search_path=${schema}`, max: 8 });
const secret = 'postgres-integration-only-secret-not-for-production';
let app;
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  // Exercise the exact production DDL, including identity and constraints.
  await db.query(fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8'));
  app = createApp({ db, jwtSecret: secret, today: () => '2026-10-15', logger: { error() {} } });
});
beforeEach(async () => { await db.query('TRUNCATE readings, users RESTART IDENTITY'); });
after(async () => {
  await db.end();
  try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
  finally { await admin.end(); }
});
async function account(email = 'patient@example.com') {
  const registered = await request(app).post('/api/auth/register').send({ name: 'Test Patient', email, password: 'Password123!' });
  assert.equal(registered.status, 201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Password123!' });
  assert.equal(login.status, 200);
  return { user: registered.body.user, token: login.body.token };
}
const auth = token => `Bearer ${token}`;
const add = (token, fields = {}) => request(app).post('/api/readings').set('Authorization', auth(token)).send({ date: '2026-10-15', slot: 'morning', value: 120, ...fields });

test('real PostgreSQL identity, DATE wire values, foreign keys and unique slots', async () => {
  const { user, token } = await account();
  assert.equal(user.id, 1);
  const added = await add(token);
  assert.equal(added.status, 201);
  assert.equal(added.body.reading.date, '2026-10-15');
  const row = (await db.query('SELECT reading_date FROM readings')).rows[0];
  assert.equal(row.reading_date, '2026-10-15');
  await assert.rejects(db.query('INSERT INTO readings (user_id, reading_date, slot, value) VALUES ($1,$2,$3,$4)', [999, '2026-10-15', 'morning', 120]), { code: '23503' });
  assert.equal((await add(token)).status, 409);
});

test('real PostgreSQL simultaneous duplicates create one record, independent dates stay allowed', async () => {
  const { token } = await account();
  const results = await Promise.all([add(token), add(token), add(token)]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409, 409]);
  for (const slot of ['after_breakfast', 'after_lunch', 'after_dinner']) assert.equal((await add(token, { slot })).status, 201);
  assert.equal((await add(token, { date: '2026-10-14' })).status, 201);
  assert.equal((await db.query('SELECT id FROM readings')).rowCount, 5);
});

test('real PostgreSQL owner isolation and deletion', async () => {
  const first = await account(), other = await account('other@example.com');
  const id = (await add(first.token)).body.reading.id;
  assert.equal((await request(app).get('/api/readings').set('Authorization', auth(other.token))).body.readings.length, 0);
  assert.equal((await request(app).patch(`/api/readings/${id}`).set('Authorization', auth(other.token)).send({ value: 130 })).status, 404);
  assert.equal((await request(app).delete(`/api/readings/${id}`).set('Authorization', auth(other.token))).status, 404);
  assert.equal((await request(app).get('/api/reports?date=2026-10-15').set('Authorization', auth(other.token))).body.daily.count, 0);
  assert.equal((await request(app).delete(`/api/readings/${id}`).set('Authorization', auth(first.token))).status, 200);
});

test('real PostgreSQL reports respect month boundaries, rounding and leap years', async () => {
  const { token } = await account();
  for (const reading of [
    { date: '2026-08-31', value: 600 }, { date: '2026-09-01', value: 80 },
    { date: '2026-09-30', value: 120 }, { date: '2026-10-01', value: 90 },
    { date: '2026-10-15', value: 100 }, { date: '2026-10-15', slot: 'after_lunch', value: 141 },
  ]) assert.equal((await add(token, reading)).status, 201);
  const data = (await request(app).get('/api/reports?date=2026-10-15').set('Authorization', auth(token))).body;
  assert.equal(data.daily.count, 2); assert.equal(data.daily.average, 120.5);
  assert.equal(data.monthToDate.count, 3); assert.equal(data.monthToDate.average, 110.3);
  assert.equal(data.monthly.count, 2); assert.equal(data.monthly.average, 100);
  assert.equal(data.monthly.start, '2026-09-01'); assert.equal(data.monthly.end, '2026-09-30');
  const leap = (await request(app).get('/api/reports?date=2024-03-15').set('Authorization', auth(token))).body;
  assert.equal(leap.monthly.end, '2024-02-29'); assert.equal(leap.daily.average, null);
});

test('real PostgreSQL overlapping partial edits preserve both independent changes', async () => {
  const { token } = await account(); const id = (await add(token)).body.reading.id;
  let reads = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  const concurrentDb = { async query(sql, params) {
    const result = await db.query(sql, params);
    if (sql.startsWith('SELECT id, reading_date, slot, value FROM readings WHERE id =')) {
      if (++reads === 2) release();
      await barrier;
    }
    return result;
  } };
  const concurrent = createApp({ db: concurrentDb, jwtSecret: secret, today: () => '2026-10-15' });
  const results = await Promise.all([
    request(concurrent).patch(`/api/readings/${id}`).set('Authorization', auth(token)).send({ value: 125 }),
    request(concurrent).patch(`/api/readings/${id}`).set('Authorization', auth(token)).send({ slot: 'after_lunch' }),
  ]);
  assert.deepEqual(results.map(result => result.status), [200, 200]);
  assert.deepEqual((await db.query('SELECT value, slot FROM readings WHERE id=$1', [id])).rows[0], { value: 125, slot: 'after_lunch' });
});
