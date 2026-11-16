const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { newDb } = require('pg-mem');
const bcrypt = require('bcrypt');
const { calendarToday } = require('../app');

test('demo seed creates valid fictional data and leaves existing demo data unchanged on repeat', async () => {
  const memory = newDb();
  memory.public.none(fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8').replaceAll('INTEGER GENERATED ALWAYS AS IDENTITY', 'SERIAL'));
  const { Pool } = memory.adapters.createPg();
  const db = new Pool();
  const fakeProcess = { argv: ['node', 'seed.js', '--confirm-sweety'], env: {}, exitCode: 0 };
  const messages = [];
  const script = fs.readFileSync(path.join(__dirname, '../scripts/seed.js'), 'utf8');
  const runSeed = () => vm.runInNewContext(script, {
    Buffer,
    process: fakeProcess,
    console: { log: message => messages.push(message), error: (...args) => messages.push(args.join(' ')) },
    require(name) {
      if (name === '../db') return { connect: () => db.connect(), end: async () => {} };
      if (name === 'bcrypt') return bcrypt;
      if (name === '../app') return { calendarToday };
      throw new Error('Unexpected dependency');
    },
  });
  try {
    await runSeed();
    assert.equal(fakeProcess.exitCode, 0, messages.join('\n'));
    const users = await db.query('SELECT id, email, password_hash FROM users');
    const rows = await db.query('SELECT user_id, reading_date, slot, value FROM readings');
    assert.equal(users.rowCount, 1);
    assert.equal(rows.rowCount, 150);
    assert.equal(await bcrypt.compare('SweetyDemo123!', users.rows[0].password_hash), true);
    const byDate = new Map();
    for (const row of rows.rows) {
      const date = row.reading_date.toISOString().slice(0, 10);
      assert.ok(date <= calendarToday());
      assert.equal(row.user_id, users.rows[0].id);
      const slots = byDate.get(date) || new Set();
      assert.equal(slots.has(row.slot), false);
      assert.ok(row.value >= 40 && row.value <= 600 && Number.isInteger(row.value));
      slots.add(row.slot); byDate.set(date, slots);
    }
    assert.equal(byDate.size, 45);
    assert.ok([...byDate.values()].every(slots => slots.size <= 4));
    await runSeed();
    assert.equal(fakeProcess.exitCode, 0, messages.join('\n'));
    assert.equal((await db.query('SELECT id FROM readings')).rowCount, 150);
    assert.equal((await db.query('SELECT password_hash FROM users')).rows[0].password_hash, users.rows[0].password_hash);
  } finally { await db.end(); }
});
