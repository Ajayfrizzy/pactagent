import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../db';
import { createWebhookDeliveriesForEvent } from '../webhooks/webhook.repository';
import type { TenantContext } from '../../common/tenancy/tenant-context';

type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

function getClient(tx?: Prisma.TransactionClient | PrismaTransaction) {
  return tx ?? prisma;
}

export async function createEvent(tenant: TenantContext, data: {
  type: string;
  agreementId?: string | null;
  milestoneId?: string | null;
  escrowId?: string | null;
  proofSubmissionId?: string | null;
  disputeId?: string | null;
  payload: unknown;
}, tx?: Prisma.TransactionClient | PrismaTransaction) {
  const event = await getClient(tx).event.create({
    data: {
      appId: tenant.appId,
      type: data.type,
      agreementId: data.agreementId ?? null,
      milestoneId: data.milestoneId ?? null,
      escrowId: data.escrowId ?? null,
      proofSubmissionId: data.proofSubmissionId ?? null,
      disputeId: data.disputeId ?? null,
      payloadJson: JSON.stringify(data.payload),
    },
  });

  await createWebhookDeliveriesForEvent(event, tx);

  return event;
}

export function listEventsForApp(tenant: TenantContext, params: {
  type?: string;
  agreementId?: string;
  limit: number;
  cursor?: string;
}) {
  return prisma.event.findMany({
    where: {
      appId: tenant.appId,
      ...(params.type ? { type: params.type } : {}),
      ...(params.agreementId ? { agreementId: params.agreementId } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}

export function findEventForApp(tenant: TenantContext, eventId: string) {
  return prisma.event.findFirst({
    where: {
      id: eventId,
      appId: tenant.appId,
    },
  });
}
