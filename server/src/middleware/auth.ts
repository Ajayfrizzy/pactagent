import { NextFunction, Request, Response } from 'express';
import { authenticationError } from '../common/errors/app-error';
import { verifyAuthToken } from '../services/authService';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

  if (!token) {
    return next(authenticationError());
  }

  try {
    req.auth = verifyAuthToken(token);
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid authentication token';
    return next(authenticationError(message));
  }
}
