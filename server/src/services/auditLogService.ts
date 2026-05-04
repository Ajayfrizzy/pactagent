import { v4 as uuid } from 'uuid';
import { prisma } from '../db';
import { enqueueWebhookEventsForAuditLog } from './webhookService';

export async function createAuditLog(params: {
  agreementId?: string | null;
  actorAddress?: string | null;
  actorType?: 'USER' | 'SYSTEM';
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
}) {
  const log = await prisma.auditLog.create({
    data: {
      id: uuid(),
      agreementId: params.agreementId ?? null,
      actorAddress: params.actorAddress ?? null,
      actorType: params.actorType ?? 'USER',
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      metadataJson: params.metadata ? JSON.stringify(params.metadata) : null,
    },
  });

  void enqueueWebhookEventsForAuditLog(log).catch((error) => {
    console.error('[WEBHOOK] Failed to enqueue events from audit log:', error);
  });

  return log;
}

export async function getAuditLogsForAgreement(agreementId: string, limit = 100) {
  return prisma.auditLog.findMany({
    where: { agreementId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
