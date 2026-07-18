import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertMilestoneTransition,
  canTransitionMilestone,
} from './milestone.state-machine';

test('milestone state machine accepts review and release path', () => {
  assert.equal(canTransitionMilestone('pending', 'funding_required'), true);
  assert.equal(canTransitionMilestone('funding_required', 'funded'), true);
  assert.equal(canTransitionMilestone('funded', 'in_progress'), true);
  assert.equal(canTransitionMilestone('in_progress', 'proof_submitted'), true);
  assert.equal(canTransitionMilestone('proof_submitted', 'under_review'), true);
  assert.equal(canTransitionMilestone('under_review', 'approved'), true);
  assert.equal(canTransitionMilestone('approved', 'released'), true);
});

test('milestone state machine rejects released/refunded reversals', () => {
  assert.equal(canTransitionMilestone('released', 'refunded'), false);
  assert.equal(canTransitionMilestone('refunded', 'released'), false);

  assert.throws(
    () => assertMilestoneTransition('refunded', 'released'),
    /Milestone cannot transition from refunded to released/,
  );
});
