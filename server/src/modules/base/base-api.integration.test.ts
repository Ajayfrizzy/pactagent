import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { getApiKeyPrefix, hashApiKey } from '../../common/crypto/api-keys';
import { databaseIntegrationOptions, IntegrationFixture } from '../../test/integration-helpers';

test('M2 v2 scope separation and unactivated proposal rejection have no financial side effects', databaseIntegrationOptions(), async () => {
  const fixture = new IntegrationFixture(); await fixture.connect();
  const app = await fixture.createApp('M2 API gates');
  const keys = [randomUUID(),randomUUID(),randomUUID()].map(v=>`pa_test_${v}`);
  for (const [i,scope] of ['escrows:v2:read','escrows:v2:propose','escrows:read'].entries()) {
    await prisma.apiKey.create({ data: { appId: app.id, name: 'M2', keyPrefix: getApiKeyPrefix(keys[i]), keyHash: hashApiKey(keys[i]), environment: 'sandbox', scopes: [scope] } });
  }
  const server=createApp().listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();assert.ok(address && typeof address!=='string');
  const request=(path:string, key:string, method='GET')=>fetch(`http://127.0.0.1:${address.port}/v2/base/${path}`,{method,headers:key?{'x-api-key':key}:{}});
  try {
    assert.equal((await request('capabilities','')).status,401);
    assert.equal((await request('capabilities',keys[2])).status,403);
    const capabilities=await request('capabilities',keys[0]);assert.equal(capabilities.status,200);
    assert.equal((await capabilities.json() as any).data.financialWrites,false);
    assert.equal((await request('proposals',keys[0],'POST')).status,403);
    const response=await request('proposals',keys[1],'POST');assert.equal(response.status,400);
    assert.equal((await response.json() as any).error.code,'unsupported_capability');
    assert.equal(await prisma.baseLocalOperation.count({where:{appId:app.id}}),0);
    assert.equal(await prisma.baseLocalEscrow.count({where:{appId:app.id}}),0);
  } finally {
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await fixture.cleanup();
  }
});
