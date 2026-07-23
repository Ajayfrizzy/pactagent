export const MANUAL_REVIEW_TIMEOUT_MS = 5 * 24 * 60 * 60 * 1000;

export function getManualReviewDeadline(reviewStartedAt: Date) {
  return new Date(reviewStartedAt.getTime() + MANUAL_REVIEW_TIMEOUT_MS);
}

export function shouldAutoApproveManualReview(input: {
  now: Date;
  reviewDeadlineAt: Date;
  hasOpenDispute: boolean;
  hasClientMessage: boolean;
  hasClientInfoRequest: boolean;
}) {
  return input.now >= input.reviewDeadlineAt &&
    !input.hasOpenDispute &&
    !input.hasClientMessage &&
    !input.hasClientInfoRequest;
}
