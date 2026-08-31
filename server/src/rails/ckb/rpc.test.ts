import assert from 'node:assert/strict';
import test from 'node:test';
import { CkbIndexerRpcClient, CkbNodeRpcClient } from './rpc';

test('CKB node and indexer clients use only their explicit RPC endpoints and methods', async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { id: number; method: string };
    calls.push({ url: String(url), method: request.method });
    const result = request.method === 'get_cells'
      ? { objects: [], last_cursor: '0x' }
      : request.method === 'get_indexer_tip'
        ? { block_hash: `0x${'1'.repeat(64)}`, block_number: '0x10' }
      : request.method === 'get_tip_header'
        ? { hash: `0x${'1'.repeat(64)}`, number: '0x10' }
        : null;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { status: 200 });
  }) as typeof fetch;

  const node = new CkbNodeRpcClient('https://node.example.test', fakeFetch);
  const indexer = new CkbIndexerRpcClient('https://indexer.example.test', fakeFetch);
  await node.getTipHeader();
  await indexer.getCells({ code_hash: `0x${'2'.repeat(64)}`, hash_type: 'type', args: '0x' });
  await indexer.getTip();

  assert.deepEqual(calls, [
    { url: 'https://node.example.test', method: 'get_tip_header' },
    { url: 'https://indexer.example.test', method: 'get_cells' },
    { url: 'https://indexer.example.test', method: 'get_indexer_tip' },
  ]);
});
