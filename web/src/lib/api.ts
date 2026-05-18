import { useStore } from './store';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '/api';

const inflightGetRequests = new Map<string, Promise<unknown>>();
const responseCache = new Map<string, { expiresAt: number; value: unknown }>();

type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: string;
};

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
    return 60_000;
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
      throw new Error(rawBody || `API request failed with status ${res.status}`);
    }
  }

  if (!res.ok || !data?.success) {
    throw new Error(data?.error || rawBody || 'API request failed');
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
  workerFiberPubkey?: string;
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
    workerFiberPubkey?: string;
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

export async function importCkboostAgreement(data: {
  campaign: {
    id: string;
    title: string;
    url: string;
    description?: string;
    sponsorName?: string;
    governanceThreadUrl?: string;
    questBundleTitle?: string;
    proofExternalId?: string;
    approvedProofSummary?: string;
    approvedProofUrl?: string;
  };
  sponsor?: {
    walletAddress?: string;
    displayName?: string;
  };
  contributor: {
    profileId?: string;
    contributorExternalId?: string;
    walletAddress: string;
    handle?: string;
    displayName?: string;
    profileUrl?: string;
    campaignParticipationCount?: number;
    approvedSubmissionCount?: number;
    rejectedSubmissionCount?: number;
    approvalRate?: number;
    leaderboardRank?: number;
    totalPoints?: number;
    totalTipsReceived?: string;
    campaignHistory?: string[];
    stats?: Record<string, unknown>;
  };
  agreement: {
    title: string;
    description: string;
    clientAddress: string;
    createdByAddress?: string;
    deadlineAt: string;
    disputeWindowSecs: number;
    proofType: 'URL' | 'TEXT' | 'FILE_HASH';
    payoutNetwork: 'CKB' | 'FIBER';
    escrowModel?: 'TREASURY_BRIDGE' | 'ONCHAIN_LOCK';
    workerFiberPubkey?: string;
    milestones: Array<{
      title: string;
      description: string;
      amount: string;
    }>;
  };
}) {
  return request<any>('/integrations/ckboost/import', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchCkboostCampaignAutofill(data: {
  campaignLink: string;
}) {
  return request<{
    campaignId: string;
    campaignUrl: string;
    campaignTitle: string;
    campaignDescription: string;
    questBundleTitle?: string;
    agreementTitle: string;
    agreementDescription: string;
    governanceThreadUrl?: string;
    sponsorName?: string;
    rules: string[];
    milestones: Array<{
      title: string;
      description: string;
      amountCkb: string;
    }>;
    stats: {
      participantsCount: number;
      totalCompletions: number;
      questCount: number;
      totalPoints: number;
      startsAt?: string;
      endsAt?: string;
    };
  }>('/integrations/ckboost/autofill', {
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
  workerFiberPubkey?: string;
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
    body: JSON.stringify({ txHash, milestoneOutputs, commencementOutputIndex }),
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
  workerFiberPubkey?: string;
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
  fiberPubkey?: string;
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
    workerFiberPubkey?: string;
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

export async function fetchFiberAdminHealth() {
  return request<any>('/fiber/health');
}

export async function fetchFiberAdminInfo() {
  return request<any>('/fiber/info');
}

export async function fetchFiberAdminChannels() {
  return request<any>('/fiber/channels');
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
