# External Provider Resilience

Active outbound providers use the shared executor in `src/common/resilience/provider.ts`. It applies response deadlines, bounded exponential retry with jitter, per-provider concurrency limits, circuit breaking, request IDs, structured error classification, and Prometheus metrics.

| Provider | Timeout | Attempts | Fallback |
| --- | ---: | ---: | --- |
| CKB RPC reads | 15s | 3 | Queue/retry settlement; never infer confirmation |
| AI structured output | configured `AI_TIMEOUT_MS` | 2 | Existing deterministic/manual-review path |
| Market price | 8s | 3 | Last cached quote; block conversion if no quote exists |
| Forum publish | configured forum timeout | 1 | Persist job failure for operator retry; avoids duplicate posts |
| Webhook delivery | configured webhook timeout | 1 per job | Existing jittered delivery schedule and dead letter |
| Managed treasury signer | 30s | 1 | Mark attempt uncertain and reconcile before retry |

HTTP 408, 425, 429, and 5xx responses are retryable. Authentication, validation, and most other 4xx responses are permanent. Timeouts are retryable only for idempotent operations. Non-idempotent publishing and signing are single-attempt and require reconciliation.

DNS/connectivity failures, connection resets, refused connections, unreachable networks, and timeouts are classified as retryable transport failures. Unclassified application exceptions are permanent so programming defects do not create retry storms. Unit tests enforce this classification contract.

Alert on `pactagent_provider_circuit_open == 1`, elevated `pactagent_provider_requests_total{outcome="failure"}`, and provider latency. `providerRequestId` is included in structured failure logs and forwarded where supported.

Fiber is not an active provider. Do not restore it by environment configuration alone; reintroduction requires a reviewed adapter, the same provider policy, and new compatibility tests.
