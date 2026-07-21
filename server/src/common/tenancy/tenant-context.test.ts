import assert from 'node:assert/strict';
import test from 'node:test';
import { tenantContext } from './tenant-context';

test('tenant context normalizes and freezes an authenticated app identifier', () => {
  const tenant = tenantContext(' app_123 ');
  assert.equal(tenant.appId, 'app_123');
  assert.equal(Object.isFrozen(tenant), true);
});

test('tenant context rejects missing app identifiers', () => {
  assert.throws(() => tenantContext('  '), /non-empty appId/);
});
