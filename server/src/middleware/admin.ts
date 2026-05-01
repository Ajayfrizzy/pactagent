import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';

function normalizeAddress(address: string) {
  return address.trim().toLowerCase();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const address = req.auth?.address;

  if (!address) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  if (!config.adminAddresses.includes(normalizeAddress(address))) {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  return next();
}
