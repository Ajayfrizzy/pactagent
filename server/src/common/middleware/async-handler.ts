import type { NextFunction, Request, Response } from 'express';

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return function wrappedAsyncHandler(req: Request, res: Response, next: NextFunction) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
