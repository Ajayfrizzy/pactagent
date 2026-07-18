export const PROOF_EVENTS = {
  submitted: 'proof.submitted',
  underReview: 'proof.under_review',
  approved: 'proof.approved',
  rejected: 'proof.rejected',
  needsChanges: 'proof.needs_changes',
} as const;

export function eventTypeForReviewDecision(decision: string) {
  switch (decision) {
    case 'approved':
      return PROOF_EVENTS.approved;
    case 'rejected':
      return PROOF_EVENTS.rejected;
    case 'needs_changes':
      return PROOF_EVENTS.needsChanges;
    default:
      return null;
  }
}
