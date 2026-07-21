import dns from 'dns/promises';
import http from 'http';
import https from 'https';
import net from 'net';
import tls from 'tls';
import { invalidRequest } from '../../common/errors/app-error';
import { config } from '../../config';

type LookupAddress = {
  address: string;
};

let lookupAll = (hostname: string): Promise<LookupAddress[]> => dns.lookup(hostname, {
  all: true,
  verbatim: true,
}) as Promise<LookupAddress[]>;

type PinnedRequest = (url: URL, init: RequestInit, address: string) => Promise<Response>;
const MAX_WEBHOOK_RESPONSE_BYTES = 64 * 1024;

let requestImpl: PinnedRequest = requestPinnedAddress;

export function setWebhookSecurityTestHooks(hooks: {
  lookupAll?: typeof lookupAll;
  requestImpl?: PinnedRequest;
}) {
  lookupAll = hooks.lookupAll ?? lookupAll;
  requestImpl = hooks.requestImpl ?? requestImpl;
}

export function resetWebhookSecurityTestHooks() {
  lookupAll = (hostname: string): Promise<LookupAddress[]> => dns.lookup(hostname, {
    all: true,
    verbatim: true,
  }) as Promise<LookupAddress[]>;
  requestImpl = requestPinnedAddress;
}

function parseIpv4(hostname: string) {
  const parts = hostname.split('.');
  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => Number(part));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }

  return octets;
}

function isBlockedIpv4Address(address: string) {
  const octets = parseIpv4(address);
  if (!octets) {
    return false;
  }

  const [first, second, third, fourth] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 198 && [18, 19].includes(second))
    || first >= 224;
}

function normalizeIpv6(address: string) {
  return address.toLowerCase().replace(/^\[|\]$/g, '');
}

function isBlockedIpv6Address(address: string) {
  const normalized = normalizeIpv6(address);
  return normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe80')
    || normalized.startsWith('ff')
    || normalized.startsWith('::ffff:0:')
    || normalized.startsWith('::ffff:10.')
    || normalized.startsWith('::ffff:127.')
    || normalized.startsWith('::ffff:169.254.')
    || normalized.startsWith('::ffff:192.168.');
}

function isBlockedIpAddress(address: string) {
  const ipVersion = net.isIP(address);
  if (ipVersion === 4) {
    return isBlockedIpv4Address(address);
  }

  if (ipVersion === 6) {
    const mappedIpv4 = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
    if (mappedIpv4) {
      return isBlockedIpv4Address(mappedIpv4);
    }

    return isBlockedIpv6Address(address);
  }

  return false;
}

function isBlockedHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');

  if (
    normalized === 'localhost'
    || normalized === '0.0.0.0'
    || normalized === 'metadata.google.internal'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || normalized.endsWith('.internal')
  ) {
    return true;
  }

  if (net.isIP(normalized)) {
    return isBlockedIpAddress(normalized);
  }

  return isBlockedIpv4Address(normalized);
}

function assertWebhookUrlShapeAllowed(rawUrl: string, environment: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw invalidRequest('Webhook URL must be valid.', 'invalid_webhook_url');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw invalidRequest('Webhook URL must use http or https.', 'invalid_webhook_url_protocol');
  }

  if (environment === 'production' && parsed.protocol !== 'https:') {
    throw invalidRequest('Production webhook URLs must use HTTPS.', 'webhook_https_required');
  }

  if (parsed.username || parsed.password) {
    throw invalidRequest('Webhook URLs cannot include credentials.', 'invalid_webhook_url_credentials');
  }

  if (isBlockedHostname(parsed.hostname)) {
    throw invalidRequest('Webhook URL host is not allowed.', 'webhook_url_not_allowed');
  }

  return parsed.toString();
}

async function resolveHostname(hostname: string) {
  const normalized = hostname.replace(/^\[|\]$/g, '');

  if (net.isIP(normalized)) {
    return [normalized];
  }

  const records = await lookupAll(normalized);

  return records.map((record) => record.address);
}

function requestPinnedAddress(url: URL, init: RequestInit, address: string): Promise<Response> {
  if (config.webhookEgressProxyUrl) {
    return requestThroughProxy(url, init, address, new URL(config.webhookEgressProxyUrl));
  }
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const headers = new Headers(init.headers);
    if (!headers.has('host')) {
      headers.set('host', url.host);
    }

    const request = transport.request({
      protocol: url.protocol,
      hostname: address,
      port: url.port || undefined,
      method: init.method ?? 'GET',
      path: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(headers.entries()),
      ...(url.protocol === 'https:' ? { servername: url.hostname } : {}),
    }, (response) => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) {
          value.forEach((item) => responseHeaders.append(name, item));
        } else if (value !== undefined) {
          responseHeaders.set(name, value);
        }
      }

      const chunks: Buffer[] = [];
      let responseBytes = 0;
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        responseBytes += buffer.length;
        if (responseBytes > MAX_WEBHOOK_RESPONSE_BYTES) {
          response.destroy(new Error(`Webhook response exceeded ${MAX_WEBHOOK_RESPONSE_BYTES} bytes.`));
          return;
        }
        chunks.push(buffer);
      });
      response.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve(new Response(body.length > 0 ? body : null, {
          status: response.statusCode ?? 500,
          statusText: response.statusMessage,
          headers: responseHeaders,
        }));
      });
      response.on('error', reject);
    });

    request.on('error', reject);
    if (init.signal) {
      const abort = () => request.destroy(init.signal?.reason instanceof Error ? init.signal.reason : new Error('Webhook request aborted.'));
      if (init.signal.aborted) {
        abort();
        return;
      }
      init.signal.addEventListener('abort', abort, { once: true });
      request.once('close', () => init.signal?.removeEventListener('abort', abort));
    }

    if (init.body === undefined || init.body === null) {
      request.end();
    } else if (typeof init.body === 'string' || init.body instanceof Uint8Array) {
      request.end(init.body);
    } else {
      request.destroy(new TypeError('Webhook request body must be a string or byte array.'));
    }
  });
}

function proxyAuthorization(proxy: URL) {
  if (!proxy.username && !proxy.password) return undefined;
  return `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}`;
}

function responseToFetchResponse(response: http.IncomingMessage, resolve: (value: Response) => void, reject: (reason?: unknown) => void) {
  const responseHeaders = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item));
    else if (value !== undefined) responseHeaders.set(name, value);
  }
  const chunks: Buffer[] = [];
  let responseBytes = 0;
  response.on('data', (chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    responseBytes += buffer.length;
    if (responseBytes > MAX_WEBHOOK_RESPONSE_BYTES) {
      response.destroy(new Error(`Webhook response exceeded ${MAX_WEBHOOK_RESPONSE_BYTES} bytes.`));
      return;
    }
    chunks.push(buffer);
  });
  response.on('end', () => resolve(new Response(Buffer.concat(chunks), {
    status: response.statusCode ?? 500,
    statusText: response.statusMessage,
    headers: responseHeaders,
  })));
  response.on('error', reject);
}

function writeRequestBody(request: http.ClientRequest, body: RequestInit['body']) {
  if (body === undefined || body === null) request.end();
  else if (typeof body === 'string' || body instanceof Uint8Array) request.end(body);
  else request.destroy(new TypeError('Webhook request body must be a string or byte array.'));
}

function requestThroughProxy(url: URL, init: RequestInit, address: string, proxy: URL): Promise<Response> {
  return new Promise((resolve, reject) => {
    const headers = new Headers(init.headers);
    headers.set('host', url.host);
    const authorization = proxyAuthorization(proxy);

    if (url.protocol === 'http:') {
      if (authorization) headers.set('proxy-authorization', authorization);
      const pinned = new URL(url);
      pinned.hostname = address;
      const request = http.request({
        hostname: proxy.hostname, port: proxy.port || 80, method: init.method ?? 'GET',
        path: pinned.toString(), headers: Object.fromEntries(headers.entries()), signal: init.signal ?? undefined,
      }, (response) => responseToFetchResponse(response, resolve, reject));
      request.on('error', reject);
      writeRequestBody(request, init.body);
      return;
    }

    const connectHeaders: Record<string, string> = { host: `${address}:${url.port || 443}` };
    if (authorization) connectHeaders['proxy-authorization'] = authorization;
    const tunnel = http.request({
      hostname: proxy.hostname, port: proxy.port || 80, method: 'CONNECT',
      path: `${address}:${url.port || 443}`, headers: connectHeaders,
    });
    tunnel.on('connect', (_response, socket) => {
      const secureSocket = tls.connect({ socket, servername: url.hostname });
      const request = https.request({
        hostname: url.hostname, port: Number(url.port || 443), method: init.method ?? 'GET',
        path: `${url.pathname}${url.search}`, headers: Object.fromEntries(headers.entries()),
        createConnection: () => secureSocket, agent: false, signal: init.signal ?? undefined,
      }, (response) => responseToFetchResponse(response, resolve, reject));
      request.on('error', reject);
      writeRequestBody(request, init.body);
    });
    tunnel.on('error', reject);
    tunnel.end();
  });
}

async function resolveAllowedTarget(rawUrl: string, environment: string) {
  const normalizedUrl = assertWebhookUrlShapeAllowed(rawUrl, environment);
  const url = new URL(normalizedUrl);
  const addresses = await resolveHostname(url.hostname);

  if (addresses.length === 0 || addresses.some(isBlockedIpAddress)) {
    throw invalidRequest('Webhook URL resolves to a host that is not allowed.', 'webhook_url_not_allowed');
  }

  return { url, addresses };
}

export async function assertWebhookUrlAllowed(rawUrl: string, environment: string) {
  const target = await resolveAllowedTarget(rawUrl, environment);
  return target.url.toString();
}

export async function fetchWebhookUrl(rawUrl: string, init: RequestInit, environment: string, maxRedirects = 3) {
  let currentUrl = rawUrl;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const target = await resolveAllowedTarget(currentUrl, environment);
    const response = await requestImpl(target.url, init, target.addresses[0]);

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers.get('location');
    if (!location) {
      throw invalidRequest('Webhook redirect response is missing a Location header.', 'webhook_redirect_missing_location');
    }

    if (redirectCount === maxRedirects) {
      throw invalidRequest('Webhook delivery exceeded the redirect limit.', 'webhook_redirect_limit_exceeded');
    }

    currentUrl = new URL(location, target.url).toString();
  }

  throw invalidRequest('Webhook delivery exceeded the redirect limit.', 'webhook_redirect_limit_exceeded');
}
