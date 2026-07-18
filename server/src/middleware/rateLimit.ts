import type { Request } from 'express';
import { createInfrastructureRateLimit } from '../common/rate-limit/infrastructure-rate-limit';

function getClientKey(req: Request) {
  return req.auth?.address || req.ip || req.socket.remoteAddress || 'unknown';
}

export function createRateLimit(options: {
  namespace: string;
  windowMs: number;
  max: number;
}) {
  return createInfrastructureRateLimit({
    ...options,
    key: getClientKey,
  });
}
