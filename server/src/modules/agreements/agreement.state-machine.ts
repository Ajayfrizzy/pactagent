import { invalidRequest } from '../../common/errors/app-error';

export const AGREEMENT_STATUSES = [
  'draft',
  'pending_acceptance',
  'accepted',
  'funding_required',
  'funded',
  'in_progress',
  'proof_submitted',
  'under_review',
  'approved',
  'release_pending',
  'released',
  'rejected',
  'disputed',
  'cancelled',
  'refunded',
  'expired',
] as const;

export type InfrastructureAgreementStatus = (typeof AGREEMENT_STATUSES)[number];

const VALID_TRANSITIONS: Record<InfrastructureAgreementStatus, InfrastructureAgreementStatus[]> = {
  draft: ['pending_acceptance'],
  pending_acceptance: ['accepted'],
  accepted: ['funding_required'],
  funding_required: ['funded', 'cancelled'],
  funded: ['in_progress', 'refunded', 'disputed'],
  in_progress: ['proof_submitted', 'disputed'],
  proof_submitted: ['under_review'],
  under_review: ['approved', 'rejected', 'disputed'],
  approved: ['release_pending'],
  release_pending: ['released'],
  released: [],
  rejected: ['in_progress'],
  disputed: ['approved', 'refunded', 'released'],
  cancelled: [],
  refunded: [],
  expired: ['cancelled'],
};

export function isAgreementStatus(status: string): status is InfrastructureAgreementStatus {
  return AGREEMENT_STATUSES.includes(status as InfrastructureAgreementStatus);
}

export function canTransitionAgreement(
  from: InfrastructureAgreementStatus,
  to: InfrastructureAgreementStatus,
) {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertAgreementTransition(
  from: InfrastructureAgreementStatus,
  to: InfrastructureAgreementStatus,
) {
  if (!canTransitionAgreement(from, to)) {
    throw invalidRequest(
      `Agreement cannot transition from ${from} to ${to}.`,
      'invalid_state_transition',
    );
  }
}
