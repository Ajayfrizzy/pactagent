import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateOccupiedCapacity } from './capacity';
import { encodeEscrowCellData, encodeEscrowLockArgs } from './escrow-codec';

test('occupied capacity is calculated deterministically from injected scripts and data', () => {
  const lockArgs = encodeEscrowLockArgs({
    clientLockHash: `0x${'11'.repeat(32)}`,
    workerLockHash: `0x${'22'.repeat(32)}`,
    agreementSalt: `0x${'33'.repeat(32)}`,
  });
  const cellData = encodeEscrowCellData({
    milestoneIndex: 3,
    refundTimeoutSince: 99n,
    agreementDigest: `0x${'44'.repeat(32)}`,
    milestoneDigest: `0x${'55'.repeat(32)}`,
  });

  const capacity = calculateOccupiedCapacity({
    lock: {
      codeHash: `0x${'aa'.repeat(32)}`,
      hashType: 'type',
      args: lockArgs,
    },
  }, cellData);

  assert.equal(capacity, 22500000000n);
});
