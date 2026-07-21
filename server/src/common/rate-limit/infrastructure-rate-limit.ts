import { createHash } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { createClient } from 'redis';
import { config } from '../../config';
import { log } from '../observability/logger';
import { rateLimitError } from '../errors/app-error';

type RateLimitOptions = {
  namespace: string;
  windowMs: number;
  max: number;
  key: (req: Request) => string | null | undefined;
};

type MemoryBucket = { count: number; resetAt: number };
const memoryBuckets = new Map<string, MemoryBucket>();
const redisClient = config.redisUrl ? createClient({ url: config.redisUrl }) : null;
let redisConnection: Promise<void> | null = null;

redisClient?.on('error', (error) => log('error', 'rate_limit.redis.error', { error }));

function storageKey(namespace: string, rawKey: string) {
  const digest = createHash('sha256').update(rawKey).digest('hex');
  return `pactagent:rate-limit:${namespace}:${digest}`;
}

async function connectRedis() {
  if (!redisClient || redisClient.isReady) return;
  redisConnection ??= redisClient.connect().then(() => undefined).finally(() => { redisConnection = null; });
  await redisConnection;
}

async function consumeRedis(key: string, windowMs: number) {
  await connectRedis();
  const result = await redisClient!.eval(
    "local count=redis.call('INCR',KEYS[1]); if count==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return {count,redis.call('PTTL',KEYS[1])}",
    { keys: [key], arguments: [String(windowMs)] },
  ) as [number, number];
  return { count: Number(result[0]), resetAt: Date.now() + Math.max(1, Number(result[1])) };
}

function consumeMemory(key: string, windowMs: number) {
  const now = Date.now();
  const existing = memoryBuckets.get(key);
  const bucket = !existing || existing.resetAt <= now
    ? { count: 1, resetAt: now + windowMs }
    : { count: existing.count + 1, resetAt: existing.resetAt };
  memoryBuckets.set(key, bucket);
  if (memoryBuckets.size > 10_000) {
    for (const [bucketKey, value] of memoryBuckets) {
      if (value.resetAt <= now) memoryBuckets.delete(bucketKey);
    }
  }
  return bucket;
}

async function consume(key: string, windowMs: number) {
  if (!redisClient) return consumeMemory(key, windowMs);
  try {
    return await consumeRedis(key, windowMs);
  } catch (error) {
    if (config.rateLimitFailClosed) throw error;
    log('warn', 'rate_limit.redis.fallback', { error });
    return consumeMemory(key, windowMs);
  }
}

type Bucket = { count: number; resetAt: number };
let consumeBucket: (key: string, windowMs: number) => Promise<Bucket> = consume;

export function setRateLimitTestConsumer(consumer: ((key: string, windowMs: number) => Promise<Bucket>) | null) {
  consumeBucket = consumer ?? consume;
}

export function createInfrastructureRateLimit(options: RateLimitOptions) {
  return async function infrastructureRateLimit(req: Request, res: Response, next: NextFunction) {
    const rawKey = options.key(req);
    if (!rawKey) return next();
    try {
      const bucket = await consumeBucket(storageKey(options.namespace, rawKey), options.windowMs);
      const limited = bucket.count > options.max;
      const remaining = Math.max(0, options.max - bucket.count);
      res.setHeader('RateLimit-Limit', String(options.max));
      res.setHeader('RateLimit-Remaining', String(remaining));
      res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
      if (limited) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000))));
        return next(rateLimitError());
      }
      return next();
    } catch (error) {
      log('error', 'rate_limit.unavailable', { namespace: options.namespace, error });
      return next(config.rateLimitFailClosed ? rateLimitError() : undefined);
    }
  };
}

export async function closeRateLimitStore() {
  if (redisClient?.isOpen) await redisClient.quit();
}

export const v1IpRateLimit = createInfrastructureRateLimit({
  namespace: 'v1:ip',
  windowMs: config.v1IpRateLimitWindowMs,
  max: config.v1IpRateLimitMax,
  key: (req) => req.ip || req.socket.remoteAddress || 'unknown',
});

export const v1ApiKeyRateLimit = createInfrastructureRateLimit({
  namespace: 'v1:api-key',
  windowMs: config.v1ApiKeyRateLimitWindowMs,
  max: config.v1ApiKeyRateLimitMax,
  key: (req) => req.apiKey?.id,
});

export const v1TenantRateLimit = createInfrastructureRateLimit({
  namespace: 'v1:tenant',
  windowMs: config.v1ApiKeyRateLimitWindowMs,
  max: config.v1TenantRateLimitMax,
  key: (req) => req.apiKey?.appId,
});

export const v1HighRiskActionRateLimit = createInfrastructureRateLimit({
  namespace: 'v1:high-risk-action',
  windowMs: config.actionRateLimitWindowMs,
  max: config.actionRateLimitMax,
  key: (req) => req.apiKey?.id || req.auth?.address || req.ip,
});
