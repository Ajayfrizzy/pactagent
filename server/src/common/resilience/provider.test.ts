import assert from 'assert/strict';
import test from 'node:test';
import { executeProviderRequest, ProviderError } from './provider';

test('provider requests retry retryable failures with a bound', async () => {
  let attempts = 0;
  const result = await executeProviderRequest({
    provider: 'market_price',
    operation: 'retry-test',
    timeoutMs: 1_000,
    maxAttempts: 3,
    run: async ({ requestId }) => {
      attempts += 1;
      if (attempts < 3) throw new ProviderError('temporary', 'market_price', true, requestId, 503);
      return 'ok';
    },
  });
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});

test('provider requests do not retry permanent failures', async () => {
  let attempts = 0;
  await assert.rejects(() => executeProviderRequest({
    provider: 'forum',
    operation: 'permanent-test',
    timeoutMs: 1_000,
    maxAttempts: 3,
    failureThreshold: 100,
    run: async ({ requestId }) => {
      attempts += 1;
      throw new ProviderError('invalid request', 'forum', false, requestId, 400);
    },
  }), ProviderError);
  assert.equal(attempts, 1);
});
