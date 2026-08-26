import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeScript, scriptsEqual } from './script-utils';

const codeHash = `0x${'ab'.repeat(32)}`;

test('normalizes RPC snake_case and CCC camelCase scripts to one representation', () => {
  const rpcScript = {
    code_hash: codeHash.toUpperCase().replace('0X', '0x'),
    hash_type: 'TYPE',
    args: '0x1234',
  };
  const cccScript = {
    codeHash,
    hashType: 'type',
    args: '0x1234',
  };

  assert.deepEqual(normalizeScript(rpcScript), cccScript);
  assert.equal(scriptsEqual(rpcScript, cccScript), true);
});

test('rejects malformed scripts and mismatched args', () => {
  assert.equal(normalizeScript({ codeHash: '0x1234', hashType: 'type', args: '0x' }), null);
  assert.equal(scriptsEqual(
    { codeHash, hashType: 'type', args: '0x1234' },
    { code_hash: codeHash, hash_type: 'type', args: '0x5678' },
  ), false);
});
