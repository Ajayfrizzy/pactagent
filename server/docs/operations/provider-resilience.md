# External provider resilience

Active outbound calls use `src/common/resilience/provider.ts` for deadlines, bounded jittered retry, concurrency limits, circuit breaking, request IDs, structured failure classification, and Prometheus metrics.

| Provider | Policy |
| --- | --- |
| Webhook delivery | One HTTP attempt per durable job; job retry/dead-letter policy owns subsequent attempts |
| CKB readiness RPC | One bounded idempotent read when settlement readiness is required |

HTTP 408, 425, 429, and 5xx responses are retryable. Authentication, validation, and most other 4xx responses are permanent. DNS/connectivity failures, resets, refused connections, unreachable networks, and timeouts are retryable transport failures. Unclassified application exceptions are permanent to avoid programming-defect retry storms.

Alert on `pactagent_provider_circuit_open == 1`, provider failures, and provider latency. The CKB escrow adapter is not an active outbound provider until Phase 2 implements and tests it.
