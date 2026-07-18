export type ReviewRecord = {
  id: string;
  appId: string;
  agreementId: string;
  milestoneId: string | null;
  proofSubmissionId: string;
  reviewerExternalId: string;
  decision: string;
  note: string | null;
  createdAt: Date;
};

export function serializeReview(review: ReviewRecord) {
  return {
    id: review.id,
    appId: review.appId,
    agreementId: review.agreementId,
    milestoneId: review.milestoneId,
    proofSubmissionId: review.proofSubmissionId,
    reviewerExternalId: review.reviewerExternalId,
    decision: review.decision,
    note: review.note,
    createdAt: review.createdAt.toISOString(),
  };
}
