import { randomUUID } from 'crypto';
import { Counter, Gauge, Histogram } from 'prom-client';
import { metricsRegistry } from '../observability/metrics';
import { log } from '../observability/logger';

export type ProviderName = 'ckb' | 'ai' | 'market_price' | 'forum' | 'webhook' | 'treasury_signer';

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: ProviderName,
    readonly retryable: boolean,
    readonly requestId: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message);
    if (options?.cause !== undefined) (this as Error & { cause?: unknown }).cause = options.cause;
    this.name = 'ProviderError';
  }
}

const requests = new Counter({
  name: 'pactagent_provider_requests_total',
  help: 'Outbound provider requests by provider and outcome.',
  labelNames: ['provider', 'outcome'] as const,
  registers: [metricsRegistry],
});
const duration = new Histogram({
  name: 'pactagent_provider_request_duration_seconds',
  help: 'Outbound provider request duration.',
  labelNames: ['provider'] as const,
  registers: [metricsRegistry],
});
const circuitState = new Gauge({
  name: 'pactagent_provider_circuit_open',
  help: 'Whether a provider circuit is open.',
  labelNames: ['provider'] as const,
  registers: [metricsRegistry],
});
const active = new Gauge({
  name: 'pactagent_provider_active_requests',
  help: 'Active requests by provider.',
  labelNames: ['provider'] as const,
  registers: [metricsRegistry],
});

type State = { failures: number; openUntil: number; active: number; waiters: Array<() => void> };
const states = new Map<ProviderName, State>();
function stateFor(provider: ProviderName) {
  let state = states.get(provider);
  if (!state) {
    state = { failures: 0, openUntil: 0, active: 0, waiters: [] };
    states.set(provider, state);
  }
  return state;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function retryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function classifyProviderFailure(cause: unknown) {
  if (cause instanceof ProviderError) return { retryable: cause.retryable, status: cause.status };
  if (cause instanceof DOMException && ['TimeoutError', 'AbortError'].includes(cause.name)) return { retryable: true, status: undefined };
  if (cause instanceof TypeError) return { retryable: true, status: undefined };
  const code = typeof cause === 'object' && cause && 'code' in cause ? String((cause as { code?: unknown }).code) : '';
  return { retryable: ['ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code), status: undefined };
}

async function acquire(provider: ProviderName, concurrency: number) {
  const state = stateFor(provider);
  if (state.active >= concurrency) await new Promise<void>((resolve) => state.waiters.push(resolve));
  state.active += 1;
  active.set({ provider }, state.active);
  return () => {
    state.active -= 1;
    active.set({ provider }, state.active);
    state.waiters.shift()?.();
  };
}

export async function executeProviderRequest<T>(params: {
  provider: ProviderName;
  operation: string;
  run: (context: { signal: AbortSignal; requestId: string; attempt: number }) => Promise<T>;
  timeoutMs: number;
  maxAttempts?: number;
  concurrency?: number;
  failureThreshold?: number;
  circuitResetMs?: number;
  correlation?: Record<string, unknown>;
}): Promise<T> {
  const state = stateFor(params.provider);
  const now = Date.now();
  if (state.openUntil > now) {
    circuitState.set({ provider: params.provider }, 1);
    throw new ProviderError('Provider circuit is open.', params.provider, true, randomUUID());
  }
  if (state.openUntil) {
    state.openUntil = 0;
    circuitState.set({ provider: params.provider }, 0);
  }

  const release = await acquire(params.provider, params.concurrency ?? 10);
  const requestId = randomUUID();
  const attempts = params.maxAttempts ?? 3;
  const startedAt = process.hrtime.bigint();
  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const result = await params.run({ signal: AbortSignal.timeout(params.timeoutMs), requestId, attempt });
        state.failures = 0;
        requests.inc({ provider: params.provider, outcome: 'success' });
        return result;
      } catch (cause) {
        const { status, retryable } = classifyProviderFailure(cause);
        if (!retryable || attempt === attempts) {
          state.failures += 1;
          if (state.failures >= (params.failureThreshold ?? 5)) {
            state.openUntil = Date.now() + (params.circuitResetMs ?? 30_000);
            circuitState.set({ provider: params.provider }, 1);
          }
          requests.inc({ provider: params.provider, outcome: 'failure' });
          log('warn', 'provider.request.failed', {
            ...params.correlation,
            provider: params.provider, operation: params.operation, providerRequestId: requestId,
            attempt, retryable, status, error: cause,
          });
          throw cause instanceof ProviderError
            ? cause
            : new ProviderError('Provider request failed.', params.provider, retryable, requestId, status, { cause });
        }
        requests.inc({ provider: params.provider, outcome: 'retry' });
        const jitteredDelay = Math.min(2_000, 100 * (2 ** (attempt - 1))) * (0.5 + Math.random());
        await sleep(jitteredDelay);
      }
    }
    throw new ProviderError('Provider attempts exhausted.', params.provider, true, requestId);
  } finally {
    duration.observe({ provider: params.provider }, Number(process.hrtime.bigint() - startedAt) / 1e9);
    release();
  }
}

export function assertProviderResponse(response: Response, provider: ProviderName, requestId: string) {
  if (!response.ok) {
    throw new ProviderError(
      `${provider} responded with status ${response.status}.`,
      provider,
      retryableStatus(response.status),
      response.headers.get('x-request-id') || requestId,
      response.status,
    );
  }
}
