import assert from 'assert/strict';
import test from 'node:test';
import { classifyProviderFailure, executeProviderRequest, ProviderError, retryableStatus } from './provider';

test('provider requests retry retryable failures with a bound', async () => {
  let attempts = 0;
  const result = await executeProviderRequest({
    provider: 'webhook',
    operation: 'retry-test',
    timeoutMs: 1_000,
    maxAttempts: 3,
    run: async ({ requestId }) => {
      attempts += 1;
      if (attempts < 3) throw new ProviderError('temporary', 'webhook', true, requestId, 503);
      return 'ok';
    },
  });
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});

test('provider failure classification is consistent for HTTP, timeout, network, and permanent errors', () => {
  assert.equal(retryableStatus(408), true);
  assert.equal(retryableStatus(429), true);
  assert.equal(retryableStatus(503), true);
  assert.equal(retryableStatus(400), false);
  assert.equal(classifyProviderFailure(new TypeError('fetch failed')).retryable, true);
  assert.equal(classifyProviderFailure(Object.assign(new Error('reset'), { code: 'ECONNRESET' })).retryable, true);
  assert.equal(classifyProviderFailure(new ProviderError('invalid', 'webhook', false, 'request', 422)).retryable, false);
  assert.equal(classifyProviderFailure(new Error('application bug')).retryable, false);
});

test('provider requests do not retry permanent failures', async () => {
  let attempts = 0;
  await assert.rejects(() => executeProviderRequest({
    provider: 'webhook',
    operation: 'permanent-test',
    timeoutMs: 1_000,
    maxAttempts: 3,
    failureThreshold: 100,
    run: async ({ requestId }) => {
      attempts += 1;
      throw new ProviderError('invalid request', 'webhook', false, requestId, 400);
    },
  }), ProviderError);
  assert.equal(attempts, 1);
});

test('provider concurrency is bounded deterministically', async () => {
  let active = 0;
  let maximum = 0;
  await Promise.all(Array.from({ length: 6 }, () => executeProviderRequest({
    provider: 'webhook', operation: 'concurrency-test', timeoutMs: 1_000,
    maxAttempts: 1, concurrency: 2, failureThreshold: 100,
    run: async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return 'ok';
    },
  })));
  assert.equal(maximum, 2);
});

test('provider circuit opens after the configured deterministic failure threshold', async () => {
  await assert.rejects(() => executeProviderRequest({
    provider: 'ckb', operation: 'circuit-test', timeoutMs: 100,
    maxAttempts: 1, failureThreshold: 1, circuitResetMs: 60_000,
    run: async ({ requestId }) => { throw new ProviderError('unavailable', 'ckb', true, requestId, 503); },
  }), ProviderError);
  await assert.rejects(() => executeProviderRequest({
    provider: 'ckb', operation: 'circuit-test', timeoutMs: 100,
    run: async () => 'must-not-run',
  }), /circuit is open/);
});
