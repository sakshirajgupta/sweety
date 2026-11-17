import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { subscribeToTabReturn } from '../src/tab-refresh.js';
function environment() {
  const target = new EventTarget(), page = new EventTarget();
  page.visibilityState = 'visible';
  return { target, page };
}
test('focus and visibility return coalesce into one refresh', async () => {
  const { target, page } = environment(); let calls = 0;
  const stop = subscribeToTabReturn(() => calls++, target, page);
  target.dispatchEvent(new Event('focus')); page.dispatchEvent(new Event('visibilitychange'));
  await wait(10); assert.equal(calls, 1); stop();
});
test('hidden tabs do not fetch and cleanup removes listeners and queued work', async () => {
  const { target, page } = environment(); let calls = 0;
  const stop = subscribeToTabReturn(() => calls++, target, page);
  page.visibilityState = 'hidden'; target.dispatchEvent(new Event('focus'));
  await wait(10); assert.equal(calls, 0);
  page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange'));
  stop(); await wait(10); assert.equal(calls, 0);
  target.dispatchEvent(new Event('focus')); await wait(10); assert.equal(calls, 0);
});
