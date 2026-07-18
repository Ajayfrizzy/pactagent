import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'dns/promises';
import {
  assertWebhookUrlAllowed,
  fetchWebhookUrl,
  resetWebhookSecurityTestHooks,
  setWebhookSecurityTestHooks,
} from './webhook.security';

test('webhook URL validation allows safe sandbox HTTPS endpoints', async (t) => {
  t.mock.method(dns, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);

  assert.equal(
    await assertWebhookUrlAllowed('https://example.com/pactagent/webhook', 'sandbox'),
    'https://example.com/pactagent/webhook',
  );
});

test('webhook URL validation rejects localhost and private network targets', async () => {
  await assert.rejects(() => assertWebhookUrlAllowed('http://localhost:3000/webhook', 'sandbox'), /not allowed/);
  await assert.rejects(() => assertWebhookUrlAllowed('http://127.0.0.1/webhook', 'sandbox'), /not allowed/);
  await assert.rejects(() => assertWebhookUrlAllowed('http://10.0.0.5/webhook', 'sandbox'), /not allowed/);
  await assert.rejects(() => assertWebhookUrlAllowed('http://192.168.1.10/webhook', 'sandbox'), /not allowed/);
  await assert.rejects(() => assertWebhookUrlAllowed('http://169.254.169.254/latest/meta-data', 'sandbox'), /not allowed/);
  await assert.rejects(() => assertWebhookUrlAllowed('http://[::1]/webhook', 'sandbox'), /not allowed/);
  await assert.rejects(() => assertWebhookUrlAllowed('http://[fd00::1]/webhook', 'sandbox'), /not allowed/);
});

test('webhook URL validation rejects private DNS results', async (t) => {
  t.mock.method(dns, 'lookup', async () => [{ address: '10.0.0.10', family: 4 }]);

  await assert.rejects(
    () => assertWebhookUrlAllowed('https://example.com/webhook', 'sandbox'),
    /resolves to a host that is not allowed/,
  );
});

test('webhook URL validation rejects non-http protocols and requires HTTPS in production', async () => {
  await assert.rejects(() => assertWebhookUrlAllowed('file:///tmp/webhook', 'sandbox'), /http or https/);
  await assert.rejects(() => assertWebhookUrlAllowed('http://example.com/webhook', 'production'), /HTTPS/);
});

test('webhook delivery pins the connection to the address approved by validation', async (t) => {
  t.after(resetWebhookSecurityTestHooks);
  const connections: Array<{ hostname: string; address: string }> = [];

  setWebhookSecurityTestHooks({
    lookupAll: async () => [{ address: '93.184.216.34' }],
    requestImpl: async (url, _init, address) => {
      connections.push({ hostname: url.hostname, address });
      return new Response('{}', { status: 200 });
    },
  });

  await fetchWebhookUrl('https://hooks.example.com/events', {
    method: 'POST',
    body: '{}',
  }, 'production', 0);

  assert.deepEqual(connections, [{
    hostname: 'hooks.example.com',
    address: '93.184.216.34',
  }]);
});
