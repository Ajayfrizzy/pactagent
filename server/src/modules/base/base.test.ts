import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { authorizationDigest, termsHash, type Action, hash } from './codec';
import { localTerms, wordId } from './fixtures';
import { sealArtifact, openArtifact } from './artifacts';
import { observeLocalSettlement, type LocalBinding, type Rpc } from './observer';

test('M2 domain/action/terms binding and canonical uint validation', () => {
  const t = localTerms(), base = { terms: t, chainId: '31337', instance: '0x0000000000000000000000000000000000000999', validUntil: '150' };
  const digest = (action: Action) => authorizationDigest({ ...base, action, ...(['mutual', 'arbitration'].includes(action) ? { workerAmount: '370001' } : {}) });
  assert.equal(new Set((['funding','mutual','dispute','arbitration'] as Action[]).map(digest)).size, 4);
  for (const change of [{ chainId: '84532' }, { instance: t.client }, { validUntil: '151' }, { terms: { ...t, clientBps: '999' } }]) {
    assert.notEqual(authorizationDigest({ ...base, ...change, action: 'funding' }), digest('funding'));
  }
  for (const bad of ['01','-1','1.0','1e6',(1n << 256n).toString()]) assert.throws(() => termsHash({ ...t, principal: bad }));
  assert.throws(() => termsHash({ ...t, arbiters: [...t.arbiters].reverse() }));
  assert.throws(() => termsHash({ ...t, threshold: '0' }));
  assert.throws(() => termsHash({ ...t, treasury: t.worker }));
});
test('M2 encrypted artifacts bind tenant, operation, terms and key version; recover after restart', () => {
  const key = { version: 'fixture-v1', bytes: randomBytes(32) };
  const sealed = sealArtifact('synthetic-signed-artifact', key, 'app:operation:terms');
  assert.equal(openArtifact(sealed, { ...key, bytes: Buffer.from(key.bytes) }, 'app:operation:terms'), 'synthetic-signed-artifact');
  for (const scope of ['other:operation:terms','app:other:terms','app:operation:other']) assert.throws(() => openArtifact(sealed, key, scope));
  assert.throws(() => openArtifact(sealed, { ...key, version: 'v2' }, 'app:operation:terms'));
  const tampered = Buffer.from(sealed, 'base64');tampered[28] ^= 1;
  assert.throws(() => openArtifact(tampered.toString('base64'), key, 'app:operation:terms'));
});
const w = (s: string) => BigInt(s).toString(16).padStart(64, '0');
const binding: LocalBinding = { chainId: '31337', instance: '0x0000000000000000000000000000000000000999', token: localTerms().token,
  codeHash: hash(Buffer.from('60016000', 'hex')), termsHash: termsHash(localTerms()), escrowId: wordId(4), transactionId: wordId(8),
  policyVersion: 'local-two-provider-v1', workerPrincipal: '370001', clientPrincipal: '630000', workerNet: '357680', clientNet: '693000', treasuryNet: '49321', path: 0 };
const bh = wordId(9), fh = wordId(10);
function rpcFixture(mode = 'valid'): Rpc {
  return async (method, params) => {
    if (method === 'eth_chainId') return mode === 'wrong-chain' ? '0x14a34' : '0x7a69';
    if (method === 'eth_getCode') return mode === 'wrong-code' ? '0x00' : '0x60016000';
    if (method === 'eth_getBlockByNumber') {
      if (params[0] === 'finalized' && mode === 'no-finalized') throw new Error('unsupported');
      if (params[0] === 'finalized' || params[0] === '0x20') return { number: '0x20', hash: fh };
      return { number: '0x10', hash: mode === 'reorg' ? wordId(11) : bh };
    }
    if (method === 'eth_call') {
      const data = (params[0] as { data: string }).data;
      if (data === hash(Buffer.from('termsHash()')).slice(0,10)) return binding.termsHash;
      if (data === hash(Buffer.from('state()')).slice(0,10)) return `0x${w(mode === 'wrong-state' ? '1' : '3')}`;
      return `0x${'0'.repeat(5*64)}${w(binding.token)}${'0'.repeat(11*64)}`;
    }
    if (method === 'eth_getTransactionReceipt') {
      if (mode === 'missing') return null;
      const log = { address: binding.instance, removed: false, blockHash: bh, transactionHash: binding.transactionId, logIndex: '0x0',
        topics: [hash(Buffer.from('Settled(bytes32,bytes32,uint8,uint256,uint256,uint256,uint256,uint256)')), binding.escrowId, binding.termsHash, wordId(0)],
        data: `0x${[binding.workerPrincipal,binding.clientPrincipal,binding.workerNet,binding.clientNet, mode === 'wrong-amount' ? '0' : binding.treasuryNet].map(w).join('')}` };
      return { status: mode === 'failed' ? '0x0' : '0x1', transactionHash: binding.transactionId, to: binding.instance, blockNumber: '0x10', blockHash: bh, logs: mode === 'duplicate-log' ? [log,log] : [log] };
    }
    throw new Error('unexpected_method');
  };
}
const providers = (mode = 'valid') => [{ operator: 'local-a', rpc: rpcFixture() }, { operator: 'local-b', rpc: rpcFixture(mode) }];
test('M2 local receipt verifier checks both providers and reconciles previously finalized disappearance', async () => {
  const result = await observeLocalSettlement(binding, providers());assert.equal(result.state, 'finalized');
  const lost = await observeLocalSettlement(binding, providers('missing'), result);assert.equal(lost.state, 'reconciliation_required');
  assert.equal((await observeLocalSettlement(binding, providers(), lost)).state, 'reconciliation_required');
  assert.equal((await observeLocalSettlement(binding, [{ operator: 'same', rpc: rpcFixture() }, { operator: 'same', rpc: rpcFixture() }])).state, 'unknown');
});
for (const mode of ['wrong-chain','wrong-code','no-finalized','reorg','wrong-state','missing','wrong-amount','failed','duplicate-log']) {
  test(`M2 observer fails closed: ${mode}`, async () => assert.equal((await observeLocalSettlement(binding, providers(mode))).state, 'unknown'));
}
