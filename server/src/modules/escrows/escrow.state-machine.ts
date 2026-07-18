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
  'failed',
] as const;

export type EscrowStatus = (typeof ESCROW_STATUSES)[number];

const VALID_TRANSITIONS: Record<EscrowStatus, EscrowStatus[]> = {
  not_created: ['awaiting_funding'],
  awaiting_funding: ['funding_detected', 'funded'],
  funding_detected: ['funded'],
  funded: ['release_pending', 'refund_pending'],
  release_pending: ['released', 'failed'],
  released: [],
  refund_pending: ['refunded', 'failed'],
  refunded: [],
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
