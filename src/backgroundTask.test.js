import test from 'node:test';
import assert from 'node:assert/strict';
import { runBackgroundTask } from './backgroundTask.js';
test('failed background reads settle and identify the operation without exporting private errors', async () => {
  const events = [];
  assert.equal(await runBackgroundTask(async () => { throw Error('private receipt'); }, 'management_refresh_failed', (...args) => events.push(args)), false);
  assert.deepEqual(events, [['error', 'management_refresh_failed']]);
});
test('successful reads run once and reporting failures cannot create rejection loops', async () => {
  let calls = 0;
  assert.equal(await runBackgroundTask(async () => { calls++; }, 'unused', () => assert.fail()), true);
  assert.equal(calls, 1);
  assert.equal(await runBackgroundTask(() => { throw Error(); }, 'management_refresh_failed', () => { throw Error(); }), false);
});
