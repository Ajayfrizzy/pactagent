import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';

export function validateBody<T>(schema: ZodSchema<T>) {
  return function validateRequestBody(req: Request, _res: Response, next: NextFunction) {
    req.body = schema.parse(req.body);
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return function validateRequestQuery(req: Request, _res: Response, next: NextFunction) {
    req.query = schema.parse(req.query) as Request['query'];
    next();
  };
}
