import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { config, requireConfig } from '../../config';

const SECRET_PREFIX = 'whsec_';
const CIPHER_ALGORITHM = 'aes-256-gcm';

function encryptionKey(keyId: string) {
  const source = requireConfig(
    config.webhookEncryptionKeys[keyId] || (keyId === 'legacy' ? config.webhookSecretEncryptionKey : ''),
    `webhook encryption key ${keyId}`,
  );
  return createHash('sha256').update(source).digest();
}

export function generateWebhookSecret() {
  return `${SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function hashWebhookSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

export function encryptWebhookSecret(secret: string) {
  const keyId = config.webhookActiveKeyId;
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER_ALGORITHM, encryptionKey(keyId), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    'v2',
    keyId,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptWebhookSecret(encrypted: string) {
  const parts = encrypted.split('.');
  const isLegacy = parts[0] === 'v1';
  const [keyId, iv, authTag, ciphertext] = isLegacy
    ? ['legacy', parts[1], parts[2], parts[3]]
    : [parts[1], parts[2], parts[3], parts[4]];
  if ((!isLegacy && parts[0] !== 'v2') || !keyId || !iv || !authTag || !ciphertext) {
    throw new Error('Invalid encrypted webhook secret.');
  }

  const decipher = createDecipheriv(CIPHER_ALGORITHM, encryptionKey(keyId), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
}

export function getWebhookEncryptionKeyId(encrypted: string) {
  const [version, keyId] = encrypted.split('.');
  if (version === 'v1') return 'legacy';
  if (version === 'v2' && keyId) return keyId;
  throw new Error('Invalid encrypted webhook secret.');
}

export function signWebhookPayload(secret: string, timestamp: string | number, rawBody: string) {
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  return `sha256=${signature}`;
}

export function verifyWebhookSignature(params: {
  secret: string;
  timestamp: string | number;
  rawBody: string;
  signature: string;
}) {
  const expected = signWebhookPayload(params.secret, params.timestamp, params.rawBody);
  const actual = params.signature;

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}
