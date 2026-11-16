import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingChanges } from '../src/reading-changes.js';
const original = { id: 1, date: '2026-11-15', slot: 'morning', value: 120 };
test('editing only the value does not send a stale date or slot from another tab', () => {
  assert.deepEqual(readingChanges(original, { ...original, value: 125 }), { value: 125 });
});
test('editing slot or date preserves independent concurrent value edits', () => {
  assert.deepEqual(readingChanges(original, { ...original, slot: 'after_lunch' }), { slot: 'after_lunch' });
  assert.deepEqual(readingChanges(original, { ...original, date: '2026-11-14' }), { date: '2026-11-14' });
});
test('unchanged edit does not send a write and owner fields are never included', () => {
  assert.deepEqual(readingChanges(original, { ...original, user_id: 99 }), {});
});
