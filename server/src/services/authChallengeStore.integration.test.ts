import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, describe } from 'node:test';
import { RedisAuthChallengeStore } from './authChallengeStore';

const redisUrl = process.env.REDIS_INTEGRATION_URL;

describe('Redis auth challenge durability', redisUrl ? {} : {
  skip: 'Set REDIS_INTEGRATION_URL to run Redis challenge integration tests.',
}, () => {
  const first = new RedisAuthChallengeStore(redisUrl || 'redis://127.0.0.1:6379');
  const second = new RedisAuthChallengeStore(redisUrl || 'redis://127.0.0.1:6379');

  before(async () => {
    const address = `ckt1-probe-${randomUUID()}`;
    await first.put({ address, message: 'probe', expiresAt: Date.now() + 1_000 }, 1_000);
    await first.consume(address, 'probe');
  });
  after(async () => {
    await first.close();
    await second.close();
  });

  test('challenge is shared across instances and consumed atomically once', async () => {
    const address = `ckt1-${randomUUID()}`;
    const record = { address, message: `challenge-${randomUUID()}`, expiresAt: Date.now() + 5_000 };
    await first.put(record, 5_000);
    assert.deepEqual(await second.get(address), record);
    assert.equal(await second.consume(address, 'wrong-message'), false);
    assert.deepEqual(await first.get(address), record);

    const outcomes = await Promise.all([
      first.consume(address, record.message),
      second.consume(address, record.message),
    ]);
    assert.deepEqual(outcomes.sort(), [false, true]);
    assert.equal(await first.get(address), null);
  });

  test('Redis TTL removes an unconsumed challenge', async () => {
    const address = `ckt1-${randomUUID()}`;
    await first.put({ address, message: 'short-lived', expiresAt: Date.now() + 20 }, 20);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(await second.get(address), null);
  });
});
