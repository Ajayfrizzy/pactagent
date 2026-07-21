import { invalidRequest } from '../errors/app-error';

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;
export const MAX_SHANNONS = BigInt('18446744073709551615');

export function isPositiveIntegerAmount(value: string) {
  return POSITIVE_INTEGER_PATTERN.test(value);
}

export function parsePositiveIntegerAmount(value: string, fieldName: string) {
  if (!isPositiveIntegerAmount(value)) {
    throw invalidRequest(`${fieldName} must be a positive integer string.`, 'invalid_amount');
  }

  const amount = BigInt(value);
  if (amount > MAX_SHANNONS) {
    throw invalidRequest(`${fieldName} exceeds the maximum supported shannon amount.`, 'amount_out_of_range');
  }
  return amount;
}

export function sumIntegerAmounts(values: string[]) {
  return values.reduce((sum, value) => sum + parsePositiveIntegerAmount(value, 'amount'), BigInt(0));
}
