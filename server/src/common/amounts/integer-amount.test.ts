import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPositiveIntegerAmount,
  parsePositiveIntegerAmount,
  sumIntegerAmounts,
  MAX_SHANNONS,
} from './integer-amount';

test('integer amount helpers accept positive integer strings only', () => {
  assert.equal(isPositiveIntegerAmount('1'), true);
  assert.equal(isPositiveIntegerAmount('10000000000'), true);
  assert.equal(isPositiveIntegerAmount('0'), false);
  assert.equal(isPositiveIntegerAmount('1.5'), false);
  assert.equal(isPositiveIntegerAmount('-1'), false);
});

test('integer amount helpers parse and sum exact bigint values', () => {
  assert.equal(parsePositiveIntegerAmount('100', 'amount'), BigInt(100));
  assert.equal(sumIntegerAmounts(['100', '250', '650']).toString(), '1000');
  assert.throws(() => parsePositiveIntegerAmount('0', 'amount'), /positive integer string/);
  assert.equal(parsePositiveIntegerAmount(MAX_SHANNONS.toString(), 'amount'), MAX_SHANNONS);
  assert.throws(
    () => parsePositiveIntegerAmount((MAX_SHANNONS + BigInt(1)).toString(), 'amount'),
    /maximum supported shannon amount/,
  );
});
