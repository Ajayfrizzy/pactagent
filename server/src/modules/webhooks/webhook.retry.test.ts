import test from 'node:test';
import assert from 'node:assert/strict';
import { getWebhookRetryDelayMs, WEBHOOK_RETRY_DELAYS_MS } from './webhook.retry';

test('webhook retry schedule is bounded', () => {
  assert.deepEqual(WEBHOOK_RETRY_DELAYS_MS, [
    60 * 1000,
    5 * 60 * 1000,
    15 * 60 * 1000,
    60 * 60 * 1000,
    6 * 60 * 60 * 1000,
  ]);

  assert.equal(getWebhookRetryDelayMs(1), 60 * 1000);
  assert.equal(getWebhookRetryDelayMs(5), 6 * 60 * 60 * 1000);
  assert.equal(getWebhookRetryDelayMs(6), null);
});
