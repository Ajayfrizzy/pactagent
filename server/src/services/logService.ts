import { prisma } from '../db';
import { broadcast } from '../ws';
import { v4 as uuid } from 'uuid';

/**
 * Agent Log Service
 * Creates structured logs and broadcasts them to all connected WS clients.
 * This is the core observability layer — every agent action is logged here.
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

  // Broadcast to all connected WS clients for live Agent Log Panel
  broadcast({
    type: 'LOG',
    payload: {
      ...log,
      createdAt: log.createdAt.toISOString(),
    },
  });

  console.log(`[AGENT][${params.level}] ${params.eventType}: ${params.message}`);
  return log;
}

/**
 * Fetch logs, optionally filtered by agreementId.
 */
export async function getLogs(agreementId?: string, limit = 100) {
  return prisma.agentLog.findMany({
    where: agreementId ? { agreementId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
