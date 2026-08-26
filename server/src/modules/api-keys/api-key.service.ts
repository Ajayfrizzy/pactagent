import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { createRawApiKey, getApiKeyPrefix, hashApiKey } from '../../common/crypto/api-keys';
import { conflict, notFound } from '../../common/errors/app-error';
import { createAuditLogForRequest } from '../audit-logs/audit-log.service';
import { findAppForOwner } from '../apps/app.repository';
import { serializeApiKey, serializeCreatedApiKey } from './api-key.model';
import * as apiKeyRepository from './api-key.repository';
import type { ApiKeyListQuery, CreateApiKeyInput } from './api-key.validation';

export async function createApiKeyForOwner(req: Request, ownerId: string, input: CreateApiKeyInput) {
  const app = await findAppForOwner(ownerId, input.appId);
  if (!app) {
    throw notFound('App not found.', 'app_not_found');
  }

  const rawKey = createRawApiKey(app.environment === 'production' ? 'production' : 'sandbox');
  const keyPrefix = getApiKeyPrefix(rawKey);
  const keyHash = hashApiKey(rawKey);

  try {
    const apiKey = await apiKeyRepository.createApiKey({
      appId: app.id,
      name: input.name,
      keyPrefix,
      keyHash,
      environment: app.environment,
      scopes: input.scopes,
    });

    await createAuditLogForRequest(req, {
      appId: app.id,
      actorType: 'user',
      actorAddress: ownerId,
      action: 'api_key.created',
      targetType: 'api_key',
      targetId: apiKey.id,
      after: serializeApiKey(apiKey),
    });

    return serializeCreatedApiKey(apiKey, rawKey);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw conflict('Generated API key collided. Please retry.', 'api_key_conflict');
    }

    throw error;
  }
}

export async function listApiKeysForOwner(ownerId: string, query: ApiKeyListQuery) {
  if (query.appId) {
    const app = await findAppForOwner(ownerId, query.appId);
    if (!app) {
      throw notFound('App not found.', 'app_not_found');
    }
  }

  const apiKeys = await apiKeyRepository.listApiKeysForOwner(ownerId, query);
  const hasMore = apiKeys.length > query.limit;
  const data = apiKeys.slice(0, query.limit);

  return {
    data: data.map(serializeApiKey),
    pagination: {
      limit: query.limit,
      cursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    },
  };
}

export async function revokeApiKeyForOwner(req: Request, ownerId: string, apiKeyId: string) {
  const before = await apiKeyRepository.findApiKeyForOwner(ownerId, apiKeyId);
  if (!before) {
    throw notFound('API key not found.', 'api_key_not_found');
  }

  await apiKeyRepository.revokeApiKeyForOwner(ownerId, apiKeyId);
  const after = await apiKeyRepository.findApiKeyForOwner(ownerId, apiKeyId);
  if (!after) {
    throw notFound('API key not found.', 'api_key_not_found');
  }

  await createAuditLogForRequest(req, {
    appId: after.appId,
    actorType: 'user',
    actorAddress: ownerId,
    action: 'api_key.revoked',
    targetType: 'api_key',
    targetId: apiKeyId,
    before: serializeApiKey(before),
    after: serializeApiKey(after),
  });

  return serializeApiKey(after);
}

export async function authenticateApiKey(rawKey: string) {
  const keyHash = hashApiKey(rawKey);
  const apiKey = await apiKeyRepository.findActiveApiKeyByHash(keyHash);
  if (!apiKey) {
    return null;
  }

  await apiKeyRepository.updateApiKeyLastUsedAt(apiKey.id);

  return apiKey;
}
