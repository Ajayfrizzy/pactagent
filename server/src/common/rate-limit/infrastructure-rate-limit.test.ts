import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../../config';
import {
  createInfrastructureRateLimit, setRateLimitTestConsumer, v1ApiKeyRateLimit,
  v1HighRiskActionRateLimit, v1IpRateLimit, v1TenantRateLimit,
} from './infrastructure-rate-limit';

function invokeMiddleware(failClosed: boolean) {
  const original = config.rateLimitFailClosed;
  (config as { rateLimitFailClosed: boolean }).rateLimitFailClosed = failClosed;
  const middleware = createInfrastructureRateLimit({ namespace: 'test', windowMs: 1000, max: 1, key: () => 'client' });
  const req = {} as Request;
  const res = { setHeader() {} } as unknown as Response;
  return new Promise<unknown>((resolve) => {
    void middleware(req, res, ((error?: unknown) => {
      (config as { rateLimitFailClosed: boolean }).rateLimitFailClosed = original;
      resolve(error);
    }) as NextFunction);
  });
}

test.afterEach(() => setRateLimitTestConsumer(null));

test('Redis limiter failure allows requests when configured fail open', async () => {
  setRateLimitTestConsumer(async () => { throw new Error('redis unavailable'); });
  assert.equal(await invokeMiddleware(false), undefined);
});

test('Redis limiter failure rejects requests when configured fail closed', async () => {
  setRateLimitTestConsumer(async () => { throw new Error('redis unavailable'); });
  const error = await invokeMiddleware(true) as { code?: string };
  assert.equal(error.code, 'rate_limit_exceeded');
});

test('IP, API-key, tenant, and high-risk actions use independent distributed buckets', async () => {
  const keys: string[] = [];
  setRateLimitTestConsumer(async (key) => {
    keys.push(key);
    return { count: 1, resetAt: Date.now() + 1000 };
  });
  const req = {
    ip: '203.0.113.9',
    apiKey: { id: 'key_1', appId: 'app_1' },
    auth: { address: 'ckt1user' },
  } as unknown as Request;
  const res = { setHeader() {} } as unknown as Response;
  const run = (middleware: ReturnType<typeof createInfrastructureRateLimit>) => new Promise<void>((resolve, reject) => {
    void middleware(req, res, ((error?: unknown) => error ? reject(error) : resolve()) as NextFunction);
  });
  await run(v1IpRateLimit);
  await run(v1ApiKeyRateLimit);
  await run(v1TenantRateLimit);
  await run(v1HighRiskActionRateLimit);
  assert.equal(keys.length, 4);
  assert.equal(new Set(keys).size, 4);
  assert.ok(keys.every((key) => key.startsWith('pactagent:rate-limit:')));
  assert.ok(keys.every((key) => !key.includes('203.0.113.9') && !key.includes('app_1') && !key.includes('key_1')));
});
