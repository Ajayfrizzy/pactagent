import type { NextFunction, Request, Response } from 'express';
import { authenticationError, permissionError } from '../../common/errors/app-error';

export function requireInfrastructureAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth?.address) {
    throw authenticationError();
  }

  if (!req.auth.isAdmin) {
    throw permissionError('Admin access required.', 'admin_required');
  }

  next();
}
