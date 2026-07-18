import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { conflict, notFound } from '../../common/errors/app-error';
import { createAuditLogForRequest } from '../audit-logs/audit-log.service';
import { serializeApp } from './app.model';
import * as appRepository from './app.repository';
import type { AppListQuery, CreateAppInput, UpdateAppInput } from './app.validation';

export async function createAppForOwner(req: Request, ownerUserId: string, input: CreateAppInput) {
  try {
    const app = await appRepository.createApp(ownerUserId, input);
    await createAuditLogForRequest(req, {
      appId: app.id,
      actorType: 'user',
      actorAddress: ownerUserId,
      action: 'app.created',
      targetType: 'app',
      targetId: app.id,
      after: serializeApp(app),
    });

    return serializeApp(app);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw conflict('An app with this slug already exists for this owner.', 'app_slug_conflict');
    }

    throw error;
  }
}

export async function listAppsForOwner(ownerUserId: string, query: AppListQuery) {
  const apps = await appRepository.listAppsForOwner(ownerUserId, query);
  const hasMore = apps.length > query.limit;
  const data = apps.slice(0, query.limit);

  return {
    data: data.map(serializeApp),
    pagination: {
      limit: query.limit,
      cursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    },
  };
}

export async function getAppForOwner(ownerUserId: string, appId: string) {
  const app = await appRepository.findAppForOwner(ownerUserId, appId);
  if (!app) {
    throw notFound('App not found.', 'app_not_found');
  }

  return serializeApp(app);
}

export async function updateAppForOwner(
  req: Request,
  ownerUserId: string,
  appId: string,
  input: UpdateAppInput,
) {
  const before = await appRepository.findAppForOwner(ownerUserId, appId);
  if (!before) {
    throw notFound('App not found.', 'app_not_found');
  }

  await appRepository.updateAppForOwner(ownerUserId, appId, input);
  const after = await appRepository.findAppForOwner(ownerUserId, appId);
  if (!after) {
    throw notFound('App not found.', 'app_not_found');
  }

  await createAuditLogForRequest(req, {
    appId,
    actorType: 'user',
    actorAddress: ownerUserId,
    action: input.status === 'disabled' ? 'app.disabled' : 'app.updated',
    targetType: 'app',
    targetId: appId,
    before: serializeApp(before),
    after: serializeApp(after),
  });

  return serializeApp(after);
}

export async function disableAppForOwner(req: Request, ownerUserId: string, appId: string) {
  const before = await appRepository.findAppForOwner(ownerUserId, appId);
  if (!before) {
    throw notFound('App not found.', 'app_not_found');
  }

  await appRepository.disableAppForOwner(ownerUserId, appId);
  const after = await appRepository.findAppForOwner(ownerUserId, appId);
  if (!after) {
    throw notFound('App not found.', 'app_not_found');
  }

  await createAuditLogForRequest(req, {
    appId,
    actorType: 'user',
    actorAddress: ownerUserId,
    action: 'app.disabled',
    targetType: 'app',
    targetId: appId,
    before: serializeApp(before),
    after: serializeApp(after),
  });

  return serializeApp(after);
}

export function getCurrentApiKeyApp(req: Request) {
  if (!req.currentApp) {
    throw notFound('App not found.', 'app_not_found');
  }

  return serializeApp(req.currentApp);
}
