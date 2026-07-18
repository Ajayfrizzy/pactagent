import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../../config';
import {
  decryptWebhookSecret,
  encryptWebhookSecret,
  generateWebhookSecret,
  hashWebhookSecret,
  signWebhookPayload,
  verifyWebhookSignature,
} from './webhook.signing';

test('webhook secrets are generated, hashed, and encrypted without storing raw values', () => {
  config.webhookSecretEncryptionKey = 'test-webhook-secret-encryption-key';
  const secret = generateWebhookSecret();
  const hash = hashWebhookSecret(secret);
  const encrypted = encryptWebhookSecret(secret);

  assert.match(secret, /^whsec_/);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, secret);
  assert.notEqual(encrypted, secret);
  assert.equal(decryptWebhookSecret(encrypted), secret);
});

test('webhook signature verifies timestamp plus raw body', () => {
  const secret = 'whsec_test_secret';
  const timestamp = '1782518400';
  const rawBody = JSON.stringify({ event: 'proof.submitted', id: 'evt_1' });
  const signature = signWebhookPayload(secret, timestamp, rawBody);

  assert.match(signature, /^sha256=[a-f0-9]{64}$/);
  assert.equal(verifyWebhookSignature({ secret, timestamp, rawBody, signature }), true);
  assert.equal(verifyWebhookSignature({ secret, timestamp, rawBody: `${rawBody} `, signature }), false);
});

test('webhook encryption key IDs support rotation without losing old ciphertext', () => {
  const previousActiveKeyId = config.webhookActiveKeyId;
  const previousKeys = config.webhookEncryptionKeys;
  config.webhookEncryptionKeys = {
    old: 'old-encryption-key-at-least-32-characters',
    current: 'current-encryption-key-at-least-32-characters',
  };
  try {
    config.webhookActiveKeyId = 'old';
    const oldCiphertext = encryptWebhookSecret('whsec_rotation_test');
    config.webhookActiveKeyId = 'current';
    const currentCiphertext = encryptWebhookSecret('whsec_current_test');

    assert.match(oldCiphertext, /^v2\.old\./);
    assert.match(currentCiphertext, /^v2\.current\./);
    assert.equal(decryptWebhookSecret(oldCiphertext), 'whsec_rotation_test');
    assert.equal(decryptWebhookSecret(currentCiphertext), 'whsec_current_test');
  } finally {
    config.webhookActiveKeyId = previousActiveKeyId;
    config.webhookEncryptionKeys = previousKeys;
  }
});
