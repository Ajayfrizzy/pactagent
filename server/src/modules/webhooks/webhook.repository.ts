import type { Event, Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { prisma } from '../../db';
import type {
  CreateWebhookEndpointInput,
  UpdateWebhookEndpointInput,
  WebhookDeliveryListQuery,
  WebhookEndpointListQuery,
} from './webhook.validation';
import { getWebhookEncryptionKeyId } from './webhook.signing';
import type { TenantContext } from '../../common/tenancy/tenant-context';

type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

function getClient(tx?: Prisma.TransactionClient | PrismaTransaction) {
  return tx ?? prisma;
}

function hashPayload(payload: string) {
  return createHash('sha256').update(payload).digest('hex');
}

function parsePayload(payloadJson: string) {
  try {
    return JSON.parse(payloadJson) as unknown;
  } catch {
    return {};
  }
}

function buildDeliveryPayload(event: Event) {
  return JSON.stringify({
    id: event.id,
    appId: event.appId,
    type: event.type,
    agreementId: event.agreementId,
    milestoneId: event.milestoneId,
    escrowId: event.escrowId,
    proofSubmissionId: event.proofSubmissionId,
    disputeId: event.disputeId,
    data: parsePayload(event.payloadJson),
    createdAt: event.createdAt.toISOString(),
  });
}

function deliveryStatusFilter(status?: string) {
  switch (status) {
    case 'delivered':
      return 'DELIVERED';
    case 'failed':
      return 'FAILED';
    case 'pending':
      return { in: ['PENDING', 'RETRY'] };
    default:
      return undefined;
  }
}

export function createWebhookEndpoint(params: {
  tenant: TenantContext;
  input: CreateWebhookEndpointInput;
  normalizedUrl: string;
  secretHash: string;
  secretCiphertext: string;
}) {
  return prisma.webhookEndpoint.create({
    data: {
      appId: params.tenant.appId,
      ownerAddress: params.tenant.appId,
      label: params.input.description ?? null,
      targetUrl: params.normalizedUrl,
      url: params.normalizedUrl,
      description: params.input.description ?? null,
      eventTypesJson: JSON.stringify(params.input.subscribedEvents),
      subscribedEvents: params.input.subscribedEvents,
      signingSecret: params.secretHash,
      secretHash: params.secretHash,
      secretCiphertext: params.secretCiphertext,
      encryptionKeyVersion: getWebhookEncryptionKeyId(params.secretCiphertext),
      status: 'active',
      isActive: true,
    },
  });
}

export function listWebhookEndpointsForApp(tenant: TenantContext, params: WebhookEndpointListQuery) {
  return prisma.webhookEndpoint.findMany({
    where: {
      appId: tenant.appId,
      deletedAt: null,
      ...(params.status ? { status: params.status } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}

export function findWebhookEndpointForApp(
  tenant: TenantContext,
  endpointId: string,
  tx?: Prisma.TransactionClient | PrismaTransaction,
) {
  return getClient(tx).webhookEndpoint.findFirst({
    where: {
      id: endpointId,
      appId: tenant.appId,
      deletedAt: null,
    },
  });
}

export function updateWebhookEndpointForApp(
  tenant: TenantContext,
  endpointId: string,
  input: UpdateWebhookEndpointInput & { normalizedUrl?: string },
) {
  const data: Prisma.WebhookEndpointUpdateInput = {};

  if (input.normalizedUrl) {
    data.url = input.normalizedUrl;
    data.targetUrl = input.normalizedUrl;
  }

  if ('description' in input) {
    data.description = input.description ?? null;
    data.label = input.description ?? null;
  }

  if (input.subscribedEvents) {
    data.subscribedEvents = input.subscribedEvents;
    data.eventTypesJson = JSON.stringify(input.subscribedEvents);
  }

  if (input.status) {
    data.status = input.status;
    data.isActive = input.status === 'active';
  }

  return prisma.webhookEndpoint.update({
    where: { id_appId: { id: endpointId, appId: tenant.appId } },
    data,
  });
}

export function deleteWebhookEndpointForApp(tenant: TenantContext, endpointId: string) {
  return prisma.webhookEndpoint.update({
    where: { id_appId: { id: endpointId, appId: tenant.appId } },
    data: {
      status: 'disabled',
      isActive: false,
      deletedAt: new Date(),
    },
  });
}

export async function createWebhookDeliveriesForEvent(
  event: Event,
  tx?: Prisma.TransactionClient | PrismaTransaction,
) {
  const client = getClient(tx);
  const endpoints = await client.webhookEndpoint.findMany({
    where: {
      appId: event.appId,
      status: 'active',
      isActive: true,
      deletedAt: null,
      subscribedEvents: { has: event.type },
    },
  });

  const payloadJson = buildDeliveryPayload(event);
  const payloadHash = hashPayload(payloadJson);
  const deliveries = [];

  for (const endpoint of endpoints) {
    deliveries.push(await client.webhookDelivery.create({
      data: {
        appId: event.appId,
        endpointId: endpoint.id,
        eventId: event.id,
        agreementId: event.agreementId,
        eventType: event.type,
        payloadJson,
        payloadHash,
        status: 'PENDING',
        attempts: 0,
      },
    }));

    await client.agentJob.create({
      data: {
        agreementId: event.agreementId,
        kind: 'DELIVER_WEBHOOK',
        status: 'QUEUED',
        dedupeKey: `INFRA_WEBHOOK_DELIVERY:${deliveries[deliveries.length - 1].id}:0`,
        payloadJson: JSON.stringify({
          agreementId: event.agreementId ?? undefined,
          deliveryId: deliveries[deliveries.length - 1].id,
        }),
        maxAttempts: 1,
      },
    });
  }

  return deliveries;
}

export function listWebhookDeliveriesForApp(tenant: TenantContext, params: WebhookDeliveryListQuery) {
  return prisma.webhookDelivery.findMany({
    where: {
      appId: tenant.appId,
      ...(params.endpointId ? { endpointId: params.endpointId } : {}),
      ...(params.eventId ? { eventId: params.eventId } : {}),
      ...(params.status ? { status: deliveryStatusFilter(params.status) } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}

export function findWebhookDeliveryForApp(tenant: TenantContext, deliveryId: string) {
  return prisma.webhookDelivery.findFirst({
    where: {
      id: deliveryId,
      appId: tenant.appId,
    },
  });
}

export function findWebhookDeliveryWithEndpoint(deliveryId: string) {
  return prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: {
      endpoint: {
        include: {
          app: true,
        },
      },
    },
  });
}

export async function markWebhookDeliveryForRetry(
  tenant: TenantContext,
  deliveryId: string,
  client: Pick<typeof prisma, 'webhookDelivery'> = prisma,
) {
  const reserved = await client.webhookDelivery.updateMany({
    where: {
      id: deliveryId,
      appId: tenant.appId,
      status: { in: ['FAILED', 'RETRY'] },
    },
    data: {
      status: 'PENDING',
      nextRetryAt: new Date(),
      lastError: null,
    },
  });
  if (reserved.count !== 1) return null;
  return client.webhookDelivery.findUnique({ where: { id_appId: { id: deliveryId, appId: tenant.appId } } });
}

export function listDueWebhookDeliveries(limit: number) {
  return prisma.webhookDelivery.findMany({
    where: {
      appId: { not: null },
      status: { in: ['PENDING', 'RETRY'] },
      OR: [
        { nextRetryAt: null },
        { nextRetryAt: { lte: new Date() } },
      ],
    },
    orderBy: [
      { nextRetryAt: 'asc' },
      { createdAt: 'asc' },
    ],
    take: limit,
  });
}

export function updateWebhookDeliveryResult(deliveryId: string, data: {
  status: 'PENDING' | 'DELIVERED' | 'FAILED' | 'RETRY';
  statusCode?: number | null;
  responseBodySnippet?: string | null;
  lastError?: string | null;
  nextRetryAt?: Date | null;
  deliveredAt?: Date | null;
}) {
  return prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: data.status,
      statusCode: data.statusCode ?? null,
      responseBodySnippet: data.responseBodySnippet ?? null,
      lastError: data.lastError ?? null,
      nextRetryAt: data.nextRetryAt ?? null,
      deliveredAt: data.deliveredAt ?? null,
      attempts: { increment: 1 },
    },
  });
}
