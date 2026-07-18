import test from 'node:test';
import assert from 'node:assert/strict';
import { MockEscrowAdapter } from './mock-escrow.adapter';

test('mock escrow adapter creates deterministic lock and operation tx hashes', async () => {
  const adapter = new MockEscrowAdapter();
  const lock = await adapter.createEscrowLock({
    escrowId: 'escrow_1',
    appId: 'app_1',
    agreementId: 'agreement_1',
    amount: '100',
    currency: 'CKB',
    rail: 'mock',
    network: 'sandbox',
  });
  const release = await adapter.release({
    escrowId: 'escrow_1',
    amount: '100',
    currency: 'CKB',
  });
  const refund = await adapter.refund({
    escrowId: 'escrow_1',
    amount: '100',
    currency: 'CKB',
  });

  assert.equal(lock.status, 'awaiting_funding');
  assert.equal(lock.lockAddress, 'mock_escrow_escrow_1');
  assert.match(lock.txHash ?? '', /^mock_[a-f0-9]{32}$/);
  assert.match(release.txHash ?? '', /^mock_[a-f0-9]{32}$/);
  assert.match(refund.txHash ?? '', /^mock_[a-f0-9]{32}$/);
  assert.notEqual(release.txHash, refund.txHash);
});
