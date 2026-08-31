import assert from 'assert/strict';
import test from 'node:test';
import { MemoryAuthChallengeStore } from './authChallengeStore';

test('auth challenges bind address and message and consume exactly once', async () => {
  const store = new MemoryAuthChallengeStore();
  const record = { address: 'ckt1-test', message: 'exact message', expiresAt: Date.now() + 60_000 };
  await store.put(record, 60_000);
  assert.deepEqual(await store.get(record.address), record);
  assert.equal(await store.consume(record.address, 'wrong message'), false);
  assert.deepEqual(await store.get(record.address), record);
  assert.equal(await store.consume(record.address, record.message), true);
  assert.equal(await store.consume(record.address, record.message), false);
});

test('expired auth challenges cannot be read or consumed', async () => {
  const store = new MemoryAuthChallengeStore();
  await store.put({ address: 'ckt1-expired', message: 'message', expiresAt: Date.now() - 1 }, 1);
  assert.equal(await store.get('ckt1-expired'), null);
  assert.equal(await store.consume('ckt1-expired', 'message'), false);
});
