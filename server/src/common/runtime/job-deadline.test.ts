import assert from 'node:assert/strict';
import test from 'node:test';
import { runWithJobDeadline } from './job-deadline';

test('job deadline returns completed work', async () => {
  assert.equal(await runWithJobDeadline(100, async () => 'done'), 'done');
});

test('job deadline aborts cooperative work', async () => {
  await assert.rejects(
    () => runWithJobDeadline(10, (signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })),
    /execution deadline/,
  );
});
