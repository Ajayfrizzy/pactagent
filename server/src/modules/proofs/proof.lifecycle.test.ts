import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agreementPathForProofSubmission,
  agreementPathForReviewDecision,
  milestonePathForProofSubmission,
  proofStatusForReviewDecision,
} from './proof.lifecycle';

test('proof submission advances funded work through in progress to submitted', () => {
  assert.deepEqual(agreementPathForProofSubmission('funded'), ['in_progress', 'proof_submitted']);
  assert.deepEqual(milestonePathForProofSubmission('funded'), ['in_progress', 'proof_submitted']);
});

test('proof submission rejects terminal agreement states', () => {
  assert.throws(
    () => agreementPathForProofSubmission('released'),
    /Proof cannot be submitted for released, refunded, cancelled, or expired agreements/,
  );
  assert.throws(
    () => agreementPathForProofSubmission('refunded'),
    /Proof cannot be submitted for released, refunded, cancelled, or expired agreements/,
  );
});

test('review decisions map proof and agreement status paths', () => {
  assert.equal(proofStatusForReviewDecision('approved'), 'accepted');
  assert.equal(proofStatusForReviewDecision('rejected'), 'rejected');
  assert.equal(proofStatusForReviewDecision('needs_changes'), 'needs_changes');

  assert.deepEqual(agreementPathForReviewDecision('proof_submitted', 'approved'), ['under_review', 'approved']);
  assert.deepEqual(agreementPathForReviewDecision('proof_submitted', 'rejected'), ['under_review', 'rejected']);
  assert.deepEqual(agreementPathForReviewDecision('proof_submitted', 'needs_changes'), [
    'under_review',
    'rejected',
    'in_progress',
  ]);
});

test('proof review requires a reviewable agreement state', () => {
  assert.throws(
    () => agreementPathForReviewDecision('released', 'approved'),
    /Proof review requires an agreement awaiting review/,
  );
});
