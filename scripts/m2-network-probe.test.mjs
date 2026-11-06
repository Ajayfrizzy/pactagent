import test from 'node:test';
import assert from 'node:assert/strict';
import { collectEvidence, rpcTransport, TOKEN, RPC } from './m2-network-probe.mjs';

const finalized = { number: '0x123', hash: `0x${'ab'.repeat(32)}` };
const defaults = ['0x14a34', finalized, '0x60016000', `0x${'0'.repeat(63)}6`, finalized, '0x14a34'];
function fixture(values = defaults) {
  const calls = [];
  return { calls, call: async (method, params) => {
    calls.push({ method, params });
    const value = values[calls.length - 1];
    if (value instanceof Error) throw value;
    return value;
  } };
}
test('pins state reads to finalized hash; successful observation never grants capability', async () => {
  const { call, calls } = fixture();
  const result = await collectEvidence(call);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.activationAuthorized, false);
  assert.equal(result.observation.decimals, 6);
  assert.equal(result.observation.tokenCodeKeccak256, null);
  assert.deepEqual(calls[1].params, ['finalized', false]);
  assert.deepEqual(calls[2].params, [TOKEN, { blockHash: finalized.hash, requireCanonical: true }]);
  assert.deepEqual(calls[3].params[1], calls[2].params[1]);
});
for (const [name, index, value] of [
  ['mainnet', 0, '0x2105'], ['numeric chain id', 0, 84532],
  ['unsupported finalized', 1, new Error('secret provider URL')], ['absent finalized', 1, null],
  ['malformed hash', 1, { number: '0x123', hash: '0x123' }],
  ['empty code', 2, '0x'], ['zero code', 2, '0x00'], ['odd hex', 2, '0x123'],
  ['wrong decimals', 3, `0x${'0'.repeat(62)}12`], ['short decimals', 3, '0x6'],
  ['reorg', 4, { ...finalized, hash: `0x${'cd'.repeat(32)}` }],
  ['wrong returned height', 4, { ...finalized, number: '0x124' }], ['chain switch', 5, '0x2105'],
]) {
  test(`fails closed: ${name}`, async () => {
    const values = [...defaults]; values[index] = value;
    const result = await collectEvidence(fixture(values).call);
    assert.equal(result.observation, null);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.activationAuthorized, false);
    assert.doesNotMatch(JSON.stringify(result), /secret provider URL/);
  });
}
test('transport permits only reads at fixed official endpoint and rejects mismatched RPC response', async () => {
  let count = 0;
  const call = rpcTransport(async (url, options) => {
    count++;
    assert.equal(url, RPC); assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 999, result: '0x14a34' }) };
  });
  await assert.rejects(call('eth_sendRawTransaction', ['0x00']), /read_only_transport/);
  assert.equal(count, 0);
  await assert.rejects(call('eth_chainId', []), /rpc_invalid_envelope/);
});
test('HTTP errors and JSON-RPC error envelopes do not produce evidence', async () => {
  for (const response of [{ ok: false }, { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32601 } }) }]) {
    assert.equal((await collectEvidence(rpcTransport(async () => response))).observation, null);
  }
});
