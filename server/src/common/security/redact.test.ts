import assert from 'node:assert/strict';
import test from 'node:test';
import { redactSensitive } from './redact';

test('redaction removes secrets from structured errors and metadata', () => {
  const result = redactSensitive({
    authorization: 'Bearer token-value',
    nested: { apiKey: 'pa_live_abc', databaseUrl: 'postgresql://user:pass@host/db' },
    safe: 'agreement-123',
  });
  assert.deepEqual(result, {
    authorization: '[REDACTED]',
    nested: { apiKey: '[REDACTED]', databaseUrl: '[REDACTED]' },
    safe: 'agreement-123',
  });
});
