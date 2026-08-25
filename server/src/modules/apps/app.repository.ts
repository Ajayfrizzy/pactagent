import { prisma } from '../../db';
import type { CreateAppInput, UpdateAppInput } from './app.validation';

export function createApp(ownerId: string, input: CreateAppInput) {
  return prisma.app.create({
    data: {
      ownerId,
      name: input.name,
      slug: input.slug,
      environment: input.environment,
      defaultCurrency: input.defaultCurrency,
      defaultNetwork: input.defaultNetwork,
    },
  });
}

export function listAppsForOwner(ownerId: string, params: { limit: number; cursor?: string }) {
  return prisma.app.findMany({
    where: { ownerId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}

export function findAppForOwner(ownerId: string, appId: string) {
  return prisma.app.findFirst({
    where: {
      id: appId,
      ownerId,
    },
  });
}

export function findAppById(appId: string) {
  return prisma.app.findUnique({
    where: { id: appId },
  });
}

export function updateAppForOwner(ownerId: string, appId: string, input: UpdateAppInput) {
  return prisma.app.updateMany({
    where: {
      id: appId,
      ownerId,
    },
    data: input,
  });
}

export function disableAppForOwner(ownerId: string, appId: string) {
  return prisma.app.updateMany({
    where: {
      id: appId,
      ownerId,
    },
    data: {
      status: 'disabled',
    },
  });
}
