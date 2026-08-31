import { invalidRequest } from '../errors/app-error';
import { financialInvariantRejections } from '../observability/metrics';
import { MAX_SHANNONS, parsePositiveIntegerAmount } from './integer-amount';

const NON_NEGATIVE_INTEGER_PATTERN = /^(0|[1-9]\d*)$/;

function reject(invariant: string, message: string, code: string): never {
  financialInvariantRejections.inc({ invariant });
  throw invalidRequest(message, code);
}

export function parseNonNegativeIntegerAmount(value: string, fieldName: string) {
  if (!NON_NEGATIVE_INTEGER_PATTERN.test(value)) {
    return reject('non_negative_amount', `${fieldName} must be a non-negative integer string.`, 'invalid_amount');
  }

  const amount = BigInt(value);
  if (amount > MAX_SHANNONS) {
    return reject('amount_range', `${fieldName} exceeds the maximum supported shannon amount.`, 'amount_out_of_range');
  }
  return amount;
}

export function assertCurrencyMatchesAgreement(currency: string, agreementCurrency: string) {
  if (currency !== agreementCurrency) {
    reject('currency_match', 'Financial resource currency must match the agreement currency.', 'currency_mismatch');
  }
}

export function assertMilestoneAllocationWithinAgreement(params: {
  existingTotal: bigint;
  proposedAmount: string;
  agreementAmount: string;
}) {
  const proposedAmount = parsePositiveIntegerAmount(params.proposedAmount, 'amount');
  const agreementAmount = parsePositiveIntegerAmount(params.agreementAmount, 'agreement.totalAmount');
  if (params.existingTotal + proposedAmount > agreementAmount) {
    reject(
      'milestone_allocation',
      'The sum of milestone amounts cannot exceed the agreement totalAmount.',
      'milestone_total_exceeds_agreement',
    );
  }
}

export function assertEscrowAmountWithinScope(params: {
  escrowAmount: string;
  scopeAmount: string;
  scope: 'agreement' | 'milestone';
  exact?: boolean;
}) {
  const escrowAmount = parsePositiveIntegerAmount(params.escrowAmount, 'amount');
  const scopeAmount = parsePositiveIntegerAmount(params.scopeAmount, `${params.scope}.amount`);
  if (params.exact && escrowAmount !== scopeAmount) {
    reject(
      'escrow_exact_allocation',
      `Escrow amount must exactly equal ${params.scope} amount for this rail.`,
      `escrow_amount_must_equal_${params.scope}`,
    );
  }
  if (escrowAmount > scopeAmount) {
    reject(
      'escrow_allocation',
      `Escrow amount cannot exceed ${params.scope} amount.`,
      `escrow_amount_exceeds_${params.scope}`,
    );
  }
}

export function assertSettlementSplit(params: {
  workerAmount: string;
  clientAmount: string;
  settlementAmount: string;
}) {
  const workerAmount = parseNonNegativeIntegerAmount(params.workerAmount, 'workerAmount');
  const clientAmount = parseNonNegativeIntegerAmount(params.clientAmount, 'clientAmount');
  const settlementAmount = parsePositiveIntegerAmount(params.settlementAmount, 'settlementAmount');

  if (workerAmount > settlementAmount || clientAmount > settlementAmount) {
    reject(
      'settlement_split_bounds',
      'Neither dispute split amount may exceed the funded settlement amount.',
      'invalid_settlement_split',
    );
  }
  if (workerAmount + clientAmount !== settlementAmount) {
    reject(
      'settlement_split_total',
      'workerAmount and clientAmount must exactly equal the funded settlement amount.',
      'invalid_settlement_split',
    );
  }
}
