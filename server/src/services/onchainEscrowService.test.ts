import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config';
import {
  buildMilestoneEscrowCellData,
  buildOnchainEscrowDescriptor,
  isOnchainEscrowReady,
} from './onchainEscrowService';

const clientAddress =
  'ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq04g0372a9z33k20qx4wwvq85d9fllwuecamflgu';
const workerAddress =
  'ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq04g0372a9z33k20qx4wwvq85d9fllwuecamflgu';
const arbitratorAddress =
  'ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq04g0372a9z33k20qx4wwvq85d9fllwuecamflgu';

test('isOnchainEscrowReady reflects required config presence', () => {
  const originalEnabled = config.onchainEscrowEnabled;
  const originalCodeHash = config.onchainLockCodeHash;
  const originalTxHash = config.onchainLockTxHash;
  const originalIndex = config.onchainLockIndex;

  config.onchainEscrowEnabled = true;
  config.onchainLockCodeHash = '0x' + '11'.repeat(32);
  config.onchainLockTxHash = '0x' + '33'.repeat(32);
  config.onchainLockIndex = '0x0';
  assert.equal(isOnchainEscrowReady(), true);

  config.onchainLockCodeHash = '';
  assert.equal(isOnchainEscrowReady(), false);

  config.onchainEscrowEnabled = originalEnabled;
  config.onchainLockCodeHash = originalCodeHash;
  config.onchainLockTxHash = originalTxHash;
  config.onchainLockIndex = originalIndex;
});

test('buildOnchainEscrowDescriptor derives deterministic lock args and address', async () => {
  const originalEnabled = config.onchainEscrowEnabled;
  const originalCodeHash = config.onchainLockCodeHash;
  const originalHashType = config.onchainLockHashType;

  config.onchainEscrowEnabled = true;
  config.onchainLockCodeHash = '0x' + '22'.repeat(32);
  config.onchainLockHashType = 'type';

  const descriptor = await buildOnchainEscrowDescriptor({
    agreementId: 'agreement-1',
    agreementDigest: '0x' + '33'.repeat(32),
    clientAddress,
    workerAddress,
    arbitratorAddress,
  });

  assert.match(descriptor.escrowAddress, /^ckt1/i);
  assert.match(descriptor.lockArgs, /^0x[a-f0-9]{192}$/);
  assert.equal(descriptor.lockCodeHash, config.onchainLockCodeHash);
  assert.equal(descriptor.lockHashType, 'type');

  config.onchainEscrowEnabled = originalEnabled;
  config.onchainLockCodeHash = originalCodeHash;
  config.onchainLockHashType = originalHashType;
});

test('buildMilestoneEscrowCellData emits the expected fixed-length data payload', () => {
  const encoded = buildMilestoneEscrowCellData({
    agreementDigest: '0x' + '11'.repeat(32),
    milestoneDigest: '0x' + '22'.repeat(32),
    milestoneIndex: 3,
    refundTimeoutBlock: 99,
  });

  assert.match(encoded, /^0x[a-f0-9]+$/);
  assert.equal(encoded.length, 2 + (88 * 2));
});
