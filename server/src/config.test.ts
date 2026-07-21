import assert from 'node:assert/strict';
import test from 'node:test';
import { assertControlledEgressProxy, assertDistinctDatabaseEndpoints, parseBoolean } from './config';

test('boolean configuration accepts only exact true and false values', () => {
  assert.equal(parseBoolean('true', false, 'FLAG'), true);
  assert.equal(parseBoolean('false', true, 'FLAG'), false);
  assert.equal(parseBoolean(undefined, true, 'FLAG'), true);
  assert.throws(() => parseBoolean('yes', false, 'FLAG'), /FLAG must be exactly/);
  assert.throws(() => parseBoolean('TRUE', false, 'FLAG'), /FLAG must be exactly/);
  assert.throws(() => parseBoolean('0', false, 'FLAG'), /FLAG must be exactly/);
});

test('controlled webhook egress requires an HTTP proxy URL', () => {
  assert.throws(() => assertControlledEgressProxy(''), /WEBHOOK_EGRESS_PROXY_URL/);
  assert.throws(() => assertControlledEgressProxy('https://proxy.example.com'), /must use http/);
  assert.doesNotThrow(() => assertControlledEgressProxy('http://proxy.example.com:3128'));
});

test('deployed database policy requires distinct pooled and migration endpoints', () => {
  assert.throws(
    () => assertDistinctDatabaseEndpoints(
      'postgresql://app:secret@db.example.com:5432/pactagent?pgbouncer=true',
      'postgresql://migrate:secret@db.example.com:5432/pactagent',
    ),
    /distinct direct migration endpoint/,
  );
  assert.doesNotThrow(() => assertDistinctDatabaseEndpoints(
    'postgresql://app:secret@pool.example.com:6432/pactagent',
    'postgresql://migrate:secret@db.example.com:5432/pactagent',
  ));
});
