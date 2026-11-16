import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
let storage, events, sequence = 0;
const user = { id: 7, name: 'Test Patient', email: 'patient@example.com' };
const load = () => import(`../src/api.js?test=${++sequence}`);
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  storage = new Map(); events = new EventTarget();
  globalThis.window = {
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    dispatchEvent: event => events.dispatchEvent(event),
  };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
});
test('refresh reloads the saved token and verifies the account before restoring login', async () => {
  const first = await load(); first.setToken('example-session-token');
  assert.equal(storage.get('sweety.token'), 'example-session-token');
  const reloaded = await load();
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/auth/me');
    assert.equal(options.headers.Authorization, 'Bearer example-session-token');
    return reply({ user });
  };
  assert.deepEqual(await reloaded.restoreSession(), user);
});
test('logout removes the token and reload remains unauthenticated', async () => {
  const page = await load(); page.setToken('example-session-token'); page.setToken(null);
  globalThis.fetch = async () => assert.fail('No request expected');
  assert.equal(storage.has('sweety.token'), false);
  assert.equal(await (await load()).restoreSession(), null);
});
test('expired session clears storage and notifies the app', async () => {
  storage.set('sweety.token', 'expired-token'); let expired = false;
  events.addEventListener('session-expired', () => { expired = true; });
  globalThis.fetch = async () => reply({ message: 'Please log in again.' }, 401);
  assert.equal(await (await load()).restoreSession(), null);
  assert.equal(storage.has('sweety.token'), false); assert.equal(expired, true);
});
test('temporary backend failure keeps the token and allows retry', async () => {
  storage.set('sweety.token', 'valid-token'); const page = await load();
  globalThis.fetch = async () => new Response('', { status: 500 });
  await assert.rejects(page.restoreSession(), /backend is running/);
  assert.equal(storage.get('sweety.token'), 'valid-token');
  globalThis.fetch = async () => reply({ user });
  assert.deepEqual(await page.restoreSession(), user);
});
test('network failure does not clear the session', async () => {
  storage.set('sweety.token', 'valid-token');
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects((await load()).restoreSession(), /Cannot reach the server/);
  assert.equal(storage.has('sweety.token'), true);
});
test('incorrect login does not trigger a session-expired notification', async () => {
  let expired = false; events.addEventListener('session-expired', () => { expired = true; });
  globalThis.fetch = async () => reply({ message: 'Invalid email or password.' }, 401);
  await assert.rejects((await load()).api('/auth/login', { method: 'POST', body: {} }), /Invalid email/);
  assert.equal(expired, false);
});
