import assert from 'node:assert/strict';
import test from 'node:test';
import { getSettlementStatus } from './health.service';

test('settlement readiness fails closed on RPC failure when required', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('RPC unavailable'); });
  assert.deepEqual(await getSettlementStatus(true, 'https://node.example', 'https://indexer.example'), { status: 'error' });
});

test('settlement readiness requires valid node and indexer responses', async (t) => {
  const methods: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => {
    methods.push((JSON.parse(String(init?.body)) as { method: string }).method);
    return new Response(JSON.stringify({ jsonrpc: '2.0', result: { hash: '0x1' } }), { status: 200 });
  });
  assert.deepEqual(
    await getSettlementStatus(true, 'https://node.example', 'https://indexer.example'),
    { status: 'ok' },
  );
  assert.deepEqual(methods.sort(), ['get_indexer_tip', 'get_tip_header']);
});
