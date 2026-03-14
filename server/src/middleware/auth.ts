import { NextFunction, Request, Response } from 'express';
import { verifyAuthToken } from '../services/authService';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  try {
    req.auth = verifyAuthToken(token);
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid authentication token';
    return res.status(401).json({ success: false, error: message });
  }
}
