import assert from 'node:assert/strict';
import test from 'node:test';
import { getSettlementStatus } from './health.service';

test('settlement readiness fails closed on RPC failure when required', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('RPC unavailable'); });
  assert.deepEqual(await getSettlementStatus(true), { status: 'error' });
});

test('settlement readiness accepts a valid CKB RPC response', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ jsonrpc: '2.0', result: { hash: '0x1' } }), { status: 200 }));
  assert.deepEqual(await getSettlementStatus(true), { status: 'ok' });
});
