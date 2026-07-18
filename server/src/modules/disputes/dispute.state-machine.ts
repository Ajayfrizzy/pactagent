import { invalidRequest } from '../../common/errors/app-error';
import type { InfrastructureAgreementStatus } from '../agreements/agreement.state-machine';
import type { InfrastructureMilestoneStatus } from '../milestones/milestone.state-machine';

export const DISPUTE_STATUSES = [
  'open',
  'awaiting_response',
  'under_review',
  'resolved_release',
  'resolved_refund',
  'resolved_split',
  'cancelled',
] as const;

export const DISPUTE_RESOLUTION_TYPES = ['release', 'refund', 'split'] as const;

export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];
export type DisputeResolutionType = (typeof DISPUTE_RESOLUTION_TYPES)[number];

export function isDisputeStatus(status: string): status is DisputeStatus {
  return DISPUTE_STATUSES.includes(status as DisputeStatus);
}

export function statusForResolutionType(resolutionType: DisputeResolutionType): DisputeStatus {
  switch (resolutionType) {
    case 'release':
      return 'resolved_release';
    case 'refund':
      return 'resolved_refund';
    case 'split':
      return 'resolved_split';
  }
}

export function assertDisputeResolvable(status: string) {
  if (status.startsWith('resolved_') || status === 'cancelled') {
    throw invalidRequest('Dispute has already been resolved.', 'dispute_already_resolved');
  }

  if (!isDisputeStatus(status)) {
    throw invalidRequest(`Unknown dispute status: ${status}.`, 'invalid_dispute_status');
  }
}

export function agreementPathForDisputeOpen(
  status: InfrastructureAgreementStatus,
): InfrastructureAgreementStatus[] {
  if (status === 'funded' || status === 'in_progress' || status === 'under_review') {
    return ['disputed'];
  }

  if (status === 'proof_submitted') {
    return ['under_review', 'disputed'];
  }

  throw invalidRequest('Agreement cannot be disputed from its current state.', 'invalid_state_transition');
}

export function milestonePathForDisputeOpen(
  status: InfrastructureMilestoneStatus,
): InfrastructureMilestoneStatus[] {
  if (status === 'funded' || status === 'in_progress' || status === 'under_review') {
    return ['disputed'];
  }

  if (status === 'proof_submitted') {
    return ['under_review', 'disputed'];
  }

  throw invalidRequest('Milestone cannot be disputed from its current state.', 'invalid_state_transition');
}

export function agreementPathForDisputeResolution(
  status: InfrastructureAgreementStatus,
  resolutionType: DisputeResolutionType,
): InfrastructureAgreementStatus[] {
  if (status !== 'disputed') {
    throw invalidRequest('Dispute resolution requires a disputed agreement.', 'invalid_state_transition');
  }

  if (resolutionType === 'release') {
    return ['approved'];
  }

  return [];
}

export function milestonePathForDisputeResolution(
  status: InfrastructureMilestoneStatus,
  resolutionType: DisputeResolutionType,
): InfrastructureMilestoneStatus[] {
  if (status !== 'disputed') {
    throw invalidRequest('Dispute resolution requires a disputed milestone.', 'invalid_state_transition');
  }

  if (resolutionType === 'release') {
    return ['approved'];
  }

  return [];
}
