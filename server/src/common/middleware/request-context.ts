import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

export function createRequestId() {
  return `req_${randomUUID().replace(/-/g, '')}`;
}

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incomingRequestId = req.header('X-Request-Id');
  const requestId = incomingRequestId?.trim() || createRequestId();

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  next();
}
