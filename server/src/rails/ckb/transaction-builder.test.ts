import assert from 'node:assert/strict';
import test from 'node:test';
import type { CkbRailConfig } from './network-config';
import { CkbTransactionBuilder } from './transaction-builder';

const config: CkbRailConfig = {
  enabled: true,
  network: 'testnet',
  nodeUrl: 'https://node.example.test',
  indexerUrl: 'https://indexer.example.test',
  contract: {
    codeHash: `0x${'1'.repeat(64)}`,
    hashType: 'type',
    deploymentTxHash: `0x${'2'.repeat(64)}`,
    outputIndex: 0,
    depType: 'code',
    version: 1,
  },
  confirmations: 4,
  feeRate: 1200n,
};

const clientLock = { codeHash: `0x${'3'.repeat(64)}`, hashType: 'type' as const, args: '0x01' };
const workerLock = { codeHash: `0x${'4'.repeat(64)}`, hashType: 'type' as const, args: '0x02' };

test('CKB builder creates deterministic milestone commitments and exact settlement intent', () => {
  const builder = new CkbTransactionBuilder(config);
  const input = {
    agreementId: 'agreement-1',
    milestoneId: 'milestone-1',
    milestoneIndex: 1,
    amount: '30000000000',
    clientLockScript: clientLock,
    workerLockScript: workerLock,
    refundTimeoutSince: '12345',
  };
  const first = builder.createCommitment(input);
  const second = builder.createCommitment(input);
  assert.deepEqual(first, second);
  assert.equal(first.amount, input.amount);
  assert.equal(first.outputIndex, 0);
  assert.equal(first.lockScript.args.length, 2 + 96 * 2);

  const release = builder.createSettlementIntent({
    operation: 'release',
    lockTxHash: `0x${'5'.repeat(64)}`,
    lockOutputIndex: 0,
    amount: first.amount,
    clientLockScript: clientLock,
    workerLockScript: workerLock,
    refundTimeoutSince: first.refundTimeoutSince,
  });
  const refund = builder.createSettlementIntent({
    operation: 'refund',
    lockTxHash: `0x${'5'.repeat(64)}`,
    lockOutputIndex: 0,
    amount: first.amount,
    clientLockScript: clientLock,
    workerLockScript: workerLock,
    refundTimeoutSince: first.refundTimeoutSince,
  });
  assert.deepEqual(release.destinationLock, workerLock);
  assert.deepEqual(release.authorizerLock, clientLock);
  assert.equal(release.since, 0n);
  assert.deepEqual(refund.destinationLock, clientLock);
  assert.deepEqual(refund.authorizerLock, workerLock);
  assert.equal(refund.since, 12345n);
});

test('CKB builder rejects malformed scripts, since flags, occupied-capacity shortfalls, and u64 overflow', () => {
  const builder = new CkbTransactionBuilder(config);
  const base = {
    agreementId: 'agreement-1',
    milestoneId: 'milestone-1',
    milestoneIndex: 1,
    amount: '30000000000',
    clientLockScript: clientLock,
    workerLockScript: workerLock,
    refundTimeoutSince: '12345',
  };
  assert.throws(() => builder.createCommitment({ ...base, clientLockScript: { args: '0x' } }), /valid CKB lock script/);
  assert.throws(() => builder.createCommitment({ ...base, refundTimeoutSince: (1n << 56n).toString() }), /absolute block-number/);
  assert.throws(() => builder.createCommitment({ ...base, amount: '1' }), /occupied capacity/);
  assert.throws(() => builder.createCommitment({ ...base, amount: (1n << 64n).toString() }), /maximum supported shannon/);
  assert.throws(() => builder.createSettlementIntent({
    operation: 'release',
    lockTxHash: '0x1234',
    lockOutputIndex: 0,
    amount: base.amount,
    clientLockScript: clientLock,
    workerLockScript: workerLock,
    refundTimeoutSince: base.refundTimeoutSince,
  }), /transaction hash is invalid/);
});
