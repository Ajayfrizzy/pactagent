import assert from 'assert/strict';
import test from 'node:test';
import { AppError } from '../errors/app-error';
import {
  assertEscrowAmountWithinScope,
  assertMilestoneAllocationWithinAgreement,
  assertSettlementSplit,
  parseNonNegativeIntegerAmount,
} from './financial-invariants';

test('settlement splits support exact zero/100 and partial allocation', () => {
  assert.doesNotThrow(() => assertSettlementSplit({ workerAmount: '0', clientAmount: '100', settlementAmount: '100' }));
  assert.doesNotThrow(() => assertSettlementSplit({ workerAmount: '40', clientAmount: '60', settlementAmount: '100' }));
  assert.doesNotThrow(() => assertSettlementSplit({ workerAmount: '100', clientAmount: '0', settlementAmount: '100' }));
});

test('settlement splits reject under, over, negative, and malformed amounts', () => {
  for (const split of [
    { workerAmount: '40', clientAmount: '59' },
    { workerAmount: '40', clientAmount: '61' },
    { workerAmount: '-1', clientAmount: '101' },
    { workerAmount: '1.5', clientAmount: '98.5' },
  ]) {
    assert.throws(
      () => assertSettlementSplit({ ...split, settlementAmount: '100' }),
      (error) => error instanceof AppError && ['invalid_settlement_split', 'invalid_amount'].includes(error.code),
    );
  }
  assert.throws(() => parseNonNegativeIntegerAmount('-1', 'amount'));
});

test('milestone and escrow allocations use exact bigint comparisons', () => {
  assert.doesNotThrow(() => assertMilestoneAllocationWithinAgreement({
    existingTotal: BigInt('18446744073709551614'), proposedAmount: '1', agreementAmount: '18446744073709551615',
  }));
  assert.throws(() => assertMilestoneAllocationWithinAgreement({
    existingTotal: BigInt(80), proposedAmount: '21', agreementAmount: '100',
  }));
  assert.throws(() => assertEscrowAmountWithinScope({
    escrowAmount: '101', scopeAmount: '100', scope: 'milestone',
  }));
  assert.throws(() => assertEscrowAmountWithinScope({
    escrowAmount: '99', scopeAmount: '100', scope: 'milestone', exact: true,
  }));
});
