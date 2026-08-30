import assert from 'node:assert/strict';
import test from 'node:test';
import { getJobRetryDelayMs, queueForJobKind } from './jobQueueService';

test('job kinds route to isolated worker queues', () => {
  assert.equal(queueForJobKind('DELIVER_WEBHOOK'), 'webhook');
  assert.equal(queueForJobKind('CKB_RECONCILE_TRANSACTION'), 'settlement');
});

test('job retry delay is exponential, bounded, and jittered', () => {
  assert.equal(getJobRetryDelayMs(1, () => 0.5), 5_000);
  assert.equal(getJobRetryDelayMs(2, () => 0.5), 10_000);
  assert.equal(getJobRetryDelayMs(3, () => 0), 10_000);
  assert.equal(getJobRetryDelayMs(20, () => 0.5), 900_000);
  assert.equal(getJobRetryDelayMs(20, () => 0), 450_000);
});
