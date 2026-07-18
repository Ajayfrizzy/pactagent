import { invalidRequest } from '../errors/app-error';

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

export function isPositiveIntegerAmount(value: string) {
  return POSITIVE_INTEGER_PATTERN.test(value);
}

export function parsePositiveIntegerAmount(value: string, fieldName: string) {
  if (!isPositiveIntegerAmount(value)) {
    throw invalidRequest(`${fieldName} must be a positive integer string.`, 'invalid_amount');
  }

  return BigInt(value);
}

export function sumIntegerAmounts(values: string[]) {
  return values.reduce((sum, value) => sum + parsePositiveIntegerAmount(value, 'amount'), BigInt(0));
}
