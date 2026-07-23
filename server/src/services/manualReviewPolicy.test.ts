import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getManualReviewDeadline,
  shouldAutoApproveManualReview,
} from './manualReviewPolicy';

test('manual review deadline is five 24-hour calendar days after review starts', () => {
  const startedAt = new Date('2026-07-22T10:00:00.000Z');
  assert.equal(getManualReviewDeadline(startedAt).toISOString(), '2026-07-27T10:00:00.000Z');
});

test('manual review auto-approves at the deadline when the client is inactive', () => {
  assert.equal(shouldAutoApproveManualReview({
    now: new Date('2026-07-27T10:00:00.000Z'),
    reviewDeadlineAt: new Date('2026-07-27T10:00:00.000Z'),
    hasOpenDispute: false,
    hasClientMessage: false,
    hasClientInfoRequest: false,
  }), true);
});

test('manual review does not auto-approve before the deadline or after client activity', () => {
  const reviewDeadlineAt = new Date('2026-07-27T10:00:00.000Z');
  const base = {
    now: reviewDeadlineAt,
    reviewDeadlineAt,
    hasOpenDispute: false,
    hasClientMessage: false,
    hasClientInfoRequest: false,
  };

  assert.equal(shouldAutoApproveManualReview({
    ...base,
    now: new Date('2026-07-27T09:59:59.999Z'),
  }), false);
  assert.equal(shouldAutoApproveManualReview({ ...base, hasOpenDispute: true }), false);
  assert.equal(shouldAutoApproveManualReview({ ...base, hasClientMessage: true }), false);
  assert.equal(shouldAutoApproveManualReview({ ...base, hasClientInfoRequest: true }), false);
});
