import type { NextFunction, Request, Response } from 'express';
import { log } from './logger';
import { context, trace } from '@opentelemetry/api';

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startedAt = process.hrtime.bigint();
  const spanContext = trace.getSpan(context.active())?.spanContext();
  res.once('finish', () => log('info', 'http.request.completed', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    statusCode: res.statusCode,
    durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
    appId: req.tenant?.appId,
    apiKeyId: req.apiKey?.id,
    traceId: spanContext?.traceId,
    spanId: spanContext?.spanId,
  }));
  next();
}
