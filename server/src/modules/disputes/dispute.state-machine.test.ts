import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agreementPathForDisputeOpen,
  agreementPathForDisputeResolution,
  assertDisputeResolvable,
  statusForResolutionType,
} from './dispute.state-machine';

test('opening disputes moves active work into disputed state', () => {
  assert.deepEqual(agreementPathForDisputeOpen('funded'), ['disputed']);
  assert.deepEqual(agreementPathForDisputeOpen('in_progress'), ['disputed']);
  assert.deepEqual(agreementPathForDisputeOpen('proof_submitted'), ['under_review', 'disputed']);
});

test('dispute resolution stores explicit resolution statuses', () => {
  assert.equal(statusForResolutionType('release'), 'resolved_release');
  assert.equal(statusForResolutionType('refund'), 'resolved_refund');
  assert.equal(statusForResolutionType('split'), 'resolved_split');
});

test('release dispute resolution can move disputed agreement to approved', () => {
  assert.deepEqual(agreementPathForDisputeResolution('disputed', 'release'), ['approved']);
  assert.deepEqual(agreementPathForDisputeResolution('disputed', 'refund'), []);
  assert.deepEqual(agreementPathForDisputeResolution('disputed', 'split'), []);
});

test('already resolved disputes cannot be resolved again', () => {
  assert.throws(
    () => assertDisputeResolvable('resolved_release'),
    /Dispute has already been resolved/,
  );
});
