import type { NextFunction, Request, Response } from 'express';

type Entry = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Entry>();

function getClientKey(req: Request) {
  return req.auth?.address || req.ip || 'unknown';
}

export function createRateLimit(options: {
  namespace: string;
  windowMs: number;
  max: number;
}) {
  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const now = Date.now();
    const key = `${options.namespace}:${getClientKey(req)}`;
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      buckets.set(key, {
        count: 1,
        resetAt: now + options.windowMs,
      });
      return next();
    }

    if (existing.count >= options.max) {
      const retryAfterSecs = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSecs));
      return res.status(429).json({
        success: false,
        error: 'Too many requests. Please slow down and try again shortly.',
      });
    }

    existing.count += 1;
    buckets.set(key, existing);
    return next();
  };
}
