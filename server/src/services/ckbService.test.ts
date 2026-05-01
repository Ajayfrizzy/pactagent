import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsEqual } from './ckbService';

test('scriptsEqual matches RPC snake_case script fields with CCC camelCase script fields', () => {
  const rpcScript = {
    code_hash: '0xABCDEF',
    hash_type: 'type',
    args: '0x1234',
  };

  const cccScript = {
    codeHash: '0xabcdef',
    hashType: 'type',
    args: '0x1234',
  };

  assert.equal(scriptsEqual(rpcScript, cccScript), true);
});

test('scriptsEqual rejects scripts with different args', () => {
  const left = {
    code_hash: '0xabcdef',
    hash_type: 'type',
    args: '0x1234',
  };
  const right = {
    codeHash: '0xabcdef',
    hashType: 'type',
    args: '0x5678',
  };

  assert.equal(scriptsEqual(left, right), false);
});
