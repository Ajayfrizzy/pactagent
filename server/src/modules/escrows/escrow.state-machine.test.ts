import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertEscrowTransition,
  canTransitionEscrow,
} from './escrow.state-machine';

test('escrow state machine accepts funding and release path', () => {
  assert.equal(canTransitionEscrow('not_created', 'awaiting_funding'), true);
  assert.equal(canTransitionEscrow('awaiting_funding', 'funding_detected'), true);
  assert.equal(canTransitionEscrow('funding_detected', 'funded'), true);
  assert.equal(canTransitionEscrow('funded', 'release_pending'), true);
  assert.equal(canTransitionEscrow('release_pending', 'released'), true);
});

test('escrow state machine rejects release/refund reversals', () => {
  assert.equal(canTransitionEscrow('released', 'refunded'), false);
  assert.equal(canTransitionEscrow('refunded', 'released'), false);
  assert.equal(canTransitionEscrow('not_created', 'released'), false);

  assert.throws(
    () => assertEscrowTransition('refunded', 'released'),
    /Escrow cannot transition from refunded to released/,
  );
});

test('failed remains unresolved and can recover only through verified funding', () => {
  assert.equal(canTransitionEscrow('failed', 'funded'), true);
  assert.equal(canTransitionEscrow('failed', 'awaiting_funding'), false);
  assert.equal(canTransitionEscrow('failed', 'released'), false);
});
