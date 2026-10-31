import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { getApiKeyPrefix, hashApiKey } from '../../common/crypto/api-keys';
import { databaseIntegrationOptions, IntegrationFixture } from '../../test/integration-helpers';

test('v2 metadata is authenticated, read-only and tenant scoped; v1 remains available', databaseIntegrationOptions(), async () => {
  const fixture = new IntegrationFixture();
  await fixture.connect();
  const app = await fixture.createApp('M1 API');
  const other = await fixture.createApp('M1 API other');
  const agreement = await fixture.createAgreement(app.id);
  const escrow = await prisma.escrow.create({ data: { appId: app.id, agreementId: agreement.id, currency: 'CKB', amount: '1000' } });
  const key = `pa_test_${randomUUID()}`;
  const wrongKey = `pa_test_${randomUUID()}`;
  const noScopeKey = `pa_test_${randomUUID()}`;
  for (const [raw, appId, scopes] of [[key, app.id, ['escrows:read']], [wrongKey, other.id, ['escrows:read']], [noScopeKey, app.id, ['agreements:read']]] as const) {
    await prisma.apiKey.create({ data: { appId, name: 'M1', keyPrefix: getApiKeyPrefix(raw), keyHash: hashApiKey(raw), environment: 'sandbox', scopes: [...scopes] } });
  }
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const request = (path: string, raw = key, method = 'GET') => fetch(`http://127.0.0.1:${address.port}${path}`, { method, headers: raw ? { 'x-api-key': raw } : {} });
  try {
    assert.equal((await request('/v2/metadata', '')).status, 401);
    assert.equal((await request('/v2/metadata', noScopeKey)).status, 403);
    const metadata = await request('/v2/metadata');
    assert.equal(metadata.status, 200);
    const body = await metadata.json() as any;
    assert.equal(body.data.candidates[0].token, null);
    assert.equal(body.data.financialWrites, 'unavailable');
    const path = `/v2/escrows/${escrow.id}/capabilities`;
    assert.equal((await request(path, wrongKey)).status, 404);
    assert.equal((await request(path)).status, 200);
    const unavailable = await request(`${path}?action=arbitrate`);
    assert.equal(unavailable.status, 400);
    assert.equal((await unavailable.json() as any).error.code, 'unsupported_rail_capability');
    assert.equal((await request('/v2/metadata', key, 'POST')).status, 404);
    assert.equal((await request(`/v1/escrows/${escrow.id}`)).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fixture.cleanup();
  }
});
