import { invalidRequest } from '../../common/errors/app-error';

export const ESCROW_STATUSES = [
  'not_created',
  'awaiting_funding',
  'funding_detected',
  'funded',
  'release_pending',
  'released',
  'refund_pending',
  'refunded',
  'reconciliation_required',
  'failed',
] as const;

export type EscrowStatus = (typeof ESCROW_STATUSES)[number];

const VALID_TRANSITIONS: Record<EscrowStatus, EscrowStatus[]> = {
  not_created: ['awaiting_funding', 'reconciliation_required', 'failed'],
  awaiting_funding: ['funding_detected', 'funded', 'reconciliation_required', 'failed'],
  funding_detected: ['funded', 'reconciliation_required', 'failed'],
  funded: ['release_pending', 'refund_pending', 'reconciliation_required'],
  release_pending: ['released', 'reconciliation_required', 'failed'],
  released: ['reconciliation_required'],
  refund_pending: ['refunded', 'reconciliation_required', 'failed'],
  refunded: ['reconciliation_required'],
  reconciliation_required: ['awaiting_funding', 'funding_detected', 'funded', 'release_pending', 'released', 'refund_pending', 'refunded', 'failed'],
  failed: ['funded'],
};

export function isEscrowStatus(status: string): status is EscrowStatus {
  return ESCROW_STATUSES.includes(status as EscrowStatus);
}

export function canTransitionEscrow(from: EscrowStatus, to: EscrowStatus) {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertEscrowTransition(from: EscrowStatus, to: EscrowStatus) {
  if (!canTransitionEscrow(from, to)) {
    throw invalidRequest(
      `Escrow cannot transition from ${from} to ${to}.`,
      'invalid_state_transition',
    );
  }
}
