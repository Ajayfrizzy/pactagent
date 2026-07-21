import assert from 'node:assert/strict';
import test from 'node:test';
import { validateHealth, validateReadiness } from './deployment-smoke.mjs';

test('release smoke validation accepts a matching healthy release', () => {
  assert.doesNotThrow(() => validateHealth({ data: { status: 'ok', commit: 'abc' } }, 'abc'));
  assert.doesNotThrow(() => validateReadiness({ data: {
    status: 'ready', commit: 'abc', database: 'ok',
    worker: { status: 'ok', queuedJobs: 0, deadLetterJobs: 0 },
    settlement: { status: 'ok' },
  } }, 'abc'));
});

test('release smoke validation fails closed for stale workers and release mismatch', () => {
  assert.throws(() => validateHealth({ data: { status: 'ok', commit: 'old' } }, 'new'), /does not match/);
  assert.throws(() => validateReadiness({ data: {
    status: 'ready', commit: 'new', database: 'ok',
    worker: { status: 'stale', queuedJobs: 0, deadLetterJobs: 0 },
    settlement: { status: 'ok' },
  } }, 'new'), /Worker smoke/);
});
