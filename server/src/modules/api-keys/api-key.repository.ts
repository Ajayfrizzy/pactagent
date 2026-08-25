import { prisma } from '../../db';

export function createApiKey(data: {
  appId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  environment: string;
  scopes: string[];
}) {
  return prisma.apiKey.create({
    data,
  });
}

export function listApiKeysForOwner(ownerId: string, params: {
  appId?: string;
  limit: number;
  cursor?: string;
}) {
  return prisma.apiKey.findMany({
    where: {
      ...(params.appId ? { appId: params.appId } : {}),
      app: {
        ownerId,
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}

export function findApiKeyForOwner(ownerId: string, apiKeyId: string) {
  return prisma.apiKey.findFirst({
    where: {
      id: apiKeyId,
      app: {
        ownerId,
      },
    },
  });
}

export function findActiveApiKeyByHash(keyHash: string) {
  return prisma.apiKey.findFirst({
    where: {
      keyHash,
      status: 'active',
      app: {
        status: 'active',
      },
    },
    include: {
      app: true,
    },
  });
}

export function revokeApiKeyForOwner(ownerId: string, apiKeyId: string) {
  return prisma.apiKey.updateMany({
    where: {
      id: apiKeyId,
      app: {
        ownerId,
      },
      status: 'active',
    },
    data: {
      status: 'revoked',
      revokedAt: new Date(),
    },
  });
}

export function updateApiKeyLastUsedAt(apiKeyId: string) {
  return prisma.apiKey.update({
    where: { id: apiKeyId },
    data: { lastUsedAt: new Date() },
  });
}
