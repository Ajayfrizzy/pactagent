import { prisma } from '../../db';
import type { CreateAppInput, UpdateAppInput } from './app.validation';

export function createApp(ownerUserId: string, input: CreateAppInput) {
  return prisma.app.create({
    data: {
      ownerUserId,
      name: input.name,
      slug: input.slug,
      environment: input.environment,
      defaultCurrency: input.defaultCurrency,
      defaultNetwork: input.defaultNetwork,
    },
  });
}

export function listAppsForOwner(ownerUserId: string, params: { limit: number; cursor?: string }) {
  return prisma.app.findMany({
    where: { ownerUserId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}

export function findAppForOwner(ownerUserId: string, appId: string) {
  return prisma.app.findFirst({
    where: {
      id: appId,
      ownerUserId,
    },
  });
}

export function findAppById(appId: string) {
  return prisma.app.findUnique({
    where: { id: appId },
  });
}

export function updateAppForOwner(ownerUserId: string, appId: string, input: UpdateAppInput) {
  return prisma.app.updateMany({
    where: {
      id: appId,
      ownerUserId,
    },
    data: input,
  });
}

export function disableAppForOwner(ownerUserId: string, appId: string) {
  return prisma.app.updateMany({
    where: {
      id: appId,
      ownerUserId,
    },
    data: {
      status: 'disabled',
    },
  });
}
