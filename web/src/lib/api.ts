import { useStore } from './store';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '/api';

type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: string;
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
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
  return request<{ token: string; address: string; expiresAt: string }>('/auth/verify', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchCurrentSession() {
  return request<{ address: string; issuedAt: number; expiresAt: number }>('/auth/me');
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

export async function fundAgreement(id: string, txHash: string) {
  return request<any>(`/agreements/${id}/fund`, {
    method: 'POST',
    body: JSON.stringify({ txHash }),
  });
}

export async function submitProof(id: string, data: {
  milestoneId: string;
  proofType: string;
  content: string;
  contentHash?: string;
}) {
  return request<any>(`/agreements/${id}/submit-proof`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function openDispute(id: string, data: {
  milestoneId: string;
  openedBy: string;
  reason: string;
  evidenceNotes?: string;
}) {
  return request<any>(`/agreements/${id}/open-dispute`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function reviewAction(id: string, action: string, reviewerAddress: string) {
  return request<any>(`/agreements/${id}/review-action`, {
    method: 'POST',
    body: JSON.stringify({ action, reviewerAddress }),
  });
}

export async function getDisputeRecommendation(id: string) {
  return request<any>(`/agreements/${id}/dispute/recommendation`, {
    method: 'POST',
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

export async function fetchConfig() {
  return request<any>('/config');
}

export async function fetchHealth() {
  return request<any>('/health');
}
