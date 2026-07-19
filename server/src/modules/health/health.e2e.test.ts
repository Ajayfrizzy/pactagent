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
