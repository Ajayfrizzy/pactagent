# Operations and observability

## Process lifecycle

The API and worker handle `SIGTERM` and `SIGINT`. Readiness changes before drain, the API closes HTTP connections, and the worker stops polling before waiting for its current cycle. Both disconnect Prisma before exit. `SHUTDOWN_TIMEOUT_MS` bounds the drain.

Set the container termination grace period higher than `SHUTDOWN_TIMEOUT_MS` (for example, 45 seconds for a 30-second application timeout). Do not send `SIGKILL` unless the bounded shutdown has failed.

## Worker readiness

Each worker persists a heartbeat in `WorkerHeartbeat`. Set `WORKER_ID` to the platform instance identity or pod name; otherwise the hostname is used. Production readiness requires a fresh heartbeat by default. Configure:

```env
WORKER_HEARTBEAT_STALE_MS=30000
REQUIRE_WORKER_READY=true
```

`GET /ready` reports heartbeat age, last-cycle time and duration, queued jobs, dead letters, and oldest available job age.

## Metrics

Prometheus metrics are served at `GET /metrics`. Production requires a bearer token supplied through `METRICS_BEARER_TOKEN` or, preferably, `METRICS_BEARER_TOKEN_FILE`:

```http
Authorization: Bearer <metrics-token>
```

Important series include:

- `pactagent_http_requests_total`
- `pactagent_http_request_duration_seconds`
- `pactagent_worker_heartbeat_age_seconds`
- `pactagent_worker_cycles_total`
- `pactagent_jobs_queued`
- `pactagent_jobs_dead_letter_total`
- `pactagent_oldest_queued_job_age_seconds`
- `pactagent_db_pool_saturation_ratio`
- `pactagent_job_execution_duration_seconds`
- `pactagent_job_lease_renewals_total`
- `pactagent_job_retries_total`
- `pactagent_provider_request_duration_seconds`
- `pactagent_lifecycle_transition_conflicts_total`
- `pactagent_idempotency_conflicts_total`
- `pactagent_financial_invariant_rejections_total`
- `pactagent_active_scope_conflicts_total`
- `pactagent_auth_challenge_failures_total`
- `pactagent_ckb_rpc_duration_seconds`
- `pactagent_ckb_rpc_errors_total`
- `pactagent_ckb_broadcast_failures_total`
- `pactagent_ckb_reconciliation_backlog`
- `pactagent_ckb_stale_transactions`
- `pactagent_ckb_reorgs_total`

Recommended initial alerts:

- Worker heartbeat age exceeds `WORKER_HEARTBEAT_STALE_MS` for two evaluation periods.
- Dead-letter jobs are greater than zero for five minutes.
- Oldest queued job age exceeds the workflow's expected processing objective.
- HTTP 5xx ratio exceeds 2% for ten minutes.
- P95 HTTP latency exceeds the service objective for ten minutes.
- Process restarts or readiness failures repeat during a deployment.
- CKB reconciliation-required/reorg counts are nonzero or pending transactions exceed `CKB_STALE_TRANSACTION_MS`.

## Logs and build identity

API and worker runtime logs are JSON and include timestamp, level, event, service, and environment. Request completion logs include request ID, method, path, status, duration, app ID, and API-key ID. Sensitive fields and common credential values are redacted.

Lifecycle and failure logs carry the applicable `appId`, `agreementId`, `milestoneId`, `transactionId`, `settlementId`, `deliveryId`, `jobId`, and `providerRequestId`. The logger adds active `traceId` and `spanId` automatically. IDs remain in logs and traces only and are intentionally excluded from metric labels.

Set `BUILD_VERSION` and `BUILD_COMMIT` from the immutable release/image metadata. `/health` and `/ready` expose them for deployment correlation.

## Distributed tracing

OpenTelemetry auto-instruments inbound/outbound HTTP, Express, PostgreSQL, and supported runtime libraries. Export is disabled unless an OTLP endpoint is configured:

```env
OTEL_SERVICE_NAME=pactagent-api
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel-collector.internal
OTEL_EXPORTER_OTLP_HEADERS_FILE=/run/secrets/otel-headers
```

Use a distinct `OTEL_SERVICE_NAME` for the worker. Request logs include the active trace and span IDs. Place the collector on a private network and apply sampling/retention controls there.

The version-controlled collector configuration is `observability/otel-collector.yaml`. It receives OTLP traces, scrapes API and worker metrics, applies memory limiting, resource enrichment and batching, exposes metrics for Prometheus, and forwards traces to the configured OTLP backend.

Set `SERVICE_ROLE=api` on API replicas and `SERVICE_ROLE=worker` on workers. Production validation then enforces JWT and metrics credentials only for the API; the worker does not need access to those secrets.

## Financial precision

Agreement, milestone, escrow, and transaction amounts are positive integer strings. Dispute split shares are non-negative integer strings whose sum must equal the funded scope. CKB values are denominated in shannon. API consumers must use integer arithmetic and must not convert settlement amounts through binary floating point.
