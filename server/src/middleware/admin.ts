import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { normalizeWalletAddress } from '../services/authService';

export function isAdminAddress(address: string) {
  return config.adminAddresses.includes(normalizeWalletAddress(address));
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const address = req.auth?.address;

  if (!address) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  if (!isAdminAddress(address)) {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  return next();
}
