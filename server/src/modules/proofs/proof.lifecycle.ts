import { invalidRequest } from '../../common/errors/app-error';
import type { InfrastructureAgreementStatus } from '../agreements/agreement.state-machine';
import type { InfrastructureMilestoneStatus } from '../milestones/milestone.state-machine';

export const PROOF_STATUSES = [
  'submitted',
  'under_review',
  'accepted',
  'rejected',
  'needs_changes',
  'disputed',
] as const;

export type ProofStatus = (typeof PROOF_STATUSES)[number];

export const REVIEW_DECISIONS = ['approved', 'rejected', 'needs_changes'] as const;

export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

const TERMINAL_AGREEMENT_STATUSES = new Set(['released', 'refunded', 'cancelled', 'expired']);
const TERMINAL_MILESTONE_STATUSES = new Set(['released', 'refunded']);

export function isProofStatus(status: string): status is ProofStatus {
  return PROOF_STATUSES.includes(status as ProofStatus);
}

export function assertProofSubmissionAgreementAllowed(status: InfrastructureAgreementStatus) {
  if (TERMINAL_AGREEMENT_STATUSES.has(status)) {
    throw invalidRequest(
      'Proof cannot be submitted for released, refunded, cancelled, or expired agreements.',
      'proof_submission_not_allowed',
    );
  }

  if (!['funded', 'in_progress', 'rejected'].includes(status)) {
    throw invalidRequest(
      'Proof submission requires a funded or in-progress agreement.',
      'proof_submission_requires_active_agreement',
    );
  }
}

export function assertProofSubmissionMilestoneAllowed(status: InfrastructureMilestoneStatus) {
  if (TERMINAL_MILESTONE_STATUSES.has(status)) {
    throw invalidRequest(
      'Proof cannot be submitted for released or refunded milestones.',
      'proof_submission_not_allowed',
    );
  }

  if (!['funded', 'in_progress', 'rejected'].includes(status)) {
    throw invalidRequest(
      'Proof submission requires a funded or in-progress milestone.',
      'proof_submission_requires_active_milestone',
    );
  }
}

export function agreementPathForProofSubmission(
  status: InfrastructureAgreementStatus,
): InfrastructureAgreementStatus[] {
  assertProofSubmissionAgreementAllowed(status);

  if (status === 'funded') {
    return ['in_progress', 'proof_submitted'];
  }

  if (status === 'rejected') {
    return ['in_progress', 'proof_submitted'];
  }

  return ['proof_submitted'];
}

export function milestonePathForProofSubmission(
  status: InfrastructureMilestoneStatus,
): InfrastructureMilestoneStatus[] {
  assertProofSubmissionMilestoneAllowed(status);

  if (status === 'funded') {
    return ['in_progress', 'proof_submitted'];
  }

  if (status === 'rejected') {
    return ['in_progress', 'proof_submitted'];
  }

  return ['proof_submitted'];
}

export function proofStatusForReviewDecision(decision: ReviewDecision): ProofStatus {
  switch (decision) {
    case 'approved':
      return 'accepted';
    case 'rejected':
      return 'rejected';
    case 'needs_changes':
      return 'needs_changes';
  }
}

export function agreementPathForReviewDecision(
  status: InfrastructureAgreementStatus,
  decision: ReviewDecision,
): InfrastructureAgreementStatus[] {
  if (!['proof_submitted', 'under_review'].includes(status)) {
    throw invalidRequest(
      'Proof review requires an agreement awaiting review.',
      'proof_review_invalid_agreement_state',
    );
  }

  const path: InfrastructureAgreementStatus[] = status === 'proof_submitted' ? ['under_review'] : [];

  if (decision === 'approved') {
    path.push('approved');
  } else if (decision === 'rejected') {
    path.push('rejected');
  } else {
    path.push('rejected', 'in_progress');
  }

  return path;
}

export function milestonePathForReviewDecision(
  status: InfrastructureMilestoneStatus,
  decision: ReviewDecision,
): InfrastructureMilestoneStatus[] {
  if (!['proof_submitted', 'under_review'].includes(status)) {
    throw invalidRequest(
      'Proof review requires a milestone awaiting review.',
      'proof_review_invalid_milestone_state',
    );
  }

  const path: InfrastructureMilestoneStatus[] = status === 'proof_submitted' ? ['under_review'] : [];

  if (decision === 'approved') {
    path.push('approved');
  } else if (decision === 'rejected') {
    path.push('rejected');
  } else {
    path.push('rejected', 'in_progress');
  }

  return path;
}
