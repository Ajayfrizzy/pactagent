import type { Request, Response } from 'express';
import { authenticationError } from '../../common/errors/app-error';
import { sendList, sendSuccess } from '../../common/middleware/response';
import * as apiKeyService from './api-key.service';

function requireOwner(req: Request) {
  if (!req.auth?.address) {
    throw authenticationError();
  }

  return req.auth.address;
}

export async function createApiKey(req: Request, res: Response) {
  const apiKey = await apiKeyService.createApiKeyForOwner(req, requireOwner(req), req.body);
  return sendSuccess(res, apiKey, 201);
}

export async function listApiKeys(req: Request, res: Response) {
  const result = await apiKeyService.listApiKeysForOwner(requireOwner(req), req.query as any);
  return sendList(res, result.data, result.pagination);
}

export async function revokeApiKey(req: Request, res: Response) {
  const apiKey = await apiKeyService.revokeApiKeyForOwner(req, requireOwner(req), req.params.id);
  return sendSuccess(res, apiKey);
}
