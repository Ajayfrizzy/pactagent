import type { NextFunction, Request, Response } from 'express';
import { permissionError } from '../../common/errors/app-error';
import type { ApiKeyScope } from './scopes';

export function requireScope(scope: ApiKeyScope) {
  return function enforceScope(req: Request, _res: Response, next: NextFunction) {
    if (!req.apiKey?.scopes.includes(scope)) {
      throw permissionError(`Missing required scope: ${scope}`, 'missing_scope');
    }

    next();
  };
}

export function requireAnyScope(scopes: ApiKeyScope[]) {
  return function enforceAnyScope(req: Request, _res: Response, next: NextFunction) {
    const grantedScopes = req.apiKey?.scopes ?? [];
    if (!scopes.some((scope) => grantedScopes.includes(scope))) {
      throw permissionError(`Missing one of required scopes: ${scopes.join(', ')}`, 'missing_scope');
    }

    next();
  };
}
