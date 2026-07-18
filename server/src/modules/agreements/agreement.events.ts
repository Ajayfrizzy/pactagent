export const AGREEMENT_EVENTS = {
  created: 'agreement.created',
  accepted: 'agreement.accepted',
  cancelled: 'agreement.cancelled',
  fundingRequired: 'agreement.funding_required',
  funded: 'agreement.funded',
  inProgress: 'agreement.in_progress',
  released: 'agreement.released',
  refunded: 'agreement.refunded',
} as const;

export function eventTypeForAgreementStatus(status: string) {
  switch (status) {
    case 'accepted':
      return AGREEMENT_EVENTS.accepted;
    case 'funding_required':
      return AGREEMENT_EVENTS.fundingRequired;
    case 'funded':
      return AGREEMENT_EVENTS.funded;
    case 'in_progress':
      return AGREEMENT_EVENTS.inProgress;
    case 'released':
      return AGREEMENT_EVENTS.released;
    case 'refunded':
      return AGREEMENT_EVENTS.refunded;
    case 'cancelled':
      return AGREEMENT_EVENTS.cancelled;
    default:
      return null;
  }
}
