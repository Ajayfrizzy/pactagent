import { createHash, createHmac, randomBytes, randomUUID } from 'crypto';
import { config } from '../config';
import { prisma } from '../db';
import { normalizeWalletAddress } from './authService';
import { queueCkboostLifecycleEvent } from './ckboostIntegrationService';
import { createLog } from './logService';
import { enqueueJob } from './jobQueueService';

type WebhookEventType =
  | 'agreement.created'
  | 'agreement.funded'
  | 'agreement.completed'
  | 'agreement.refunded'
  | 'agreement.expired'
  | 'agreement.proof_submitted'
  | 'review.action_taken'
  | 'dispute.opened'
  | 'dispute.updated'
  | 'settlement.pending'
  | 'settlement.confirmed'
  | 'settlement.failed'
  | 'source.sync_changed';

type EventSource =
  | { kind: 'log'; eventType: string; message: string; metadataJson: string | null; createdAt: Date }
  | { kind: 'audit'; action: string; metadataJson: string | null; createdAt: Date; actorAddress: string | null };

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function createSigningSecret() {
  return randomBytes(24).toString('hex');
}

function buildPayloadHash(payloadJson: string) {
  return createHash('sha256').update(payloadJson).digest('hex');
}

function buildSignature(secret: string, payloadJson: string) {
  return createHmac('sha256', secret).update(payloadJson).digest('hex');
}

function getRetryDelayMs(attempts: number) {
  return Math.min(60_000, Math.max(5_000, attempts * 5_000));
}

function serializeEndpoint(endpoint: {
  id: string;
  ownerAddress: string;
  label: string | null;
  targetUrl: string;
  eventTypesJson: string;
  signingSecret: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deliveries?: Array<any>;
}) {
  return {
    id: endpoint.id,
    ownerAddress: endpoint.ownerAddress,
    label: endpoint.label,
    targetUrl: endpoint.targetUrl,
    eventTypes: parseJson<string[]>(endpoint.eventTypesJson, []),
    signingSecret: endpoint.signingSecret,
    isActive: endpoint.isActive,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
    deliveries: endpoint.deliveries?.map(serializeDelivery) || [],
  };
}

function serializeDelivery(delivery: {
  id: string;
  endpointId: string;
  agreementId: string | null;
  eventType: string;
  payloadJson: string;
  payloadHash: string;
  status: string;
  statusCode: number | null;
  attempts: number;
  lastError: string | null;
  nextRetryAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...delivery,
    payload: parseJson<Record<string, unknown>>(delivery.payloadJson, {}),
    nextRetryAt: delivery.nextRetryAt?.toISOString() ?? null,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    createdAt: delivery.createdAt.toISOString(),
    updatedAt: delivery.updatedAt.toISOString(),
  };
}

function mapLogToWebhookEvents(log: {
  eventType: string;
  message: string;
}, agreement: {
  status: string;
  settlementStatus: string;
}) {
  if (log.eventType === 'FUNDING_CONFIRMED') {
    return ['agreement.funded'] as WebhookEventType[];
  }

  if (['RELEASE_PREPARED', 'RELEASE_SENT', 'REFUND_SENT'].includes(log.eventType)) {
    return ['settlement.pending'] as WebhookEventType[];
  }

  if (log.eventType === 'SETTLEMENT_CONFIRMED') {
    const events: WebhookEventType[] = ['settlement.confirmed'];
    if (agreement.status === 'PAID') {
      events.push('agreement.completed');
    }
    if (agreement.status === 'REFUNDED') {
      events.push('agreement.refunded');
    }
    return events;
  }

  if (log.eventType === 'ERROR' && agreement.settlementStatus === 'FAILED') {
    return ['settlement.failed'] as WebhookEventType[];
  }

  if (
    log.eventType === 'RULE_CHECK_PASSED'
    && agreement.status === 'EXPIRED'
    && log.message.toLowerCase().includes('expired')
  ) {
    return ['agreement.expired'] as WebhookEventType[];
  }

  return [];
}

function mapAuditToWebhookEvents(audit: {
  action: string;
}) {
  switch (audit.action) {
    case 'AGREEMENT_CREATED':
      return ['agreement.created'] as WebhookEventType[];
    case 'PROOF_SUBMITTED':
      return ['agreement.proof_submitted'] as WebhookEventType[];
    case 'DISPUTE_OPENED':
      return ['dispute.opened'] as WebhookEventType[];
    case 'DISPUTE_EVIDENCE_ADDED':
      return ['dispute.updated'] as WebhookEventType[];
    case 'MILESTONE_APPROVED':
      return ['review.action_taken'] as WebhookEventType[];
    case 'SOURCE_SYNC_COMPLETED':
    case 'SOURCE_SYNC_FAILED':
    case 'SOURCE_SYNC_DRAFTED':
    case 'SOURCE_SYNC_REVIEWED':
    case 'SOURCE_SYNC_PUBLISHED':
      return ['source.sync_changed'] as WebhookEventType[];
    default:
      return [];
  }
}

async function maybeNotifyCkboost(params: {
  agreementId: string;
  source: EventSource;
}) {
  if (params.source.kind === 'audit') {
    if (params.source.action === 'PROOF_SUBMITTED') {
      await queueCkboostLifecycleEvent({
        agreementId: params.agreementId,
        internalEventType: 'proof_submitted',
        occurredAt: params.source.createdAt.toISOString(),
        metadata: parseJson<Record<string, unknown>>(params.source.metadataJson, {}),
      });
      return;
    }

    if (params.source.action === 'MILESTONE_APPROVED') {
      await queueCkboostLifecycleEvent({
        agreementId: params.agreementId,
        internalEventType: 'milestone_approved',
        occurredAt: params.source.createdAt.toISOString(),
        metadata: parseJson<Record<string, unknown>>(params.source.metadataJson, {}),
      });
      return;
    }
  }

  if (params.source.kind === 'log' && params.source.eventType === 'SETTLEMENT_CONFIRMED') {
    const metadata = parseJson<Record<string, unknown>>(params.source.metadataJson, {});
    const direction = typeof metadata.direction === 'string' ? metadata.direction.toUpperCase() : '';
    if (direction === 'PAYOUT') {
      await queueCkboostLifecycleEvent({
        agreementId: params.agreementId,
        internalEventType: 'milestone_paid',
        occurredAt: params.source.createdAt.toISOString(),
        metadata,
      });
    }
  }
}

async function queueWebhookEventsForAgreement(params: {
  agreementId: string;
  source: EventSource;
}) {
  const agreement = await prisma.agreement.findUnique({
    where: { id: params.agreementId },
    include: {
      source: true,
    },
  });

  if (!agreement) {
    return;
  }

  const events =
    params.source.kind === 'log'
      ? mapLogToWebhookEvents(params.source, agreement)
      : mapAuditToWebhookEvents(params.source);

  if (!events.length) {
    return;
  }

  await maybeNotifyCkboost(params).catch(async (error) => {
    const message = error instanceof Error ? error.message : 'Unknown CKBoost delivery error';
    console.error('[CKBOOST] Failed to notify CKBoost:', error);
    await createLog({
      agreementId: params.agreementId,
      level: 'ERROR',
      eventType: 'ERROR',
      message: `CKBoost lifecycle notification failed: ${message}`,
      metadata: {
        sourceKind: params.source.kind,
        sourceAction: params.source.kind === 'audit' ? params.source.action : params.source.eventType,
      },
    }).catch(() => {});
  });

  const endpoints = await prisma.webhookEndpoint.findMany({
    where: {
      isActive: true,
      ownerAddress: {
        in: [agreement.clientAddress, agreement.workerAddress],
      },
    },
  });

  if (!endpoints.length) {
    return;
  }

  for (const event of events) {
    const matchingEndpoints = endpoints.filter((endpoint) =>
      parseJson<string[]>(endpoint.eventTypesJson, []).includes(event),
    );

    if (!matchingEndpoints.length) {
      continue;
    }

    const payload = JSON.stringify({
      eventId: randomUUID(),
      eventType: event,
      occurredAt: params.source.createdAt.toISOString(),
      agreement: {
        id: agreement.id,
        title: agreement.title,
        status: agreement.status,
        settlementStatus: agreement.settlementStatus,
        clientAddress: agreement.clientAddress,
        workerAddress: agreement.workerAddress,
        payoutNetwork: agreement.payoutNetwork,
        escrowModel: agreement.escrowModel,
        source: agreement.source
          ? {
              sourceType: agreement.source.sourceType,
              sourceLabel: agreement.source.sourceLabel,
              externalUrl: agreement.source.externalUrl,
              forumThreadUrl: agreement.source.forumThreadUrl,
              sponsorName: agreement.source.sponsorName,
              syncStatus: agreement.source.syncStatus,
              lastSyncedAt: agreement.source.lastSyncedAt?.toISOString() ?? null,
              latestSummary: agreement.source.latestSummary,
            }
          : null,
      },
      source:
        params.source.kind === 'log'
          ? {
              kind: 'log',
              eventType: params.source.eventType,
              message: params.source.message,
              metadata: parseJson<Record<string, unknown>>(params.source.metadataJson, {}),
            }
          : {
              kind: 'audit',
              action: params.source.action,
              actorAddress: params.source.actorAddress,
              metadata: parseJson<Record<string, unknown>>(params.source.metadataJson, {}),
            },
    });

    const payloadHash = buildPayloadHash(payload);
    for (const endpoint of matchingEndpoints) {
      const delivery = await prisma.webhookDelivery.create({
        data: {
          id: randomUUID(),
          endpointId: endpoint.id,
          agreementId: agreement.id,
          eventType: event,
          payloadJson: payload,
          payloadHash,
          status: 'PENDING',
          attempts: 0,
          nextRetryAt: new Date(),
        },
      });

      await enqueueJob({
        agreementId: agreement.id,
        kind: 'DELIVER_WEBHOOK',
        payload: {
          agreementId: agreement.id,
          deliveryId: delivery.id,
        },
      });
    }
  }
}

export async function enqueueWebhookEventsForLog(log: {
  agreementId: string | null;
  eventType: string;
  message: string;
  metadataJson: string | null;
  createdAt: Date;
}) {
  if (!log.agreementId) {
    return;
  }

  await queueWebhookEventsForAgreement({
    agreementId: log.agreementId,
    source: {
      kind: 'log',
      eventType: log.eventType,
      message: log.message,
      metadataJson: log.metadataJson,
      createdAt: log.createdAt,
    },
  });
}

export async function enqueueWebhookEventsForAuditLog(audit: {
  agreementId: string | null;
  action: string;
  actorAddress: string | null;
  metadataJson: string | null;
  createdAt: Date;
}) {
  if (!audit.agreementId) {
    return;
  }

  await queueWebhookEventsForAgreement({
    agreementId: audit.agreementId,
    source: {
      kind: 'audit',
      action: audit.action,
      actorAddress: audit.actorAddress,
      metadataJson: audit.metadataJson,
      createdAt: audit.createdAt,
    },
  });
}

export async function createWebhookEndpoint(params: {
  ownerAddress: string;
  label?: string;
  targetUrl: string;
  eventTypes: WebhookEventType[];
}) {
  const ownerAddress = normalizeWalletAddress(params.ownerAddress);
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(params.targetUrl);
  } catch {
    throw new Error('Webhook URL must be valid.');
  }

  if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
    throw new Error('Webhook URL must use http or https.');
  }

  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      id: randomUUID(),
      ownerAddress,
      label: params.label?.trim() || null,
      targetUrl: parsedUrl.toString(),
      eventTypesJson: JSON.stringify(params.eventTypes),
      signingSecret: createSigningSecret(),
      isActive: true,
    },
  });

  return serializeEndpoint(endpoint);
}

export async function listWebhookEndpoints(ownerAddress: string) {
  const normalizedAddress = normalizeWalletAddress(ownerAddress);
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { ownerAddress: normalizedAddress },
    include: {
      deliveries: {
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return endpoints.map(serializeEndpoint);
}

export async function getWebhookEndpointDeliveries(ownerAddress: string, endpointId: string, limit = 50) {
  const normalizedAddress = normalizeWalletAddress(ownerAddress);
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: {
      id: endpointId,
      ownerAddress: normalizedAddress,
    },
  });

  if (!endpoint) {
    throw new Error('Webhook endpoint not found.');
  }

  const deliveries = await prisma.webhookDelivery.findMany({
    where: { endpointId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return deliveries.map(serializeDelivery);
}

export async function deliverWebhookDelivery(deliveryId: string) {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: {
      endpoint: true,
    },
  });

  if (!delivery) {
    throw new Error(`Webhook delivery ${deliveryId} not found.`);
  }

  if (!delivery.endpoint.isActive) {
    return prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'FAILED',
        lastError: 'Webhook endpoint is inactive.',
        attempts: delivery.attempts + 1,
      },
    });
  }

  const timeoutSignal = AbortSignal.timeout(config.webhookTimeoutMs);
  try {
    const response = await fetch(delivery.endpoint.targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PactAgent-Event': delivery.eventType,
        'X-PactAgent-Delivery': delivery.id,
        'X-PactAgent-Signature': buildSignature(delivery.endpoint.signingSecret, delivery.payloadJson),
      },
      body: delivery.payloadJson,
      signal: timeoutSignal,
    });

    if (!response.ok) {
      throw new Error(`Webhook responded with status ${response.status}`);
    }

    return prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'DELIVERED',
        statusCode: response.status,
        attempts: delivery.attempts + 1,
        lastError: null,
        nextRetryAt: null,
        deliveredAt: new Date(),
      },
    });
  } catch (error) {
    const attempts = delivery.attempts + 1;
    const shouldRetry = attempts < config.webhookMaxAttempts;
    const nextRetryAt = shouldRetry ? new Date(Date.now() + getRetryDelayMs(attempts)) : null;
    const updated = await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: shouldRetry ? 'RETRY' : 'FAILED',
        attempts,
        statusCode: null,
        lastError: error instanceof Error ? error.message : 'Webhook delivery failed',
        nextRetryAt,
      },
    });

    if (shouldRetry) {
      await enqueueJob({
        agreementId: delivery.agreementId,
        kind: 'DELIVER_WEBHOOK',
        payload: {
          agreementId: delivery.agreementId ?? undefined,
          deliveryId: delivery.id,
        },
        availableAt: nextRetryAt || new Date(),
      });
    }

    return updated;
  }
}
