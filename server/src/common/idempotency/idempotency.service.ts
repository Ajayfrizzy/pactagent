import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { config } from '../../config';
import { prisma } from '../../db';
import { conflict, invalidRequest } from '../errors/app-error';
import { createRequestHash } from './request-hash';
import {
  completeIdempotencyKey,
  deletePendingIdempotencyKey,
  deleteExpiredIdempotencyKey,
  findIdempotencyKey,
  reserveIdempotencyKey,
} from './idempotency.repository';

export type IdempotencyReplay<T> = {
  replayed: true;
  statusCode: number;
  body: T;
};

export type IdempotencyContext = {
  key: string;
  requestHash: string;
};

export const idempotentTransactionOptions = {
  maxWait: config.dbTransactionMaxWaitMs,
  timeout: config.dbTransactionTimeoutMs,
};

export async function getIdempotencyReplay<T>(req: Request, appId: string): Promise<{
  context: IdempotencyContext;
  replay: IdempotencyReplay<T> | null;
}> {
  const key = req.header('Idempotency-Key')?.trim();
  if (!key) {
    throw invalidRequest('Idempotency-Key header is required for this operation.', 'idempotency_key_required');
  }

  if (key.length > 200) {
    throw invalidRequest('Idempotency-Key must be 200 characters or fewer.', 'idempotency_key_too_long');
  }

  const requestHash = createRequestHash({
    method: req.method,
    path: req.originalUrl.split('?')[0],
    body: req.body,
  });
  let existing = await findIdempotencyKey(appId, key);
  if (existing && (existing.expiresAt <= new Date() || (existing.status === 'pending' && existing.processingExpiresAt <= new Date()))) {
    await deleteExpiredIdempotencyKey(appId, key);
    existing = await findIdempotencyKey(appId, key);
  }

  if (!existing) {
    return {
      context: { key, requestHash },
      replay: null,
    };
  }

  if (existing.requestHash !== requestHash) {
    throw conflict(
      'Idempotency key was already used with a different request body.',
      'idempotency_key_conflict',
    );
  }

  if (existing.status !== 'completed' || existing.responseStatus === null || existing.responseBodyJson === null) {
    throw conflict(
      'Idempotency key is already processing. Retry the same request after the first request completes.',
      'idempotency_key_in_progress',
    );
  }

  return {
    context: { key, requestHash },
    replay: {
      replayed: true,
      statusCode: existing.responseStatus,
      body: JSON.parse(existing.responseBodyJson) as T,
    },
  };
}

export function reserveIdempotentRequest(
  appId: string,
  context: IdempotencyContext,
  tx: Prisma.TransactionClient,
) {
  return reserveIdempotencyKey({
    appId,
    key: context.key,
    requestHash: context.requestHash,
  }, tx);
}

export function storeIdempotentResponse(params: {
  appId: string;
  context: IdempotencyContext;
  statusCode: number;
  body: unknown;
}, tx: Prisma.TransactionClient) {
  const responseBodyJson = JSON.stringify(params.body);
  const responseBytes = Buffer.byteLength(responseBodyJson);
  if (responseBytes > config.idempotencyMaxResponseBytes) {
    throw invalidRequest('Idempotent response exceeds the storage limit.', 'idempotency_response_too_large');
  }
  return completeIdempotencyKey({
    appId: params.appId,
    key: params.context.key,
    requestHash: params.context.requestHash,
    responseStatus: params.statusCode,
    responseBody: params.body,
    responseBodyJson,
    responseBytes,
  }, tx);
}

export function clearPendingIdempotentRequest(appId: string, context: IdempotencyContext) {
  return deletePendingIdempotencyKey({
    appId,
    key: context.key,
    requestHash: context.requestHash,
  });
}

export function isUniqueConstraintError(error: unknown) {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: string }).code === 'P2002',
  );
}

export async function runIdempotentTransaction<T>(params: {
  req: Request;
  appId: string;
  statusCode: number;
  run: (tx: Prisma.TransactionClient, context: IdempotencyContext) => Promise<T>;
  responseBody: (result: T) => unknown;
}) {
  const { context, replay } = await getIdempotencyReplay<{ data: T; requestId: string }>(params.req, params.appId);
  if (replay) {
    return replay.body.data;
  }

  let reserved = false;
  try {
    await prisma.$transaction((tx) => reserveIdempotentRequest(params.appId, context, tx), idempotentTransactionOptions);
    reserved = true;

    return await prisma.$transaction(async (tx) => {
      const result = await params.run(tx, context);
      await storeIdempotentResponse({
        appId: params.appId,
        context,
        statusCode: params.statusCode,
        body: params.responseBody(result),
      }, tx);

      return result;
    }, idempotentTransactionOptions);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const { replay: replayAfterRace } = await getIdempotencyReplay<{ data: T; requestId: string }>(
        params.req,
        params.appId,
      );
      if (replayAfterRace) {
        return replayAfterRace.body.data;
      }
    }

    if (reserved) {
      await clearPendingIdempotentRequest(params.appId, context).catch(() => undefined);
    }

    throw error;
  }
}
