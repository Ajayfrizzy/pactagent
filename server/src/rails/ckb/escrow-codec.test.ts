import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeEscrowCellData,
  decodeEscrowLockArgs,
  encodeEscrowCellData,
  encodeEscrowLockArgs,
  ESCROW_CELL_DATA_BYTES,
  ESCROW_LOCK_ARGS_BYTES,
} from './escrow-codec';

test('escrow lock args use the contract client/worker/salt byte order', () => {
  const args = {
    clientLockHash: `0x${'11'.repeat(32)}`,
    workerLockHash: `0x${'22'.repeat(32)}`,
    agreementSalt: `0x${'33'.repeat(32)}`,
  };
  const encoded = encodeEscrowLockArgs(args);

  assert.equal(encoded, `0x${'11'.repeat(32)}${'22'.repeat(32)}${'33'.repeat(32)}`);
  assert.equal(encoded.length, 2 + ESCROW_LOCK_ARGS_BYTES * 2);
  assert.deepEqual(decodeEscrowLockArgs(encoded), args);
});

test('escrow cell data matches the retained contract layout and round trips', () => {
  const data = {
    milestoneIndex: 0x01020304,
    refundTimeoutSince: 0x0102030405060708n,
    agreementDigest: `0x${'44'.repeat(32)}`,
    milestoneDigest: `0x${'55'.repeat(32)}`,
  };
  const encoded = encodeEscrowCellData(data);

  assert.equal(encoded.length, 2 + ESCROW_CELL_DATA_BYTES * 2);
  assert.equal(encoded.slice(2, 18), Buffer.from('PACTESC1', 'ascii').toString('hex'));
  assert.equal(encoded.slice(18, 26), '01000000');
  assert.equal(encoded.slice(26, 34), '04030201');
  assert.equal(encoded.slice(34, 50), '0807060504030201');
  assert.deepEqual(decodeEscrowCellData(encoded), data);
});

test('escrow codecs reject malformed widths and unsigned integer overflow', () => {
  assert.throws(() => encodeEscrowLockArgs({
    clientLockHash: '0x11',
    workerLockHash: `0x${'22'.repeat(32)}`,
    agreementSalt: `0x${'33'.repeat(32)}`,
  }), /clientLockHash must be a 32-byte/);
  assert.throws(() => encodeEscrowCellData({
    milestoneIndex: 0x1_0000_0000,
    refundTimeoutSince: 1n,
    agreementDigest: `0x${'44'.repeat(32)}`,
    milestoneDigest: `0x${'55'.repeat(32)}`,
  }), /milestoneIndex is outside/);
});
