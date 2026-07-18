import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertAgreementTransition,
  canTransitionAgreement,
} from './agreement.state-machine';

test('agreement state machine accepts the required happy path', () => {
  assert.equal(canTransitionAgreement('draft', 'pending_acceptance'), true);
  assert.equal(canTransitionAgreement('pending_acceptance', 'accepted'), true);
  assert.equal(canTransitionAgreement('accepted', 'funding_required'), true);
  assert.equal(canTransitionAgreement('funding_required', 'funded'), true);
  assert.equal(canTransitionAgreement('funded', 'in_progress'), true);
  assert.equal(canTransitionAgreement('in_progress', 'proof_submitted'), true);
  assert.equal(canTransitionAgreement('proof_submitted', 'under_review'), true);
  assert.equal(canTransitionAgreement('under_review', 'approved'), true);
  assert.equal(canTransitionAgreement('approved', 'release_pending'), true);
  assert.equal(canTransitionAgreement('release_pending', 'released'), true);
});

test('agreement state machine rejects forbidden release and refund transitions', () => {
  assert.equal(canTransitionAgreement('released', 'refunded'), false);
  assert.equal(canTransitionAgreement('refunded', 'released'), false);
  assert.equal(canTransitionAgreement('cancelled', 'funded'), false);
  assert.equal(canTransitionAgreement('draft', 'released'), false);
  assert.equal(canTransitionAgreement('funding_required', 'released'), false);
  assert.equal(canTransitionAgreement('in_progress', 'released'), false);

  assert.throws(
    () => assertAgreementTransition('in_progress', 'released'),
    /Agreement cannot transition from in_progress to released/,
  );
});
