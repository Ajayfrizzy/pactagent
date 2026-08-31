import { useStore } from './store';

const V1_BASE = process.env.NEXT_PUBLIC_V1_API_BASE_URL || '/v1';

export const INFRASTRUCTURE_EVENT_TYPES = [
  'agreement.created',
  'agreement.accepted',
  'agreement.cancelled',
  'agreement.funding_required',
  'agreement.funded',
  'agreement.in_progress',
  'agreement.released',
  'agreement.refunded',
  'milestone.created',
  'milestone.funded',
  'milestone.proof_submitted',
  'milestone.approved',
  'milestone.released',
  'escrow.created',
  'escrow.funding_detected',
  'escrow.funded',
  'escrow.release_pending',
  'escrow.released',
  'escrow.refund_pending',
  'escrow.refunded',
  'escrow.failed',
  'proof.submitted',
  'proof.under_review',
  'proof.approved',
  'proof.rejected',
  'proof.needs_changes',
  'dispute.opened',
  'dispute.resolved',
  'webhook.delivery_failed',
] as const;

export const INFRASTRUCTURE_API_KEY_SCOPES = [
  'apps:read',
  'agreements:create',
  'agreements:read',
  'agreements:update',
  'agreements:cancel',
  'milestones:create',
  'milestones:read',
  'escrows:create',
  'escrows:read',
  'escrows:fund',
  'escrows:release',
  'escrows:refund',
  'proofs:create',
  'proofs:read',
  'proofs:review',
  'disputes:create',
  'disputes:read',
  'disputes:resolve',
  'events:read',
  'webhooks:manage',
  'webhooks:read',
  'admin:read',
  'admin:write',
] as const;

type ApiError = string | {
  type?: string;
  code?: string;
  message?: string;
  requestId?: string;
};

type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  pagination?: {
    limit: number;
    cursor: string | null;
  };
  requestId?: string;
  error?: ApiError;
};

type ApiRequestOptions = RequestInit & {
  apiKey?: string | null;
  authToken?: string | null;
  idempotencyKey?: string;
};

function isLikelyHtmlResponse(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('<!doctype') || normalized.startsWith('<html') || normalized.includes('<body');
}

function formatApiError(path: string, status: number, rawBody: string, error?: ApiError) {
  if (typeof error === 'string' && error) {
    return error;
  }

  if (error && typeof error === 'object' && error.message) {
    return error.code ? `${error.message} (${error.code})` : error.message;
  }

  if (!rawBody) {
    return `API request to ${path} failed with status ${status}.`;
  }

  if (isLikelyHtmlResponse(rawBody)) {
    return `API request to ${path} returned HTML instead of JSON. Check that the backend is running and API_PROXY_TARGET is correct.`;
  }

  const singleLine = rawBody.replace(/\s+/g, ' ').trim();
  return singleLine.length > 240 ? `${singleLine.slice(0, 240)}...` : singleLine;
}

async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<ApiEnvelope<T>> {
  const {
    apiKey: requestedApiKey,
    authToken: requestedAuthToken,
    idempotencyKey,
    headers: requestedHeaders,
    ...requestInit
  } = options;
  const apiKey = Object.prototype.hasOwnProperty.call(options, 'apiKey')
    ? requestedApiKey
    : useStore.getState().infrastructureApiKey;
  const authToken = Object.prototype.hasOwnProperty.call(options, 'authToken')
    ? requestedAuthToken
    : useStore.getState().authToken;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((requestedHeaders as Record<string, string> | undefined) || {}),
  };

  if (apiKey) {
    headers['x-api-key'] = apiKey;
  } else if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  const response = await fetch(`${V1_BASE}${path}`, { ...requestInit, headers });
  const rawBody = await response.text();
  let envelope: ApiEnvelope<T> = {};

  if (rawBody) {
    try {
      envelope = JSON.parse(rawBody) as ApiEnvelope<T>;
    } catch {
      throw new Error(formatApiError(path, response.status, rawBody));
    }
  }

  if (!response.ok || envelope.success === false || envelope.error) {
    throw new Error(formatApiError(path, response.status, rawBody, envelope.error));
  }

  return envelope;
}

async function v1Request<T>(path: string, options: ApiRequestOptions = {}) {
  return (await apiRequest<T>(path, options)).data as T;
}

async function v1ListRequest<T>(path: string, options: ApiRequestOptions = {}) {
  const envelope = await apiRequest<T[]>(path, options);
  return {
    data: envelope.data || [],
    pagination: envelope.pagination || { limit: 20, cursor: null },
    requestId: envelope.requestId || null,
  };
}

function withQuery(path: string, params: Record<string, string | number | null | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });
  return query.size > 0 ? `${path}?${query.toString()}` : path;
}

export function createIdempotencyKey(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export async function fetchAuthChallenge(address: string) {
  return v1Request<{ message: string; expiresAt: string }>('/auth/challenge', {
    apiKey: null,
    authToken: null,
    method: 'POST',
    body: JSON.stringify({ address }),
  });
}

export async function verifyWalletAuth(data: {
  address: string;
  message: string;
  signature: { signature: string; identity: string; signType: string };
}) {
  return v1Request<{ token: string; address: string; isAdmin: boolean; expiresAt: string }>('/auth/verify', {
    apiKey: null,
    authToken: null,
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchCurrentSession() {
  return v1Request<{ address: string; isAdmin: boolean; issuedAt: number; expiresAt: number }>('/auth/me', {
    apiKey: null,
  });
}

export function fetchInfrastructureHealth() {
  return fetch('/health').then(async (response) => {
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error('Health check failed');
    return body;
  });
}

export function fetchInfrastructureReady() {
  return fetch('/ready').then(async (response) => {
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error('Readiness check failed');
    return body;
  });
}

export function fetchInfrastructureApps(limit = 100) {
  return v1ListRequest<any>(withQuery('/apps', { limit }), { apiKey: null });
}

export function createInfrastructureApp(data: {
  name: string;
  slug: string;
  environment: 'sandbox' | 'production';
  defaultCurrency: string;
  defaultNetwork: string;
}) {
  return v1Request<any>('/apps', { apiKey: null, method: 'POST', body: JSON.stringify(data) });
}

export function disableInfrastructureApp(id: string) {
  return v1Request<any>(`/apps/${id}/disable`, { apiKey: null, method: 'POST' });
}

export function fetchInfrastructureCurrentApp(apiKey?: string | null) {
  return v1Request<any>('/apps/current', { apiKey });
}

export function fetchInfrastructureApiKeys(appId?: string | null, limit = 100) {
  return v1ListRequest<any>(withQuery('/api-keys', { appId, limit }), { apiKey: null });
}

export function createInfrastructureApiKey(data: { appId: string; name: string; scopes: string[] }) {
  return v1Request<any>('/api-keys', { apiKey: null, method: 'POST', body: JSON.stringify(data) });
}

export function revokeInfrastructureApiKey(id: string) {
  return v1Request<any>(`/api-keys/${id}`, { apiKey: null, method: 'DELETE' });
}

export function fetchInfrastructureAgreements(limit = 25) {
  return v1ListRequest<any>(withQuery('/agreements', { limit }));
}

export function createInfrastructureAgreement(data: Record<string, unknown>, idempotencyKey: string) {
  return v1Request<any>('/agreements', { method: 'POST', idempotencyKey, body: JSON.stringify(data) });
}

export function acceptInfrastructureAgreement(id: string, idempotencyKey: string) {
  return v1Request<any>(`/agreements/${id}/accept`, { method: 'POST', idempotencyKey, body: '{}' });
}

export function moveInfrastructureAgreementToFundingRequired(id: string, idempotencyKey: string) {
  return v1Request<any>(`/agreements/${id}/funding-required`, { method: 'POST', idempotencyKey, body: '{}' });
}

export function fetchInfrastructureMilestones(limit = 50) {
  return v1ListRequest<any>(withQuery('/milestones', { limit }));
}

export function createInfrastructureMilestone(agreementId: string, data: Record<string, unknown>, idempotencyKey: string) {
  return v1Request<any>(`/agreements/${agreementId}/milestones`, { method: 'POST', idempotencyKey, body: JSON.stringify(data) });
}

export function fetchInfrastructureEscrows(limit = 50) {
  return v1ListRequest<any>(withQuery('/escrows', { limit }));
}

export function createInfrastructureEscrow(data: Record<string, unknown>, idempotencyKey: string) {
  return v1Request<any>('/escrows', { method: 'POST', idempotencyKey, body: JSON.stringify(data) });
}

export function markInfrastructureEscrowFunded(id: string, idempotencyKey: string, txHash?: string) {
  return v1Request<any>(`/escrows/${id}/mark-funded`, {
    method: 'POST',
    idempotencyKey,
    body: JSON.stringify(txHash ? { txHash } : {}),
  });
}

export function releaseInfrastructureEscrow(id: string, idempotencyKey: string) {
  return v1Request<any>(`/escrows/${id}/release`, { method: 'POST', idempotencyKey, body: '{}' });
}

export function refundInfrastructureEscrow(id: string, idempotencyKey: string) {
  return v1Request<any>(`/escrows/${id}/refund`, { method: 'POST', idempotencyKey, body: '{}' });
}

export function fetchInfrastructureProofs(limit = 50) {
  return v1ListRequest<any>(withQuery('/proofs', { limit }));
}

export function createInfrastructureProof(data: Record<string, unknown>, idempotencyKey: string) {
  return v1Request<any>('/proofs', { method: 'POST', idempotencyKey, body: JSON.stringify(data) });
}

export function reviewInfrastructureProof(id: string, data: Record<string, unknown>, idempotencyKey: string) {
  return v1Request<any>(`/proofs/${id}/review`, { method: 'POST', idempotencyKey, body: JSON.stringify(data) });
}

export function fetchInfrastructureReviews(limit = 50) {
  return v1ListRequest<any>(withQuery('/reviews', { limit }));
}

export function fetchInfrastructureDisputes(limit = 50) {
  return v1ListRequest<any>(withQuery('/disputes', { limit }));
}

export function fetchInfrastructureEvents(limit = 50) {
  return v1ListRequest<any>(withQuery('/events', { limit }));
}

export function fetchInfrastructureAuditLogs(limit = 50) {
  return v1ListRequest<any>(withQuery('/audit-logs', { limit }));
}

export function fetchInfrastructureTransactions(limit = 50) {
  return v1ListRequest<any>(withQuery('/transactions', { limit }));
}

export function fetchInfrastructureWebhookEndpoints(limit = 50) {
  return v1ListRequest<any>(withQuery('/webhook-endpoints', { limit }));
}

export function createInfrastructureWebhookEndpoint(data: {
  url: string;
  description?: string;
  subscribedEvents: string[];
}) {
  return v1Request<any>('/webhook-endpoints', { method: 'POST', body: JSON.stringify(data) });
}

export function updateInfrastructureWebhookEndpoint(id: string, data: Record<string, unknown>) {
  return v1Request<any>(`/webhook-endpoints/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteInfrastructureWebhookEndpoint(id: string) {
  return v1Request<any>(`/webhook-endpoints/${id}`, { method: 'DELETE' });
}

export function fetchInfrastructureWebhookDeliveries(limit = 50, endpointId?: string | null) {
  return v1ListRequest<any>(withQuery('/webhook-deliveries', { limit, endpointId }));
}

export function retryInfrastructureWebhookDelivery(id: string) {
  return v1Request<any>(`/webhook-deliveries/${id}/retry`, { method: 'POST' });
}

export function fetchInfrastructureAdminHealth() {
  return v1Request<any>('/admin/system-health', { apiKey: null });
}

export function fetchInfrastructureAdminList(
  kind: 'apps' | 'agreements' | 'escrows' | 'events' | 'webhook-deliveries' | 'audit-logs',
  limit = 25,
) {
  return v1ListRequest<any>(withQuery(`/admin/${kind}`, { limit }), { apiKey: null });
}
