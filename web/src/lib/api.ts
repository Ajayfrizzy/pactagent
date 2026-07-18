import { useStore } from './store';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '/api';

const inflightGetRequests = new Map<string, Promise<unknown>>();
const responseCache = new Map<string, { expiresAt: number; value: unknown }>();

type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: string;
};

function isLikelyHtmlResponse(value: string) {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith('<!doctype') || trimmed.startsWith('<html') || trimmed.includes('<body');
}

function formatApiError(path: string, status: number, rawBody: string) {
  if (!rawBody) {
    return `API request to ${path} failed with status ${status}.`;
  }

  if (isLikelyHtmlResponse(rawBody)) {
    return `API request to ${path} returned HTML instead of JSON. Make sure the backend server is running and API_PROXY_TARGET points to it.`;
  }

  const singleLine = rawBody.replace(/\s+/g, ' ').trim();
  if (singleLine.length > 240) {
    return `${singleLine.slice(0, 240)}...`;
  }

  return singleLine;
}

function getRequestMethod(options?: RequestInit) {
  return (options?.method || 'GET').toUpperCase();
}

function getRequestKey(path: string, method: string, token: string | null) {
  return `${method}:${path}:${token || ''}`;
}

function getCacheTtlMs(path: string, method: string) {
  if (method !== 'GET') {
    return 0;
  }

  if (path === '/config') {
    return 30_000;
  }

  if (path === '/integrations/market/ckb-price') {
    return 1_000;
  }

  if (path === '/health') {
    return 5_000;
  }

  return 0;
}

async function performRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const token = useStore.getState().authToken;
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
    ...options,
  });

  const rawBody = await res.text();
  let data: ApiEnvelope<T> | null = null;

  if (rawBody) {
    try {
      data = JSON.parse(rawBody) as ApiEnvelope<T>;
    } catch {
      throw new Error(formatApiError(path, res.status, rawBody));
    }
  }

  if (!res.ok || !data?.success) {
    throw new Error(data?.error || formatApiError(path, res.status, rawBody) || 'API request failed');
  }

  return data.data as T;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = useStore.getState().authToken;
  const method = getRequestMethod(options);
  const requestKey = getRequestKey(path, method, token);
  const cacheTtlMs = getCacheTtlMs(path, method);

  if (cacheTtlMs > 0) {
    const cachedEntry = responseCache.get(requestKey);
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      return cachedEntry.value as T;
    }
  }

  if (method === 'GET') {
    const inflightRequest = inflightGetRequests.get(requestKey);
    if (inflightRequest) {
      return inflightRequest as Promise<T>;
    }
  }

  const requestPromise = performRequest<T>(path, options).then((result) => {
    if (cacheTtlMs > 0) {
      responseCache.set(requestKey, {
        expiresAt: Date.now() + cacheTtlMs,
        value: result,
      });
    }

    return result;
  });

  if (method !== 'GET') {
    return requestPromise;
  }

  inflightGetRequests.set(requestKey, requestPromise as Promise<unknown>);

  try {
    return await requestPromise;
  } finally {
    inflightGetRequests.delete(requestKey);
  }
}

export async function fetchAuthChallenge(address: string) {
  return request<{ message: string; expiresAt: string }>('/auth/challenge', {
    method: 'POST',
    body: JSON.stringify({ address }),
  });
}

export async function verifyWalletAuth(data: {
  address: string;
  message: string;
  signature: {
    signature: string;
    identity: string;
    signType: string;
  };
}) {
  return request<{ token: string; address: string; isAdmin: boolean; expiresAt: string }>('/auth/verify', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchCurrentSession() {
  return request<{ address: string; isAdmin: boolean; issuedAt: number; expiresAt: number }>('/auth/me');
}

export async function fetchAgreements(address?: string) {
  const query = address ? `?address=${address}` : '';
  return request<any[]>(`/agreements${query}`);
}

export async function fetchAgreement(id: string) {
  return request<any>(`/agreements/${id}`);
}

export async function createAgreement(data: {
  title: string;
  description: string;
  clientAddress: string;
  workerAddress: string;
  deadlineAt: string;
  disputeWindowSecs: number;
  proofType: string;
  reviewerMode: string;
  releaseMode: string;
  payoutNetwork: string;
  escrowModel?: string;
  milestones: Array<{
    title: string;
    description: string;
    amount: string;
  }>;
}) {
  return request<any>('/agreements', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function importBountyAgreement(data: {
  sourceType: 'DAO' | 'BOUNTY';
  sourceLabel: string;
  externalUrl: string;
  forumThreadUrl?: string;
  sourceReferenceId?: string;
  sponsorName?: string;
  bountyTitle: string;
  bountyDescription?: string;
  governanceNotes?: string;
  externalMetadataJson?: string;
  agreement: {
    title: string;
    description: string;
    clientAddress: string;
    workerAddress: string;
    deadlineAt: string;
    disputeWindowSecs: number;
    proofType: string;
    reviewerMode: string;
    releaseMode: string;
    payoutNetwork: string;
    escrowModel?: string;
    milestones: Array<{
      title: string;
      description: string;
      amount: string;
      targetUsd?: number;
    }>;
  };
}) {
  return request<any>('/agreements/import-bounty', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchBountyGrantAutofill(data: {
  sourceUrl: string;
}) {
  return request<{
    sourceType: 'DAO';
    sourceLabel: string;
    externalUrl: string;
    forumThreadUrl: string;
    sourceReferenceId?: string;
    sponsorName?: string;
    bountyTitle: string;
    bountyDescription: string;
    governanceNotes: string;
    agreementTitle: string;
    agreementDescription: string;
    deadlineDays: string;
    milestones: Array<{
      title: string;
      description: string;
      amountCkb: string;
      sourceBudgetLabel?: string;
      kind: 'COMMENCEMENT' | 'DELIVERABLE';
    }>;
    sourceMetadata: Record<string, unknown>;
  }>('/agreements/import-bounty/autofill', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchCkbPriceQuote(options?: {
  fresh?: boolean;
}) {
  const query = options?.fresh ? '?fresh=true' : '';
  return request<{
    assetId: 'nervos-network';
    symbol: 'CKB';
    currency: 'USD';
    priceUsd: number;
    inversePriceCkbPerUsd: number;
    lastUpdatedAt: string | null;
    fetchedAt: string;
  }>(`/integrations/market/ckb-price${query}`);
}

export async function updateDraftAgreement(id: string, data: {
  title: string;
  description: string;
  workerAddress: string;
  deadlineAt: string;
  disputeWindowSecs: number;
  proofType: string;
  reviewerMode: string;
  releaseMode: string;
  payoutNetwork: string;
  milestones: Array<{
    id?: string;
    title: string;
    description: string;
    amount: string;
  }>;
}) {
  return request<any>(`/agreements/${id}/draft`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function cancelDraftAgreement(id: string) {
  return request<any>(`/agreements/${id}/cancel`, {
    method: 'POST',
  });
}

export async function fundAgreement(
  id: string,
  txHash: string,
  amount?: string,
  milestoneOutputs?: Array<{
    milestoneId: string;
    outputIndex: number;
    escrowCellData: string;
    refundTimeoutBlock: string;
  }>,
  commencementOutputIndex?: number,
) {
  return request<any>(`/agreements/${id}/fund`, {
    method: 'POST',
    body: JSON.stringify({ txHash, amount, milestoneOutputs, commencementOutputIndex }),
  });
}

export async function topUpImportedGrantReserve(
  id: string,
  txHash: string,
  amount: string,
) {
  return request<any>(`/agreements/${id}/reserve/top-up`, {
    method: 'POST',
    body: JSON.stringify({ txHash, amount }),
  });
}

export async function submitOnchainResolution(id: string, data: {
  milestoneId: string;
  txHash: string;
  direction: 'PAYOUT' | 'REFUND';
}) {
  return request<any>(`/agreements/${id}/onchain-resolution`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function reconcileAgreement(id: string) {
  return request<any>(`/agreements/${id}/reconcile`, {
    method: 'POST',
  });
}

export async function submitProof(id: string, data: {
  milestoneId: string;
  proofType: string;
  content: string;
  contentHash?: string;
  summary?: string;
  artifacts?: Array<{
    id?: string;
    kind: 'TEXT' | 'URL' | 'FILE' | 'IMAGE';
    label?: string;
    mimeType?: string;
    content: string;
    sizeBytes?: number;
  }>;
}) {
  return request<any>(`/agreements/${id}/submit-proof`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function checkSubmittedProof(id: string, data: {
  milestoneId: string;
  async?: boolean;
}) {
  return request<any>(`/agreements/${id}/proof/check`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function openDispute(id: string, data: {
  milestoneId: string;
  openedBy: string;
  reason: string;
  evidenceNotes?: string;
  desiredResolution?: 'PAYOUT' | 'REFUND' | 'SPLIT';
  splitWorkerAmount?: string;
  artifacts?: Array<{
    id?: string;
    kind: 'TEXT' | 'URL' | 'FILE' | 'IMAGE';
    label?: string;
    mimeType?: string;
    content: string;
    sizeBytes?: number;
  }>;
}) {
  return request<any>(`/agreements/${id}/open-dispute`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function reviewAction(id: string, data: {
  action: string;
  reviewerAddress: string;
  confirmation?: {
    confirmed: true;
    summary: string;
    aiSuggestionAcknowledged?: boolean;
    proofCheckAcknowledged?: boolean;
  };
}) {
  return request<any>(`/agreements/${id}/review-action`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function draftInfoRequest(id: string, data: {
  milestoneId: string;
}) {
  return request<any>(`/agreements/${id}/info-request/draft`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function sendInfoRequest(id: string, data: {
  milestoneId: string;
  requesterAddress: string;
  questions: string[];
  note?: string;
}) {
  return request<any>(`/agreements/${id}/info-request`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function sendInfoResponse(id: string, data: {
  milestoneId: string;
  requestId: string;
  responderAddress: string;
  content: string;
}) {
  return request<any>(`/agreements/${id}/info-request/respond`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function syncAgreementSource(id: string, data?: {
  forumThreadUrl?: string;
  manualSummary?: string;
}) {
  return request<any>(`/agreements/${id}/source-sync`, {
    method: 'POST',
    body: JSON.stringify(data || {}),
  });
}

export async function updateAgreementSourcePublishState(id: string, data: {
  action: 'DRAFT' | 'PUBLISH' | 'REVIEW';
  content?: string;
  reviewerApproved?: boolean;
}) {
  return request<any>(`/agreements/${id}/source-sync/publish`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getDisputeRecommendation(id: string) {
  return request<any>(`/agreements/${id}/dispute/recommendation`, {
    method: 'POST',
  });
}

export async function addDisputeEvidence(id: string, data: {
  disputeId: string;
  submittedBy: string;
  content: string;
  desiredResolution?: 'PAYOUT' | 'REFUND' | 'SPLIT';
  splitWorkerAmount?: string;
  artifacts?: Array<{
    id?: string;
    kind: 'TEXT' | 'URL' | 'FILE' | 'IMAGE';
    label?: string;
    mimeType?: string;
    content: string;
    sizeBytes?: number;
  }>;
}) {
  return request<any>(`/agreements/${id}/dispute/evidence`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function approveMutualRefund(id: string, actorAddress: string) {
  return request<any>(`/agreements/${id}/dispute/refund-consent`, {
    method: 'POST',
    body: JSON.stringify({ actorAddress }),
  });
}

export async function proposeOrAcceptSplitSettlement(id: string, data: {
  actorAddress: string;
  workerAmount: string;
}) {
  return request<any>(`/agreements/${id}/dispute/split-offer`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function retryAgreementSettlement(id: string) {
  return request<any>(`/agreements/${id}/settlement/retry`, {
    method: 'POST',
  });
}

export async function fetchAgreementComments(id: string) {
  return request<any[]>(`/agreements/${id}/comments`);
}

export async function addAgreementComment(id: string, data: {
  authorAddress: string;
  content: string;
}) {
  return request<any>(`/agreements/${id}/comments`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function proposeAgreementAmendment(id: string, data: {
  proposedBy: string;
  reason?: string;
  title?: string;
  description?: string;
  deadlineAt?: string;
  disputeWindowSecs?: number;
  releaseMode?: string;
  payoutNetwork?: string;
  milestones?: Array<{
    id: string;
    title?: string;
    description?: string;
    sortOrder?: number;
  }>;
}) {
  return request<any>(`/agreements/${id}/amendments`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function respondToAgreementAmendment(id: string, amendmentId: string, data: {
  actorAddress: string;
  accept: boolean;
  responseNote?: string;
}) {
  return request<any>(`/agreements/${id}/amendments/${amendmentId}/respond`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchLogs(agreementId?: string, limit = 100) {
  const params = new URLSearchParams();
  if (agreementId) {
    params.set('agreementId', agreementId);
  }
  params.set('limit', String(limit));
  return request<any[]>(`/logs?${params.toString()}`);
}

export async function fetchPublicLogs(limit = 25) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  return request<any[]>(`/logs/public?${params.toString()}`);
}

export async function fetchAgreementLogs(id: string) {
  return request<any[]>(`/agreements/${id}/logs`);
}

export async function fetchAgreementAuditLogs(id: string, limit = 100) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  return request<any[]>(`/agreements/${id}/audit?${params.toString()}`);
}

export async function fetchMyProfile() {
  return request<any>('/me/profile');
}

export async function updateMyProfile(data: {
  handle?: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  skills?: string[];
  links?: Array<{ label: string; url: string }>;
  visibility?: 'PUBLIC' | 'PRIVATE';
}) {
  return request<any>('/me/profile', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function fetchPublicProfile(handle: string) {
  return performRequest<any>(`/profiles/${handle}`);
}

export async function fetchPublicProfileReputation(handle: string) {
  return performRequest<any>(`/profiles/${handle}/reputation`);
}

export async function fetchPublicProfileActivity(handle: string, limit = 25) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  return performRequest<any>(`/profiles/${handle}/activity?${params.toString()}`);
}

export async function fetchInvites() {
  return request<any[]>('/invites');
}

export async function createInvite(data: {
  createdByAddress: string;
  creatorRole: 'CLIENT' | 'WORKER';
  targetRole: 'CLIENT' | 'WORKER';
  title?: string;
  description?: string;
  expiresAt?: string;
  maxUses?: number;
  agreementTemplate: {
    title: string;
    description: string;
    deadlineAt: string;
    disputeWindowSecs: number;
    proofType: string;
    reviewerMode: string;
    releaseMode: string;
    payoutNetwork: string;
    escrowModel?: string;
    milestones: Array<{
      title: string;
      description: string;
      amount: string;
    }>;
  };
}) {
  return request<any>('/invites', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchInvitePreview(token: string) {
  return performRequest<any>(`/invites/${token}`);
}

export async function acceptInvite(token: string) {
  return request<any>(`/invites/${token}/accept`, {
    method: 'POST',
  });
}

export async function fetchWebhooks() {
  return request<any[]>('/webhooks');
}

export async function createWebhook(data: {
  label?: string;
  targetUrl: string;
  eventTypes: string[];
}) {
  return request<any>('/webhooks', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchWebhookDeliveries(id: string, limit = 50) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  return request<any[]>(`/webhooks/${id}/deliveries?${params.toString()}`);
}

export async function fetchAgreementJobs(id: string, limit = 100) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  return request<any[]>(`/agreements/${id}/jobs?${params.toString()}`);
}

export async function replayAgreementJob(id: string, jobId: string) {
  return request<any>(`/agreements/${id}/jobs/${jobId}/replay`, {
    method: 'POST',
  });
}

export async function fetchConfig() {
  return request<any>('/config');
}

export async function fetchConfigFresh() {
  return performRequest<any>(`/config?ts=${Date.now()}`);
}

export async function fetchHealth() {
  return request<any>('/health');
}

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

type V1Envelope<T> = {
  data?: T;
  pagination?: {
    limit: number;
    cursor: string | null;
  };
  requestId?: string;
  error?: {
    type: string;
    code: string;
    message: string;
    requestId?: string;
  };
};

type V1RequestOptions = RequestInit & {
  apiKey?: string | null;
  authToken?: string | null;
  idempotencyKey?: string;
};

function formatV1Error(path: string, status: number, body: string, parsed: V1Envelope<unknown> | null) {
  if (parsed?.error?.message) {
    const suffix = parsed.error.code ? ` (${parsed.error.code})` : '';
    return `${parsed.error.message}${suffix}`;
  }

  return formatApiError(path, status, body);
}

async function v1Request<T>(path: string, options: V1RequestOptions = {}): Promise<T> {
  const apiKey = Object.prototype.hasOwnProperty.call(options, 'apiKey')
    ? options.apiKey
    : useStore.getState().infrastructureApiKey;
  const authToken = Object.prototype.hasOwnProperty.call(options, 'authToken')
    ? options.authToken
    : useStore.getState().authToken;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string> | undefined) || {}),
  };

  if (apiKey) {
    headers['x-api-key'] = apiKey;
  } else if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  const res = await fetch(`${V1_BASE}${path}`, {
    ...options,
    headers,
  });
  const rawBody = await res.text();
  let parsed: V1Envelope<T> | null = null;

  if (rawBody) {
    try {
      parsed = JSON.parse(rawBody) as V1Envelope<T>;
    } catch {
      throw new Error(formatApiError(path, res.status, rawBody));
    }
  }

  if (!res.ok || parsed?.error) {
    throw new Error(formatV1Error(path, res.status, rawBody, parsed));
  }

  return parsed?.data as T;
}

async function v1ListRequest<T>(path: string, options: V1RequestOptions = {}) {
  const apiKey = Object.prototype.hasOwnProperty.call(options, 'apiKey')
    ? options.apiKey
    : useStore.getState().infrastructureApiKey;
  const authToken = Object.prototype.hasOwnProperty.call(options, 'authToken')
    ? options.authToken
    : useStore.getState().authToken;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string> | undefined) || {}),
  };

  if (apiKey) {
    headers['x-api-key'] = apiKey;
  } else if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const res = await fetch(`${V1_BASE}${path}`, {
    ...options,
    headers,
  });
  const rawBody = await res.text();
  let parsed: V1Envelope<T[]> | null = null;

  if (rawBody) {
    try {
      parsed = JSON.parse(rawBody) as V1Envelope<T[]>;
    } catch {
      throw new Error(formatApiError(path, res.status, rawBody));
    }
  }

  if (!res.ok || parsed?.error) {
    throw new Error(formatV1Error(path, res.status, rawBody, parsed));
  }

  return {
    data: parsed?.data || [],
    pagination: parsed?.pagination || { limit: 20, cursor: null },
    requestId: parsed?.requestId || null,
  };
}

function withQuery(path: string, params: Record<string, string | number | null | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });
  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export function createIdempotencyKey(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export function fetchInfrastructureHealth() {
  return fetch('/health').then(async (res) => {
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error('Health check failed');
    }
    return body;
  });
}

export function fetchInfrastructureReady() {
  return fetch('/ready').then(async (res) => {
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error('Readiness check failed');
    }
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
  return v1Request<any>('/apps', {
    apiKey: null,
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateInfrastructureApp(id: string, data: Record<string, unknown>) {
  return v1Request<any>(`/apps/${id}`, {
    apiKey: null,
    method: 'PATCH',
    body: JSON.stringify(data),
  });
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

export function createInfrastructureApiKey(data: {
  appId: string;
  name: string;
  scopes: string[];
}) {
  return v1Request<any>('/api-keys', {
    apiKey: null,
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function revokeInfrastructureApiKey(id: string) {
  return v1Request<any>(`/api-keys/${id}`, { apiKey: null, method: 'DELETE' });
}

export function fetchInfrastructureAgreements(limit = 25) {
  return v1ListRequest<any>(withQuery('/agreements', { limit }));
}

export function createInfrastructureAgreement(data: Record<string, unknown>, idempotencyKey: string) {
  return v1Request<any>('/agreements', {
    method: 'POST',
    idempotencyKey,
    body: JSON.stringify(data),
  });
}

export function acceptInfrastructureAgreement(id: string) {
  return v1Request<any>(`/agreements/${id}/accept`, { method: 'POST' });
}

export function moveInfrastructureAgreementToFundingRequired(id: string) {
  return v1Request<any>(`/agreements/${id}/funding-required`, { method: 'POST' });
}

export function fetchInfrastructureMilestones(limit = 50) {
  return v1ListRequest<any>(withQuery('/milestones', { limit }));
}

export function createInfrastructureMilestone(agreementId: string, data: Record<string, unknown>) {
  return v1Request<any>(`/agreements/${agreementId}/milestones`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function fetchInfrastructureEscrows(limit = 50) {
  return v1ListRequest<any>(withQuery('/escrows', { limit }));
}

export function createInfrastructureEscrow(data: Record<string, unknown>, idempotencyKey: string) {
  return v1Request<any>('/escrows', {
    method: 'POST',
    idempotencyKey,
    body: JSON.stringify(data),
  });
}

export function markInfrastructureEscrowFunded(id: string, txHash?: string) {
  return v1Request<any>(`/escrows/${id}/mark-funded`, {
    method: 'POST',
    body: JSON.stringify(txHash ? { txHash } : {}),
  });
}

export function releaseInfrastructureEscrow(id: string, idempotencyKey: string) {
  return v1Request<any>(`/escrows/${id}/release`, {
    method: 'POST',
    idempotencyKey,
    body: JSON.stringify({}),
  });
}

export function refundInfrastructureEscrow(id: string, idempotencyKey: string) {
  return v1Request<any>(`/escrows/${id}/refund`, {
    method: 'POST',
    idempotencyKey,
    body: JSON.stringify({}),
  });
}

export function fetchInfrastructureProofs(limit = 50) {
  return v1ListRequest<any>(withQuery('/proofs', { limit }));
}

export function createInfrastructureProof(data: Record<string, unknown>, idempotencyKey: string) {
  return v1Request<any>('/proofs', {
    method: 'POST',
    idempotencyKey,
    body: JSON.stringify(data),
  });
}

export function reviewInfrastructureProof(id: string, data: Record<string, unknown>) {
  return v1Request<any>(`/proofs/${id}/review`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
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
  return v1Request<any>('/webhook-endpoints', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateInfrastructureWebhookEndpoint(id: string, data: Record<string, unknown>) {
  return v1Request<any>(`/webhook-endpoints/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
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

export function fetchInfrastructureAdminList(kind: 'apps' | 'agreements' | 'escrows' | 'events' | 'webhook-deliveries' | 'audit-logs', limit = 25) {
  return v1ListRequest<any>(withQuery(`/admin/${kind}`, { limit }), { apiKey: null });
}
