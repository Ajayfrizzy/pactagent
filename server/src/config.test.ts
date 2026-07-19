import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBoolean } from './config';

test('boolean configuration accepts only exact true and false values', () => {
  assert.equal(parseBoolean('true', false, 'FLAG'), true);
  assert.equal(parseBoolean('false', true, 'FLAG'), false);
  assert.equal(parseBoolean(undefined, true, 'FLAG'), true);
  assert.throws(() => parseBoolean('yes', false, 'FLAG'), /FLAG must be exactly/);
  assert.throws(() => parseBoolean('TRUE', false, 'FLAG'), /FLAG must be exactly/);
  assert.throws(() => parseBoolean('0', false, 'FLAG'), /FLAG must be exactly/);
});
