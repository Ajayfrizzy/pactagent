import test from 'node:test';
import assert from 'node:assert/strict';
import { convertUsdToCkb, parseUsdAmount } from './marketPriceService';

test('parseUsdAmount extracts numeric values from formatted USD labels', () => {
  assert.equal(parseUsdAmount('$15,000 USD (payable in CKB)'), 15000);
  assert.equal(parseUsdAmount('$3,375'), 3375);
  assert.equal(parseUsdAmount(null), null);
  assert.equal(parseUsdAmount('No amount'), null);
});

test('convertUsdToCkb converts valid USD values using the live quote', () => {
  assert.equal(convertUsdToCkb(5000, 0.00151515)?.toFixed(2), '3300003.30');
  assert.equal(convertUsdToCkb(0, 0.00151515), null);
  assert.equal(convertUsdToCkb(100, 0), null);
});
