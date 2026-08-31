import type { Request } from 'express';
import { config } from '../../config';
import { prisma } from '../../db';
import { tenantContext } from '../../common/tenancy/tenant-context';
import { invalidRequest, notFound } from '../../common/errors/app-error';
import { createInfrastructureAuditLog } from '../audit-logs/audit-log.repository';
import { assertProviderResponse, executeProviderRequest } from '../../common/resilience/provider';
import { createEvent } from '../events/event.repository';
import { enqueueJob } from '../../services/jobQueueService';
import { serializeWebhookDelivery, serializeWebhookEndpoint, serializeCreatedWebhookEndpoint } from './webhook.model';
import { getWebhookRetryDelayMs } from './webhook.retry';
import { assertWebhookUrlAllowed, fetchWebhookUrl } from './webhook.security';
import {
  decryptWebhookSecret,
  encryptWebhookSecret,
  generateWebhookSecret,
  hashWebhookSecret,
  signWebhookPayload,
} from './webhook.signing';
import { WEBHOOK_EVENTS } from './webhook.events';
import * as webhookRepository from './webhook.repository';
import type {
  CreateWebhookEndpointInput,
  UpdateWebhookEndpointInput,
  WebhookDeliveryListQuery,
  WebhookEndpointListQuery,
} from './webhook.validation';

type AppContext = {
  id: string;
  environment: string;
};

function auditWebhook(req: Request, params: {
  appId: string;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
}, tx?: Parameters<typeof createInfrastructureAuditLog>[1]) {
  return createInfrastructureAuditLog({
    appId: params.appId,
    actorType: req.apiKey ? 'api_key' : 'system',
    actorId: req.apiKey?.id ?? null,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    before: params.before,
    after: params.after,
    ipAddress: req.ip,
    userAgent: req.header('user-agent') ?? null,
    requestId: req.requestId,
  }, tx);
}

function responseSnippet(body: string) {
  return body.slice(0, config.webhookResponseSnippetBytes);
}

function deliveryEndpointUrl(delivery: Awaited<ReturnType<typeof webhookRepository.findWebhookDeliveryWithEndpoint>>) {
  if (!delivery?.endpoint) {
    return null;
  }

  return delivery.endpoint.url;
}

async function enqueueWebhookDeliveryJob(params: {
  appId: string;
  deliveryId: string;
  agreementId: string | null;
  attemptKey: string;
  availableAt?: Date | null;
}, tx?: Parameters<typeof enqueueJob>[1]) {
  await enqueueJob({
    appId: params.appId,
    agreementId: params.agreementId,
    kind: 'DELIVER_WEBHOOK',
    payload: {
      agreementId: params.agreementId ?? undefined,
      deliveryId: params.deliveryId,
    },
    availableAt: params.availableAt ?? undefined,
    maxAttempts: 1,
    dedupeKey: `INFRA_WEBHOOK_DELIVERY:${params.deliveryId}:${params.attemptKey}`,
  }, tx);
}

export async function createWebhookEndpointForApp(req: Request, app: AppContext, input: CreateWebhookEndpointInput) {
  const normalizedUrl = await assertWebhookUrlAllowed(input.url, app.environment);
  const secret = generateWebhookSecret();
  const secretHash = hashWebhookSecret(secret);
  const secretCiphertext = encryptWebhookSecret(secret);
  const endpoint = await webhookRepository.createWebhookEndpoint({
    tenant: tenantContext(app.id),
    input,
    normalizedUrl,
    secretHash,
    secretCiphertext,
  });
  const serialized = serializeWebhookEndpoint(endpoint);

  await auditWebhook(req, {
    appId: app.id,
    action: 'webhook_endpoint.created',
    targetType: 'webhook_endpoint',
    targetId: endpoint.id,
    after: serialized,
  });

  return serializeCreatedWebhookEndpoint(endpoint, secret);
}

export async function listWebhookEndpointsForApp(appId: string, query: WebhookEndpointListQuery) {
  const endpoints = await webhookRepository.listWebhookEndpointsForApp(tenantContext(appId), query);
  const hasMore = endpoints.length > query.limit;
  const data = endpoints.slice(0, query.limit);

  return {
    data: data.map(serializeWebhookEndpoint),
    pagination: {
      limit: query.limit,
      cursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    },
  };
}

export async function getWebhookEndpointForApp(appId: string, endpointId: string) {
  const endpoint = await webhookRepository.findWebhookEndpointForApp(tenantContext(appId), endpointId);
  if (!endpoint) {
    throw notFound('Webhook endpoint not found.', 'webhook_endpoint_not_found');
  }

  return serializeWebhookEndpoint(endpoint);
}

export async function updateWebhookEndpointForApp(
  req: Request,
  app: AppContext,
  endpointId: string,
  input: UpdateWebhookEndpointInput,
) {
  const before = await webhookRepository.findWebhookEndpointForApp(tenantContext(app.id), endpointId);
  if (!before) {
    throw notFound('Webhook endpoint not found.', 'webhook_endpoint_not_found');
  }

  if (
    input.status === 'active'
    && (!before.secretHash || !before.secretCiphertext || !before.encryptionKeyVersion)
  ) {
    throw invalidRequest(
      'This migrated webhook endpoint has no usable signing secret. Delete and recreate it before enabling delivery.',
      'webhook_secret_rotation_required',
    );
  }

  const normalizedUrl = input.url ? await assertWebhookUrlAllowed(input.url, app.environment) : undefined;
  const updated = await webhookRepository.updateWebhookEndpointForApp(tenantContext(app.id), endpointId, {
    ...input,
    normalizedUrl,
  });
  const serializedBefore = serializeWebhookEndpoint(before);
  const serializedAfter = serializeWebhookEndpoint(updated);

  await auditWebhook(req, {
    appId: app.id,
    action: input.status === 'disabled' ? 'webhook_endpoint.disabled' : 'webhook_endpoint.updated',
    targetType: 'webhook_endpoint',
    targetId: endpointId,
    before: serializedBefore,
    after: serializedAfter,
  });

  return serializedAfter;
}

export async function deleteWebhookEndpointForApp(req: Request, appId: string, endpointId: string) {
  const before = await webhookRepository.findWebhookEndpointForApp(tenantContext(appId), endpointId);
  if (!before) {
    throw notFound('Webhook endpoint not found.', 'webhook_endpoint_not_found');
  }

  const deleted = await webhookRepository.deleteWebhookEndpointForApp(tenantContext(appId), endpointId);
  const serializedBefore = serializeWebhookEndpoint(before);
  const serializedAfter = serializeWebhookEndpoint(deleted);

  await auditWebhook(req, {
    appId,
    action: 'webhook_endpoint.disabled',
    targetType: 'webhook_endpoint',
    targetId: endpointId,
    before: serializedBefore,
    after: serializedAfter,
  });

  return serializedAfter;
}

export async function listWebhookDeliveriesForApp(appId: string, query: WebhookDeliveryListQuery) {
  const deliveries = await webhookRepository.listWebhookDeliveriesForApp(tenantContext(appId), query);
  const hasMore = deliveries.length > query.limit;
  const data = deliveries.slice(0, query.limit);

  return {
    data: data.map(serializeWebhookDelivery),
    pagination: {
      limit: query.limit,
      cursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    },
  };
}

export async function getWebhookDeliveryForApp(appId: string, deliveryId: string) {
  const delivery = await webhookRepository.findWebhookDeliveryForApp(tenantContext(appId), deliveryId);
  if (!delivery) {
    throw notFound('Webhook delivery not found.', 'webhook_delivery_not_found');
  }

  return serializeWebhookDelivery(delivery);
}

export async function retryWebhookDeliveryForApp(req: Request, appId: string, deliveryId: string) {
  const before = await webhookRepository.findWebhookDeliveryForApp(tenantContext(appId), deliveryId);
  if (!before) {
    throw notFound('Webhook delivery not found.', 'webhook_delivery_not_found');
  }

  if (before.status === 'DELIVERED') {
    throw invalidRequest('Delivered webhook deliveries cannot be retried.', 'webhook_delivery_already_delivered');
  }

  return prisma.$transaction(async (tx) => {
    const updated = await webhookRepository.markWebhookDeliveryForRetry(tenantContext(appId), deliveryId, tx);
    if (!updated) {
      throw invalidRequest('Webhook delivery is already queued or being delivered.', 'webhook_delivery_retry_in_progress');
    }
    const serializedBefore = serializeWebhookDelivery(before);
    const serializedAfter = serializeWebhookDelivery(updated);

    await auditWebhook(req, {
      appId,
      action: 'webhook_delivery.retried',
      targetType: 'webhook_delivery',
      targetId: deliveryId,
      before: serializedBefore,
      after: serializedAfter,
    }, tx);

    await enqueueWebhookDeliveryJob({
      appId,
      deliveryId: updated.id,
      agreementId: updated.agreementId,
      attemptKey: `manual:${Date.now()}`,
    }, tx);

    return serializedAfter;
  });
}

async function recordFinalDeliveryFailure(
  delivery: { appId: string | null; eventType: string; id: string; endpointId: string; eventId: string | null },
  reason: string,
  tx?: Parameters<typeof createEvent>[2],
) {
  if (!delivery.appId || delivery.eventType === WEBHOOK_EVENTS.deliveryFailed) {
    return;
  }

  await createEvent(tenantContext(delivery.appId), {
    type: WEBHOOK_EVENTS.deliveryFailed,
    payload: {
      deliveryId: delivery.id,
      endpointId: delivery.endpointId,
      eventId: delivery.eventId,
      reason,
    },
  }, tx);
}

async function recordDeliveryResult(params: {
  delivery: NonNullable<Awaited<ReturnType<typeof webhookRepository.findWebhookDeliveryWithEndpoint>>>;
  data: Parameters<typeof webhookRepository.updateWebhookDeliveryResult>[0]['data'];
  finalFailureReason?: string;
  retry?: { attemptKey: string; availableAt: Date | null };
}) {
  return prisma.$transaction(async (tx) => {
    const result = await webhookRepository.updateWebhookDeliveryResult({
      deliveryId: params.delivery.id,
      appId: params.delivery.appId,
      expectedStatus: params.delivery.status,
      expectedAttempts: params.delivery.attempts,
      data: params.data,
    }, tx);
    if (!result.applied) return result.delivery;

    if (params.finalFailureReason) {
      await recordFinalDeliveryFailure(params.delivery, params.finalFailureReason, tx);
    }
    if (params.retry) {
      await enqueueWebhookDeliveryJob({
        appId: params.delivery.appId,
        deliveryId: params.delivery.id,
        agreementId: params.delivery.agreementId,
        attemptKey: params.retry.attemptKey,
        availableAt: params.retry.availableAt,
      }, tx);
    }
    return result.delivery;
  });
}

export async function deliverWebhookDelivery(deliveryId: string) {
  const delivery = await webhookRepository.findWebhookDeliveryWithEndpoint(deliveryId);
  if (!delivery) {
    throw notFound('Webhook delivery not found.', 'webhook_delivery_not_found');
  }

  if (!delivery.endpoint) {
    throw notFound('Webhook endpoint not found for delivery.', 'webhook_endpoint_not_found');
  }
  const endpoint = delivery.endpoint;

  if (delivery.status === 'DELIVERED') {
    return serializeWebhookDelivery(delivery);
  }

  const endpointUrl = deliveryEndpointUrl(delivery);
  if (delivery.endpoint.status !== 'active' || !endpointUrl) {
    const updated = await recordDeliveryResult({
      delivery,
      data: { status: 'FAILED', lastError: 'Webhook endpoint is inactive.' },
      finalFailureReason: 'Webhook endpoint is inactive.',
    });
    return serializeWebhookDelivery(updated);
  }

  if (!delivery.endpoint.secretCiphertext) {
    const updated = await recordDeliveryResult({
      delivery,
      data: { status: 'FAILED', lastError: 'Webhook endpoint signing secret is unavailable.' },
      finalFailureReason: 'Webhook endpoint signing secret is unavailable.',
    });
    return serializeWebhookDelivery(updated);
  }

  const secret = decryptWebhookSecret(delivery.endpoint.secretCiphertext);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signWebhookPayload(secret, timestamp, delivery.payloadJson);

  try {
    const response = await executeProviderRequest({
      provider: 'webhook', operation: 'deliver', timeoutMs: config.webhookTimeoutMs, maxAttempts: 1, concurrency: 20,
      correlation: { appId: delivery.appId, agreementId: delivery.agreementId, deliveryId: delivery.id },
      run: async ({ signal, requestId }) => {
        const result = await fetchWebhookUrl(endpointUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'PactAgent-Webhooks/1.0',
            'PactAgent-Event-Id': delivery.eventId ?? delivery.id, 'PactAgent-Timestamp': timestamp,
            'PactAgent-Signature': signature, 'PactAgent-Request-Id': requestId },
          body: delivery.payloadJson, signal,
        }, endpoint.app?.environment ?? 'sandbox', config.webhookMaxRedirects);
        assertProviderResponse(result, 'webhook', requestId);
        return result;
      },
    });
    const body = await response.text().catch(() => '');

    if (!response.ok) {
      throw new Error(`Webhook responded with status ${response.status}`);
    }

    const updated = await recordDeliveryResult({
      delivery,
      data: {
        status: 'DELIVERED',
        statusCode: response.status,
        responseBodySnippet: responseSnippet(body),
        lastError: null,
        nextRetryAt: null,
        deliveredAt: new Date(),
      },
    });

    return serializeWebhookDelivery(updated);
  } catch (error) {
    const failedAttemptCount = delivery.attempts + 1;
    const retryDelayMs = getWebhookRetryDelayMs(failedAttemptCount);
    const message = error instanceof Error ? error.message : 'Webhook delivery failed.';
    const shouldRetry = retryDelayMs !== null;
    const nextRetryAt = shouldRetry ? new Date(Date.now() + retryDelayMs) : null;
    const updated = await recordDeliveryResult({
      delivery,
      data: {
        status: shouldRetry ? 'RETRY' : 'FAILED',
        statusCode: null,
        responseBodySnippet: null,
        lastError: message,
        nextRetryAt,
        deliveredAt: null,
      },
      finalFailureReason: shouldRetry ? undefined : message,
      retry: shouldRetry ? { attemptKey: String(failedAttemptCount), availableAt: nextRetryAt } : undefined,
    });

    return serializeWebhookDelivery(updated);
  }
}

export async function processDueWebhookDeliveries(limit = 25) {
  const deliveries = await webhookRepository.listDueWebhookDeliveries(limit);
  const results = [];

  for (const delivery of deliveries) {
    results.push(await deliverWebhookDelivery(delivery.id));
  }

  return results;
}
