import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestHash } from './request-hash';

test('request hash is stable for equivalent JSON body key ordering', () => {
  const left = createRequestHash({
    method: 'post',
    path: '/v1/escrows',
    body: { b: 2, a: { d: 4, c: 3 } },
  });
  const right = createRequestHash({
    method: 'POST',
    path: '/v1/escrows',
    body: { a: { c: 3, d: 4 }, b: 2 },
  });

  assert.equal(left, right);
});

test('request hash changes when body changes', () => {
  const left = createRequestHash({
    method: 'POST',
    path: '/v1/escrows',
    body: { amount: '100' },
  });
  const right = createRequestHash({
    method: 'POST',
    path: '/v1/escrows',
    body: { amount: '101' },
  });

  assert.notEqual(left, right);
});
