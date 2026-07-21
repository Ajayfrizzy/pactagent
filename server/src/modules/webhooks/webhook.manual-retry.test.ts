import assert from 'node:assert/strict';
import test from 'node:test';
import { tenantContext } from '../../common/tenancy/tenant-context';
import { markWebhookDeliveryForRetry } from './webhook.repository';

test('concurrent manual retry reservations have exactly one winner', async () => {
  let reservations = 0;
  const client = {
    webhookDelivery: {
      updateMany: async () => ({ count: reservations++ === 0 ? 1 : 0 }),
      findUnique: async () => ({ id: 'delivery_1', status: 'PENDING' }),
    },
  } as never;

  const results = await Promise.all([
    markWebhookDeliveryForRetry(tenantContext('app_1'), 'delivery_1', client),
    markWebhookDeliveryForRetry(tenantContext('app_1'), 'delivery_1', client),
  ]);

  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(results.filter((result) => result === null).length, 1);
});
