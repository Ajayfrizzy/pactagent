import type { Request } from 'express';
import { config } from '../../config';
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
}) {
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
  });
}

function responseSnippet(body: string) {
  return body.slice(0, config.webhookResponseSnippetBytes);
}

function deliveryEndpointUrl(delivery: Awaited<ReturnType<typeof webhookRepository.findWebhookDeliveryWithEndpoint>>) {
  if (!delivery) {
    return null;
  }

  return delivery.endpoint.url ?? delivery.endpoint.targetUrl;
}

async function enqueueWebhookDeliveryJob(params: {
  deliveryId: string;
  agreementId: string | null;
  attemptKey: string;
  availableAt?: Date | null;
}) {
  await enqueueJob({
    agreementId: params.agreementId,
    kind: 'DELIVER_WEBHOOK',
    payload: {
      agreementId: params.agreementId ?? undefined,
      deliveryId: params.deliveryId,
    },
    availableAt: params.availableAt ?? undefined,
    maxAttempts: 1,
    dedupeKey: `INFRA_WEBHOOK_DELIVERY:${params.deliveryId}:${params.attemptKey}`,
  });
}

export async function createWebhookEndpointForApp(req: Request, app: AppContext, input: CreateWebhookEndpointInput) {
  const normalizedUrl = await assertWebhookUrlAllowed(input.url, app.environment);
  const secret = generateWebhookSecret();
  const secretHash = hashWebhookSecret(secret);
  const secretCiphertext = encryptWebhookSecret(secret);
  const endpoint = await webhookRepository.createWebhookEndpoint({
    appId: app.id,
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
  const endpoints = await webhookRepository.listWebhookEndpointsForApp(appId, query);
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
  const endpoint = await webhookRepository.findWebhookEndpointForApp(appId, endpointId);
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
  const before = await webhookRepository.findWebhookEndpointForApp(app.id, endpointId);
  if (!before) {
    throw notFound('Webhook endpoint not found.', 'webhook_endpoint_not_found');
  }

  const normalizedUrl = input.url ? await assertWebhookUrlAllowed(input.url, app.environment) : undefined;
  const updated = await webhookRepository.updateWebhookEndpointForApp(app.id, endpointId, {
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
  const before = await webhookRepository.findWebhookEndpointForApp(appId, endpointId);
  if (!before) {
    throw notFound('Webhook endpoint not found.', 'webhook_endpoint_not_found');
  }

  const deleted = await webhookRepository.deleteWebhookEndpointForApp(appId, endpointId);
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
  const deliveries = await webhookRepository.listWebhookDeliveriesForApp(appId, query);
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
  const delivery = await webhookRepository.findWebhookDeliveryForApp(appId, deliveryId);
  if (!delivery) {
    throw notFound('Webhook delivery not found.', 'webhook_delivery_not_found');
  }

  return serializeWebhookDelivery(delivery);
}

export async function retryWebhookDeliveryForApp(req: Request, appId: string, deliveryId: string) {
  const before = await webhookRepository.findWebhookDeliveryForApp(appId, deliveryId);
  if (!before) {
    throw notFound('Webhook delivery not found.', 'webhook_delivery_not_found');
  }

  if (before.status === 'DELIVERED') {
    throw invalidRequest('Delivered webhook deliveries cannot be retried.', 'webhook_delivery_already_delivered');
  }

  const updated = await webhookRepository.markWebhookDeliveryForRetry(appId, deliveryId);
  const serializedBefore = serializeWebhookDelivery(before);
  const serializedAfter = serializeWebhookDelivery(updated);

  await auditWebhook(req, {
    appId,
    action: 'webhook_delivery.retried',
    targetType: 'webhook_delivery',
    targetId: deliveryId,
    before: serializedBefore,
    after: serializedAfter,
  });

  await enqueueWebhookDeliveryJob({
    deliveryId: updated.id,
    agreementId: updated.agreementId,
    attemptKey: `manual:${Date.now()}`,
  });

  return serializedAfter;
}

async function recordFinalDeliveryFailure(delivery: { appId: string | null; eventType: string; id: string; endpointId: string; eventId: string | null }, reason: string) {
  if (!delivery.appId || delivery.eventType === WEBHOOK_EVENTS.deliveryFailed) {
    return;
  }

  await createEvent({
    appId: delivery.appId,
    type: WEBHOOK_EVENTS.deliveryFailed,
    payload: {
      deliveryId: delivery.id,
      endpointId: delivery.endpointId,
      eventId: delivery.eventId,
      reason,
    },
  });
}

export async function deliverWebhookDelivery(deliveryId: string) {
  const delivery = await webhookRepository.findWebhookDeliveryWithEndpoint(deliveryId);
  if (!delivery) {
    throw notFound('Webhook delivery not found.', 'webhook_delivery_not_found');
  }

  const endpointUrl = deliveryEndpointUrl(delivery);
  if (!delivery.endpoint.isActive || delivery.endpoint.status !== 'active' || !endpointUrl) {
    const updated = await webhookRepository.updateWebhookDeliveryResult(delivery.id, {
      status: 'FAILED',
      lastError: 'Webhook endpoint is inactive.',
    });
    await recordFinalDeliveryFailure(delivery, 'Webhook endpoint is inactive.');
    return serializeWebhookDelivery(updated);
  }

  if (!delivery.endpoint.secretCiphertext) {
    const updated = await webhookRepository.updateWebhookDeliveryResult(delivery.id, {
      status: 'FAILED',
      lastError: 'Webhook endpoint signing secret is unavailable.',
    });
    await recordFinalDeliveryFailure(delivery, 'Webhook endpoint signing secret is unavailable.');
    return serializeWebhookDelivery(updated);
  }

  const secret = decryptWebhookSecret(delivery.endpoint.secretCiphertext);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signWebhookPayload(secret, timestamp, delivery.payloadJson);

  try {
    const response = await executeProviderRequest({
      provider: 'webhook', operation: 'deliver', timeoutMs: config.webhookTimeoutMs, maxAttempts: 1, concurrency: 20,
      run: async ({ signal, requestId }) => {
        const result = await fetchWebhookUrl(endpointUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'PactAgent-Webhooks/1.0',
            'PactAgent-Event-Id': delivery.eventId ?? delivery.id, 'PactAgent-Timestamp': timestamp,
            'PactAgent-Signature': signature, 'PactAgent-Request-Id': requestId },
          body: delivery.payloadJson, signal,
        }, delivery.endpoint.app?.environment ?? 'sandbox', config.webhookMaxRedirects);
        assertProviderResponse(result, 'webhook', requestId);
        return result;
      },
    });
    const body = await response.text().catch(() => '');

    if (!response.ok) {
      throw new Error(`Webhook responded with status ${response.status}`);
    }

    const updated = await webhookRepository.updateWebhookDeliveryResult(delivery.id, {
      status: 'DELIVERED',
      statusCode: response.status,
      responseBodySnippet: responseSnippet(body),
      lastError: null,
      nextRetryAt: null,
      deliveredAt: new Date(),
    });

    return serializeWebhookDelivery(updated);
  } catch (error) {
    const failedAttemptCount = delivery.attempts + 1;
    const retryDelayMs = getWebhookRetryDelayMs(failedAttemptCount);
    const message = error instanceof Error ? error.message : 'Webhook delivery failed.';
    const shouldRetry = retryDelayMs !== null;
    const updated = await webhookRepository.updateWebhookDeliveryResult(delivery.id, {
      status: shouldRetry ? 'RETRY' : 'FAILED',
      statusCode: null,
      responseBodySnippet: null,
      lastError: message,
      nextRetryAt: shouldRetry ? new Date(Date.now() + retryDelayMs) : null,
      deliveredAt: null,
    });

    if (!shouldRetry) {
      await recordFinalDeliveryFailure(delivery, message);
    } else {
      await enqueueWebhookDeliveryJob({
        deliveryId: delivery.id,
        agreementId: delivery.agreementId,
        attemptKey: String(failedAttemptCount),
        availableAt: updated.nextRetryAt,
      });
    }

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
