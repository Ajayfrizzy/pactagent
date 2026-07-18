import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRawApiKey,
  getApiKeyPrefix,
  hashApiKey,
  maskApiKey,
  verifyApiKeyHash,
} from '../../common/crypto/api-keys';
import { serializeApiKey, serializeCreatedApiKey } from './api-key.model';

test('createRawApiKey uses environment-specific prefixes', () => {
  assert.match(createRawApiKey('sandbox'), /^pa_test_/);
  assert.match(createRawApiKey('production'), /^pa_live_/);
});

test('hashApiKey stores a one-way hash rather than the raw key', () => {
  const rawKey = createRawApiKey('sandbox');
  const hash = hashApiKey(rawKey);

  assert.notEqual(hash, rawKey);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(verifyApiKeyHash(rawKey, hash), true);
  assert.equal(verifyApiKeyHash(`${rawKey}x`, hash), false);
});

test('serializeCreatedApiKey returns raw key only for creation response', () => {
  const rawKey = createRawApiKey('sandbox');
  const apiKey = {
    id: 'key_1',
    appId: 'app_1',
    name: 'Test key',
    keyPrefix: getApiKeyPrefix(rawKey),
    environment: 'sandbox',
    status: 'active',
    scopes: ['apps:read'],
    lastUsedAt: null,
    createdAt: new Date('2026-06-27T00:00:00.000Z'),
    revokedAt: null,
  };

  const created = serializeCreatedApiKey(apiKey, rawKey);
  const listed = serializeApiKey(apiKey);

  assert.equal(created.key, rawKey);
  assert.equal('key' in listed, false);
  assert.equal(listed.maskedKey, maskApiKey(apiKey.keyPrefix));
});
