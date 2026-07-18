import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { config } from '../../config';

export function findIdempotencyKey(appId: string, key: string, tx?: Prisma.TransactionClient) {
  return (tx ?? prisma).idempotencyKey.findUnique({
    where: {
      appId_key: {
        appId,
        key,
      },
    },
  });
}

export function reserveIdempotencyKey(data: {
  appId: string;
  key: string;
  requestHash: string;
}, tx: Prisma.TransactionClient) {
  return tx.idempotencyKey.create({
    data: {
      appId: data.appId,
      key: data.key,
      requestHash: data.requestHash,
      status: 'pending',
      processingExpiresAt: new Date(Date.now() + config.idempotencyProcessingLeaseMs),
      expiresAt: new Date(Date.now() + config.idempotencyRetentionMs),
    },
  });
}

export function completeIdempotencyKey(data: {
  appId: string;
  key: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
  responseBodyJson: string;
  responseBytes: number;
}, tx: Prisma.TransactionClient) {
  return tx.idempotencyKey.update({
    where: {
      appId_key: {
        appId: data.appId,
        key: data.key,
      },
    },
    data: {
      requestHash: data.requestHash,
      status: 'completed',
      responseStatus: data.responseStatus,
      responseBodyJson: data.responseBodyJson,
      responseBytes: data.responseBytes,
      expiresAt: new Date(Date.now() + config.idempotencyRetentionMs),
    },
  });
}

export function deleteExpiredIdempotencyKey(appId: string, key: string, now = new Date()) {
  return prisma.idempotencyKey.deleteMany({
    where: {
      appId,
      key,
      OR: [
        { expiresAt: { lte: now } },
        { status: 'pending', processingExpiresAt: { lte: now } },
      ],
    },
  });
}

export function cleanupExpiredIdempotencyKeys(now = new Date()) {
  return prisma.idempotencyKey.deleteMany({
    where: {
      OR: [
        { expiresAt: { lte: now } },
        { status: 'pending', processingExpiresAt: { lte: now } },
      ],
    },
  });
}

export function deletePendingIdempotencyKey(data: {
  appId: string;
  key: string;
  requestHash: string;
}) {
  return prisma.idempotencyKey.deleteMany({
    where: {
      appId: data.appId,
      key: data.key,
      requestHash: data.requestHash,
      status: 'pending',
    },
  });
}
