import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSelectedDate, saveSelectedDate } from '../src/selected-date.js';
const today = '2026-11-16';
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
test('first visit starts on today', () => {
  assert.equal(loadSelectedDate(1, today, storage()), today);
});
test('historical selection survives a simulated reload', () => {
  const tab = storage();
  saveSelectedDate(1, '2026-11-13', tab);
  assert.equal(loadSelectedDate(1, today, tab), '2026-11-13');
});
test('accounts do not inherit each other selected dates', () => {
  const tab = storage();
  saveSelectedDate(1, '2026-10-13', tab);
  assert.equal(loadSelectedDate(2, today, tab), today);
  saveSelectedDate(2, '2026-11-15', tab);
  assert.equal(loadSelectedDate(1, today, tab), '2026-10-13');
});
test('returning to today replaces the remembered historical day', () => {
  const tab = storage();
  saveSelectedDate(1, '2026-10-13', tab);
  saveSelectedDate(1, today, tab);
  assert.equal(loadSelectedDate(1, today, tab), today);
});
test('invalid, impossible or future saved dates fall back to today', () => {
  for (const date of ['bad', '2026-02-30', '2026-11-17', '0000-01-01', '2026-1-1', '']) {
    const tab = { getItem: () => date };
    assert.equal(loadSelectedDate(1, today, tab), today);
  }
});
test('blocked browser storage never prevents using the dashboard', () => {
  const blocked = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); } };
  assert.equal(loadSelectedDate(1, today, blocked), today);
  assert.doesNotThrow(() => saveSelectedDate(1, '2026-11-13', blocked));
});
test('different tabs keep independent selections', () => {
  const first = storage(), second = storage();
  saveSelectedDate(1, '2026-11-13', first);
  assert.equal(loadSelectedDate(1, today, second), today);
});
