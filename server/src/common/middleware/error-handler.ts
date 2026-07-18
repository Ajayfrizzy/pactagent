import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError, invalidRequest } from '../errors/app-error';
import { redactSensitive } from '../security/redact';

function normalizeError(error: unknown) {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof ZodError) {
    return invalidRequest('Request validation failed.', 'validation_failed', error.flatten());
  }

  return new AppError({
    statusCode: 500,
    type: 'internal_error',
    code: 'internal_error',
    message: 'An internal error occurred.',
  });
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  const normalized = normalizeError(error);

  if (normalized.statusCode >= 500) {
    console.error('[ERROR]', {
      requestId: req.requestId,
      path: req.path,
      method: req.method,
      error: redactSensitive(error),
    });
  }

  return res.status(normalized.statusCode).json({
    error: {
      type: normalized.type,
      code: normalized.code,
      message: normalized.message,
      requestId: req.requestId,
    },
  });
}
