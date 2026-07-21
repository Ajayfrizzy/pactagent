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

test('webhook URL validation rejects mixed public and blocked DNS answers', async (t) => {
  t.after(resetWebhookSecurityTestHooks);
  setWebhookSecurityTestHooks({
    lookupAll: async () => [{ address: '93.184.216.34' }, { address: '169.254.169.254' }],
  });
  await assert.rejects(
    () => assertWebhookUrlAllowed('https://hooks.example.com/webhook', 'production'),
    /not allowed/,
  );
});

test('webhook URL validation blocks reserved IPv4 and IPv6 address classes', async () => {
  const blocked = [
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1',
    '172.16.0.1', '192.168.0.1', '198.18.0.1', '224.0.0.1',
    '[::]', '[::1]', '[fc00::1]', '[fd00::1]', '[fe80::1]', '[ff02::1]',
  ];
  for (const address of blocked) {
    await assert.rejects(
      () => assertWebhookUrlAllowed(`http://${address}/webhook`, 'sandbox'),
      /not allowed/,
      address,
    );
  }
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

test('webhook delivery revalidates every redirect in a multi-hop chain', async (t) => {
  t.after(resetWebhookSecurityTestHooks);
  const resolutions: string[] = [];
  const requests: string[] = [];
  setWebhookSecurityTestHooks({
    lookupAll: async (hostname) => {
      resolutions.push(hostname);
      return [{ address: '93.184.216.34' }];
    },
    requestImpl: async (url) => {
      requests.push(url.toString());
      if (url.hostname === 'one.example.com') return new Response(null, { status: 302, headers: { location: 'https://two.example.com/hop' } });
      if (url.hostname === 'two.example.com') return new Response(null, { status: 307, headers: { location: 'https://three.example.com/final' } });
      return new Response('{}', { status: 200 });
    },
  });
  const response = await fetchWebhookUrl('https://one.example.com/start', { method: 'POST', body: '{}' }, 'production', 3);
  assert.equal(response.status, 200);
  assert.deepEqual(resolutions, ['one.example.com', 'two.example.com', 'three.example.com']);
  assert.equal(requests.length, 3);
});

test('webhook delivery rejects DNS rebinding on a redirect hop', async (t) => {
  t.after(resetWebhookSecurityTestHooks);
  let resolution = 0;
  setWebhookSecurityTestHooks({
    lookupAll: async () => [{ address: resolution++ === 0 ? '93.184.216.34' : '10.0.0.4' }],
    requestImpl: async () => new Response(null, { status: 302, headers: { location: 'https://hooks.example.com/final' } }),
  });
  await assert.rejects(
    () => fetchWebhookUrl('https://hooks.example.com/start', { method: 'POST', body: '{}' }, 'production', 2),
    /not allowed/,
  );
});

test('webhook delivery enforces the redirect bound', async (t) => {
  t.after(resetWebhookSecurityTestHooks);
  setWebhookSecurityTestHooks({
    lookupAll: async () => [{ address: '93.184.216.34' }],
    requestImpl: async () => new Response(null, { status: 302, headers: { location: '/again' } }),
  });
  await assert.rejects(
    () => fetchWebhookUrl('https://hooks.example.com/start', { method: 'POST', body: '{}' }, 'production', 1),
    /redirect limit/,
  );
});
