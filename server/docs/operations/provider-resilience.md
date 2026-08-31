# External provider resilience

Active outbound calls use `src/common/resilience/provider.ts` for deadlines, bounded jittered retry, concurrency limits, circuit breaking, request IDs, structured failure classification, and Prometheus metrics.

| Provider | Policy |
| --- | --- |
| Webhook delivery | One HTTP attempt per durable job; job retry/dead-letter policy owns subsequent attempts |
| CKB readiness RPC | One bounded idempotent node read and one indexer read when settlement readiness is required |
| CKB transaction observation | Durable reconciliation job owns repeated idempotent reads |
| CKB broadcast | No blind provider retry; persist the deterministic expected hash and reconcile an ambiguous result |

HTTP 408, 425, 429, and 5xx responses are retryable. Authentication, validation, and most other 4xx responses are permanent. DNS/connectivity failures, resets, refused connections, unreachable networks, and timeouts are retryable transport failures. Unclassified application exceptions are permanent to avoid programming-defect retry storms.

Alert on provider failures/latency, CKB RPC errors, broadcast ambiguity, reconciliation backlog, stale CKB transactions, and reorgs. Provider retries never own domain lifecycle transitions; successful state changes remain CAS-guarded in PostgreSQL.
