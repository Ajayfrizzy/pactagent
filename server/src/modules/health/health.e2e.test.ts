import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createApp } from '../../app';

test('GET /health is process-local and exposes only operational build metadata', async (t) => {
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  const body = await response.json() as { data: Record<string, unknown> };

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body.data).sort(), ['commit', 'status', 'timestamp', 'version']);
  assert.equal(JSON.stringify(body).includes('DATABASE_URL'), false);
  assert.equal(JSON.stringify(body).includes('SECRET'), false);
});

test('endpoint payload limits reject oversized writes before authentication', async (t) => {
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const response = await fetch(`http://127.0.0.1:${address.port}/v1/apps`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: 'x'.repeat(70 * 1024) }),
  });
  const body = await response.json() as { error: { code: string } };
  assert.equal(response.status, 413);
  assert.equal(body.error.code, 'payload_too_large');
});

test('/v1 auth boots and the removed /api product surface returns 410', async (t) => {
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const challengeResponse = await fetch(`http://127.0.0.1:${address.port}/v1/auth/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: 'ckt-test-operator' }),
  });
  const challengeBody = await challengeResponse.json() as {
    data: { message: string; expiresAt: string };
    requestId: string;
  };
  assert.equal(challengeResponse.status, 200);
  assert.match(challengeBody.data.message, /PactAgent Authentication/);
  assert.match(challengeBody.requestId, /^req_/);

  const sessionResponse = await fetch(`http://127.0.0.1:${address.port}/v1/auth/me`);
  const sessionBody = await sessionResponse.json() as {
    error: { type: string; code: string; requestId: string };
  };
  assert.equal(sessionResponse.status, 401);
  assert.equal(sessionBody.error.type, 'authentication_error');
  assert.equal(sessionBody.error.code, 'authentication_required');
  assert.match(sessionBody.error.requestId, /^req_/);

  const legacyResponse = await fetch(`http://127.0.0.1:${address.port}/api/agreements`);
  const legacyBody = await legacyResponse.json() as { success: boolean; error: string };
  assert.equal(legacyResponse.status, 410);
  assert.equal(legacyBody.success, false);
  assert.match(legacyBody.error, /Use the app-scoped \/v1 infrastructure API/);
});
