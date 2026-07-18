export const WEBHOOK_EVENTS = {
  deliveryFailed: 'webhook.delivery_failed',
} as const;

export const INFRASTRUCTURE_EVENT_TYPES = [
  'agreement.created',
  'agreement.accepted',
  'agreement.cancelled',
  'agreement.funding_required',
  'agreement.funded',
  'agreement.in_progress',
  'agreement.released',
  'agreement.refunded',
  'milestone.created',
  'milestone.funded',
  'milestone.proof_submitted',
  'milestone.approved',
  'milestone.released',
  'escrow.created',
  'escrow.funding_detected',
  'escrow.funded',
  'escrow.release_pending',
  'escrow.released',
  'escrow.refund_pending',
  'escrow.refunded',
  'escrow.failed',
  'proof.submitted',
  'proof.under_review',
  'proof.approved',
  'proof.rejected',
  'proof.needs_changes',
  'dispute.opened',
  'dispute.resolved',
  WEBHOOK_EVENTS.deliveryFailed,
] as const;

export type InfrastructureEventType = (typeof INFRASTRUCTURE_EVENT_TYPES)[number];

const infrastructureEventTypeSet = new Set<string>(INFRASTRUCTURE_EVENT_TYPES);

export function isInfrastructureEventType(value: string): value is InfrastructureEventType {
  return infrastructureEventTypeSet.has(value);
}
