import { AgreementStatus } from './enums';

const VALID_TRANSITIONS: Record<AgreementStatus, AgreementStatus[]> = {
  [AgreementStatus.DRAFT]: [AgreementStatus.FUNDED, AgreementStatus.EXPIRED],
  [AgreementStatus.FUNDED]: [
    AgreementStatus.PROOF_SUBMITTED,
    AgreementStatus.DISPUTED,
    AgreementStatus.EXPIRED,
    AgreementStatus.REFUNDED,
  ],
  [AgreementStatus.PROOF_SUBMITTED]: [
    AgreementStatus.UNDER_REVIEW,
    AgreementStatus.DISPUTED,
    AgreementStatus.EXPIRED,
  ],
  [AgreementStatus.UNDER_REVIEW]: [
    AgreementStatus.APPROVED,
    AgreementStatus.DISPUTED,
    AgreementStatus.EXPIRED,
    AgreementStatus.REFUNDED,
  ],
  [AgreementStatus.APPROVED]: [AgreementStatus.FUNDED, AgreementStatus.PAID],
  [AgreementStatus.PAID]: [],
  [AgreementStatus.DISPUTED]: [
    AgreementStatus.APPROVED,
    AgreementStatus.REFUNDED,
  ],
  [AgreementStatus.REFUNDED]: [],
  [AgreementStatus.EXPIRED]: [AgreementStatus.REFUNDED],
};

export function isValidTransition(
  from: AgreementStatus,
  to: AgreementStatus
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getNextStates(current: AgreementStatus): AgreementStatus[] {
  return VALID_TRANSITIONS[current] ?? [];
}

export function isTerminalState(status: AgreementStatus): boolean {
  return VALID_TRANSITIONS[status]?.length === 0;
}
