import assert from 'node:assert/strict';
import test from 'node:test';
import { CKB_TESTNET, SANDBOX, addAmounts, assertAssetIdentity, baseUnits, legacyAsset, resolveAsset } from '../assets/asset-registry';
import { allocate, canonicalJson, commitment, freezeTerms, mutualIntent } from './funding-terms';
import { ckbV1Semantics, describeRail, requireCapability } from './adapters/rail-capabilities';
import { beginBroadcast, broadcastTimeout, observeOperation, satisfiesFinality, type Observation, type Operation } from './operation-lifecycle';
import { sampleTerms } from './foundation.test-fixture';

test('registry rejects ticker spoofing, wrong network/token/precision and mainnet; legacy stays explicit', () => {
  for (const id of ['USDC', 'CKB', 'asset:v1:eip155:8453/erc20:0x123', 'asset:v1:eip155:84532/erc20:0x123']) assert.throws(() => resolveAsset(id));
  for (const changes of [{ network: 'mainnet' }, { token: 'USDC' }, { decimals: 6 }, { deployment: 'guessed' }]) assert.throws(() => assertAssetIdentity({ ...CKB_TESTNET, ...changes }));
  assert.equal(legacyAsset({ rail: 'ckb', network: 'testnet', currency: 'CKB' }).status, 'legacy_translation');
  for (const rail of ['mock', 'manual']) assert.equal(legacyAsset({ rail, network: 'sandbox', currency: 'CKB' }).asset, null);
  assert.equal(legacyAsset({ rail: 'ckb', network: 'mainnet', currency: 'CKB' }).asset, null);
  assert.throws(() => addAmounts({ assetId: CKB_TESTNET.id, value: '1' }, { assetId: SANDBOX.id, value: '1' }));
});
test('canonical amounts and asset-specific bounds reject malformed, imprecise and overflow values', () => {
  for (const amount of ['01', '-1', '1.0', '1e3', '+1', ' 1', '', '9'.repeat(1000)]) assert.throws(() => baseUnits(CKB_TESTNET.id, amount));
  assert.equal(baseUnits(SANDBOX.id, (1n << 128n).toString()), 1n << 128n);
  assert.throws(() => baseUnits(CKB_TESTNET.id, (1n << 64n).toString()));
  assert.throws(() => baseUnits(SANDBOX.id, (1n << 256n).toString()));
  assert.throws(() => baseUnits(CKB_TESTNET.id, '0', true));
});
test('fee conservation across all four modes, every small split, dust and wide integer boundaries', () => {
  for (let p = 1; p <= 101; p++) for (let w = 0; w <= p; w++) {
    for (const [bc, bw] of [[0, 0], [200, 0], [0, 300], [200, 300], [1000, 1000]]) {
      const a = allocate(SANDBOX.id, String(p), String(w), bc, bw);
      assert.equal(BigInt(a.workerNet) + BigInt(a.clientNet) + BigInt(a.treasuryNet), BigInt(a.fundingRequired));
      assert.equal(BigInt(a.principalWorker) + BigInt(a.principalClient), BigInt(p));
      assert.equal(BigInt(a.clientFeeEarned) + BigInt(a.clientFeeReturned), BigInt(a.clientFeeDeposit));
      if (w === 0) assert.equal(a.treasuryNet, '0');
    }
  }
  assert.equal(allocate(SANDBOX.id, '101', '37', 200, 300).workerNet, '36');
  assert.equal(allocate(SANDBOX.id, (1n << 200n).toString(), '0', 1000, 1000).treasuryNet, '0');
  assert.throws(() => allocate(CKB_TESTNET.id, CKB_TESTNET.maxBaseUnits, '0', 1, 0));
  assert.throws(() => allocate(SANDBOX.id, '1', '2', 0, 0));
  for (const bps of [-1, 1001, 0.5, NaN]) assert.throws(() => allocate(SANDBOX.id, '100', '50', bps, 0));
});
test('application commitments bind all terms, scope, arbitrary allocation and canonical key order', () => {
  const original = freezeTerms(sampleTerms());
  const reversed = Object.fromEntries(Object.entries(sampleTerms()).reverse());
  assert.equal(freezeTerms(reversed).termsHash, original.termsHash);
  assert.equal(canonicalJson({ z: '1', a: 2 }), '{"a":2,"z":"1"}');
  assert.equal(commitment('terms', { a: '1' }), '148d40afca36430a335452526b97d56c0c41ec84cd79f3633f6df5c9db5e8387');
  for (const change of [{ appId: 'other' }, { deploymentId: 'other' }, { escrowId: 'other' },
    { treasury: { recipient: 'other', version: '2' } }, { worker: { recipient: 'other', signingIdentity: 'other', bindingVersion: '2' } }]) {
    assert.notEqual(freezeTerms(sampleTerms(change)).termsHash, original.termsHash);
  }
  assert.throws(() => freezeTerms(sampleTerms({ network: 'mainnet' })));
  assert.throws(() => freezeTerms(sampleTerms({ clientFeeDeposit: '21' })));
  assert.throws(() => freezeTerms({ ...sampleTerms(), unknown: true }));
  assert.throws(() => { original.terms.client.recipient = 'tampered'; });
  assert.throws(() => freezeTerms(sampleTerms({ assetId: CKB_TESTNET.id, network: CKB_TESTNET.network })));
  for (const w of ['0', '1', '370', '1000']) assert.equal(mutualIntent(sampleTerms(), w, String(1000 - Number(w)), '0').intent.authorization, 'unauthorized');
  assert.throws(() => mutualIntent(sampleTerms(), '370', '631', '0'));
});
test('capabilities fail closed for unknown deployment, Base and CKB upper-cutoff claims', () => {
  const binding = { rail: 'ckb', network: 'testnet', contractVersion: 1, lockScriptJson: '{}', deploymentId: null };
  assert.equal(describeRail(binding).kind, 'ckb-v1-unverified');
  assert.equal(describeRail({ ...binding, rail: 'mock', network: 'sandbox' }, 'ckb').kind, 'unavailable');
  assert.throws(() => requireCapability(describeRail(binding), 'split'));
  assert.throws(() => requireCapability(describeRail({ ...binding, rail: 'base' }), 'fund'));
  assert.equal(ckbV1Semantics.expiration, 'no-upper-bound');
  assert.equal(ckbV1Semantics.exclusiveCutoff, 'unsupported');
  const synthetic = describeRail({ ...binding, rail: 'mock', network: 'sandbox' });
  assert.equal(synthetic.kind, 'synthetic');
  requireCapability(synthetic, 'refund');
  assert.throws(() => requireCapability(synthetic, 'arbitrate'));
});
const operation: Operation = { id: 'op', state: 'authorized', deploymentId: 'dep', network: 'ckb:aggron4',
  transactionId: '0x' + 'a'.repeat(64), artifactHash: 'a'.repeat(64), artifactReference: 'test:artifact', authorizationProofHash: 'b'.repeat(64),
  policy: { kind: 'ckb-depth-canonical', version: 'test-only', minimumDepth: 3 }, lastBlockHash: null };
const observation: Observation = { version: 1, operationId: 'op', deploymentId: 'dep', network: 'ckb:aggron4', transactionId: '0x' + 'a'.repeat(64),
  logIndex: null, blockHash: '0x' + 'b'.repeat(64), blockNumber: '10', headHash: '0x' + 'c'.repeat(64), headNumber: '12', policyVersion: 'test-only',
  canonical: 'verified', allocation: 'verified', confirmations: 3, finalizedBlockHash: null, finalizedBlockNumber: null,
  providerEvidenceHash: 'c'.repeat(64), correctionOf: null };
test('unknown broadcast reserves identity, cannot rebroadcast or settle without canonical evidence', () => {
  assert.throws(() => beginBroadcast({ ...operation, artifactReference: null }));
  assert.throws(() => beginBroadcast({ ...operation, state: 'unauthorized' }));
  const broadcast = beginBroadcast(operation), unknown = broadcastTimeout(broadcast);
  assert.equal(unknown.transactionId, broadcast.transactionId);
  assert.throws(() => beginBroadcast(unknown));
  assert.throws(() => observeOperation(operation, observation));
  assert.equal(observeOperation(unknown, { ...observation, canonical: 'unknown' }).state, 'reconciliation_required');
  assert.equal(observeOperation(unknown, observation).state, 'observed');
  for (const change of [{ policyVersion: 'weaker' }, { canonical: 'disagreeing' as const }, { blockHash: null }, { headNumber: '9' }, { allocation: 'unknown' as const }]) {
    assert.notEqual(observeOperation(unknown, { ...observation, ...change }).state, 'settled');
  }
  assert.throws(() => observeOperation(unknown, { ...observation, transactionId: 'other' }));
  const settled = observeOperation(observeOperation(unknown, observation), observation);
  assert.equal(settled.state, 'settled');
  assert.equal(observeOperation(settled, { ...observation, blockHash: 'new-block' }).state, 'reconciliation_required');
  assert.equal(observeOperation(settled, { ...observation, confirmations: 1 }).state, 'reconciliation_required');
  assert.equal(satisfiesFinality({ kind: 'unavailable', version: 'test-only' }, observation), false);
  assert.equal(satisfiesFinality({ kind: 'base-finalized', version: 'test-only' }, observation), false);
});
