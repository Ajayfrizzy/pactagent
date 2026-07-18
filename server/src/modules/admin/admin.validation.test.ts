import test from 'node:test';
import assert from 'node:assert/strict';
import { adminListQuerySchema } from './admin.validation';

test('admin list query validation applies pagination defaults', () => {
  const parsed = adminListQuerySchema.parse({});
  assert.equal(parsed.limit, 20);
  assert.equal(parsed.cursor, undefined);
});

test('admin list query validation accepts filters and clamps large limits', () => {
  const parsed = adminListQuerySchema.parse({
    appId: 'sandbox-demo-app',
    status: 'active',
    type: 'agreement.created',
    limit: '100',
  });

  assert.equal(parsed.appId, 'sandbox-demo-app');
  assert.equal(parsed.status, 'active');
  assert.equal(parsed.type, 'agreement.created');
  assert.equal(parsed.limit, 100);

  assert.throws(() => adminListQuerySchema.parse({ limit: '101' }));
});
