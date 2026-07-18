export const ESCROW_EVENTS = {
  created: 'escrow.created',
  fundingDetected: 'escrow.funding_detected',
  funded: 'escrow.funded',
  releasePending: 'escrow.release_pending',
  released: 'escrow.released',
  refundPending: 'escrow.refund_pending',
  refunded: 'escrow.refunded',
  failed: 'escrow.failed',
} as const;
