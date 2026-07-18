import { createHash, randomBytes, timingSafeEqual } from 'crypto';

const API_KEY_RANDOM_BYTES = 32;
const API_KEY_PREFIX_CHARS = 16;

export type ApiKeyEnvironment = 'sandbox' | 'production';

export function createRawApiKey(environment: ApiKeyEnvironment) {
  const token = randomBytes(API_KEY_RANDOM_BYTES).toString('base64url');
  const prefix = environment === 'production' ? 'pa_live' : 'pa_test';
  return `${prefix}_${token}`;
}

export function getApiKeyPrefix(rawKey: string) {
  return rawKey.slice(0, API_KEY_PREFIX_CHARS);
}

export function hashApiKey(rawKey: string) {
  return createHash('sha256').update(rawKey).digest('hex');
}

export function verifyApiKeyHash(rawKey: string, expectedHash: string) {
  const actualHash = hashApiKey(rawKey);
  const actual = Buffer.from(actualHash, 'hex');
  const expected = Buffer.from(expectedHash, 'hex');

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function maskApiKey(prefix: string) {
  return `${prefix}...`;
}
