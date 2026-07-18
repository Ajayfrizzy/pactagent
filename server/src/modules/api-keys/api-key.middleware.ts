import type { NextFunction, Request, Response } from 'express';
import { authenticationError } from '../../common/errors/app-error';
import { v1ApiKeyRateLimit } from '../../common/rate-limit/infrastructure-rate-limit';
import { authenticateApiKey } from './api-key.service';

function extractApiKey(req: Request) {
  const xApiKey = req.header('x-api-key')?.trim();
  if (xApiKey) {
    return xApiKey;
  }

  const authorization = req.header('authorization');
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim();
    if (token.startsWith('pa_test_') || token.startsWith('pa_live_')) {
      return token;
    }
  }

  return null;
}

export async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  try {
    const rawKey = extractApiKey(req);
    if (!rawKey) {
      throw authenticationError('API key required.');
    }

    const apiKey = await authenticateApiKey(rawKey);
    if (!apiKey) {
      throw authenticationError('Invalid API key.');
    }

    req.apiKey = {
      id: apiKey.id,
      appId: apiKey.appId,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      environment: apiKey.environment,
      scopes: apiKey.scopes,
    };
    req.currentApp = apiKey.app;

    v1ApiKeyRateLimit(req, res, next);
  } catch (error) {
    next(error);
  }
}
