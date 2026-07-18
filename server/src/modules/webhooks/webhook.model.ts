type WebhookEndpointRecord = {
  id: string;
  appId: string | null;
  targetUrl: string;
  url: string | null;
  label: string | null;
  description: string | null;
  eventTypesJson: string;
  subscribedEvents: string[];
  status: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type WebhookDeliveryRecord = {
  id: string;
  appId: string | null;
  endpointId: string;
  eventId: string | null;
  agreementId: string | null;
  eventType: string;
  status: string;
  statusCode: number | null;
  responseBodySnippet: string | null;
  attempts: number;
  lastError: string | null;
  nextRetryAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function parseEvents(endpoint: WebhookEndpointRecord) {
  if (endpoint.subscribedEvents.length > 0) {
    return endpoint.subscribedEvents;
  }

  try {
    const parsed = JSON.parse(endpoint.eventTypesJson) as unknown;
    return Array.isArray(parsed) ? parsed.filter((event): event is string => typeof event === 'string') : [];
  } catch {
    return [];
  }
}

export function serializeWebhookEndpoint(endpoint: WebhookEndpointRecord) {
  return {
    id: endpoint.id,
    appId: endpoint.appId,
    url: endpoint.url ?? endpoint.targetUrl,
    description: endpoint.description ?? endpoint.label,
    subscribedEvents: parseEvents(endpoint),
    status: endpoint.status || (endpoint.isActive ? 'active' : 'disabled'),
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  };
}

export function serializeCreatedWebhookEndpoint(endpoint: WebhookEndpointRecord, secret: string) {
  return {
    ...serializeWebhookEndpoint(endpoint),
    secret,
  };
}

function deliveryStatus(status: string) {
  switch (status) {
    case 'DELIVERED':
      return 'delivered';
    case 'FAILED':
      return 'failed';
    case 'RETRY':
    case 'PENDING':
    default:
      return 'pending';
  }
}

export function serializeWebhookDelivery(delivery: WebhookDeliveryRecord) {
  return {
    id: delivery.id,
    appId: delivery.appId,
    endpointId: delivery.endpointId,
    eventId: delivery.eventId,
    agreementId: delivery.agreementId,
    eventType: delivery.eventType,
    status: deliveryStatus(delivery.status),
    attemptCount: delivery.attempts,
    responseStatus: delivery.statusCode,
    responseBodySnippet: delivery.responseBodySnippet,
    lastError: delivery.lastError,
    nextRetryAt: delivery.nextRetryAt?.toISOString() ?? null,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    createdAt: delivery.createdAt.toISOString(),
    updatedAt: delivery.updatedAt.toISOString(),
  };
}
