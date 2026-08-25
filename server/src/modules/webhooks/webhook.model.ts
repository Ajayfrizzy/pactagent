type WebhookEndpointRecord = {
  id: string;
  appId: string;
  url: string;
  description: string | null;
  subscribedEvents: string[];
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

type WebhookDeliveryRecord = {
  id: string;
  appId: string;
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

export function serializeWebhookEndpoint(endpoint: WebhookEndpointRecord) {
  return {
    id: endpoint.id,
    appId: endpoint.appId,
    url: endpoint.url,
    description: endpoint.description,
    subscribedEvents: endpoint.subscribedEvents,
    status: endpoint.status,
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
