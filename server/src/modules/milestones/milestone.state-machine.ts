import { invalidRequest } from '../../common/errors/app-error';

export const MILESTONE_STATUSES = [
  'pending',
  'funding_required',
  'funded',
  'in_progress',
  'proof_submitted',
  'under_review',
  'approved',
  'released',
  'rejected',
  'disputed',
  'refunded',
  'cancelled',
  'expired',
] as const;

export type InfrastructureMilestoneStatus = (typeof MILESTONE_STATUSES)[number];

const VALID_TRANSITIONS: Record<InfrastructureMilestoneStatus, InfrastructureMilestoneStatus[]> = {
  pending: ['funding_required', 'funded', 'in_progress'],
  funding_required: ['funded', 'refunded'],
  funded: ['in_progress', 'disputed', 'refunded'],
  in_progress: ['proof_submitted', 'disputed'],
  proof_submitted: ['under_review'],
  under_review: ['approved', 'rejected', 'disputed'],
  approved: ['released'],
  released: [],
  rejected: ['in_progress'],
  disputed: ['approved', 'released', 'refunded'],
  refunded: [],
  cancelled: [],
  expired: [],
};

export function isMilestoneStatus(status: string): status is InfrastructureMilestoneStatus {
  return MILESTONE_STATUSES.includes(status as InfrastructureMilestoneStatus);
}

export function canTransitionMilestone(
  from: InfrastructureMilestoneStatus,
  to: InfrastructureMilestoneStatus,
) {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertMilestoneTransition(
  from: InfrastructureMilestoneStatus,
  to: InfrastructureMilestoneStatus,
) {
  if (!canTransitionMilestone(from, to)) {
    throw invalidRequest(
      `Milestone cannot transition from ${from} to ${to}.`,
      'invalid_state_transition',
    );
  }
}
