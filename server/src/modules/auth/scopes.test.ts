import test from 'node:test';
import assert from 'node:assert/strict';
import { API_KEY_SCOPES, isApiKeyScope } from './scopes';

test('recommended API key scopes include Phase 1 and lifecycle scopes', () => {
  assert.equal(isApiKeyScope('apps:read'), true);
  assert.equal(isApiKeyScope('agreements:create'), true);
  assert.equal(isApiKeyScope('escrows:release'), true);
  assert.equal(isApiKeyScope('webhooks:manage'), true);
  assert.equal(isApiKeyScope('not-a-scope'), false);
  assert.equal(new Set(API_KEY_SCOPES).size, API_KEY_SCOPES.length);
});
