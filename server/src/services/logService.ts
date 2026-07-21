import { prisma } from '../db';
import { broadcast } from '../ws';
import { randomUUID as uuid } from 'crypto';
import { normalizeWalletAddress } from './authService';
import { enqueueWebhookEventsForLog } from './webhookService';
import { log as runtimeLog } from '../common/observability/logger';

/**
 * Agent Log Service
 * Creates structured logs and broadcasts them to all connected WS clients.
 * This is the core observability layer - every agent action is logged here.
 */
export async function createLog(params: {
  agreementId?: string;
  level: string;
  eventType: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  const log = await prisma.agentLog.create({
    data: {
      id: uuid(),
      agreementId: params.agreementId || null,
      level: params.level,
      eventType: params.eventType,
      message: params.message,
      metadataJson: params.metadata ? JSON.stringify(params.metadata) : null,
    },
  });

  broadcast({
    type: 'LOG',
    payload: {
      ...log,
      createdAt: log.createdAt.toISOString(),
    },
  });

  runtimeLog(params.level === 'ERROR' ? 'error' : params.level === 'WARN' ? 'warn' : 'info', 'agent.lifecycle', {
    appId: params.metadata?.appId,
    agreementId: params.agreementId,
    milestoneId: params.metadata?.milestoneId,
    transactionId: params.metadata?.transactionId,
    settlementId: params.metadata?.settlementId,
    deliveryId: params.metadata?.deliveryId,
    eventType: params.eventType,
    message: params.message,
  });

  void enqueueWebhookEventsForLog(log).catch((error) => {
    runtimeLog('error', 'webhook.enqueue_from_log.failed', { agreementId: params.agreementId, eventType: params.eventType, error });
  });

  return log;
}

export async function getLogs(agreementId?: string, limit = 100) {
  limit = Math.min(Math.max(limit, 1), 100);
  return prisma.agentLog.findMany({
    where: agreementId ? { agreementId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function getLogsForParticipant(address: string, agreementId?: string, limit = 100) {
  limit = Math.min(Math.max(limit, 1), 100);
  const normalizedAddress = normalizeWalletAddress(address);
  return prisma.agentLog.findMany({
    where: {
      agreementId: agreementId ? agreementId : { not: null },
      agreement: {
        OR: [
          { clientAddress: normalizedAddress },
          { workerAddress: normalizedAddress },
        ],
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function getPublicLogs(limit = 25) {
  limit = Math.min(Math.max(limit, 1), 100);
  const logs = await prisma.agentLog.findMany({
    where: {
      agreementId: { not: null },
      level: { in: ['INFO', 'SUCCESS', 'WARN'] },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return logs.map((log) => ({
    ...log,
    metadataJson: null,
  }));
}

export async function getPublicLogsForParticipantAddress(address: string, limit = 25) {
  limit = Math.min(Math.max(limit, 1), 100);
  const normalizedAddress = normalizeWalletAddress(address);
  const logs = await prisma.agentLog.findMany({
    where: {
      agreementId: { not: null },
      level: { in: ['INFO', 'SUCCESS', 'WARN'] },
      agreement: {
        OR: [
          { clientAddress: normalizedAddress },
          { workerAddress: normalizedAddress },
        ],
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return logs.map((log) => ({
    ...log,
    metadataJson: null,
  }));
}
