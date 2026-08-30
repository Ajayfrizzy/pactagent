# Infrastructure worker jobs

`AgentJob` is app-scoped and accepts `DELIVER_WEBHOOK` on `webhook` and `CKB_RECONCILE_TRANSACTION` on `settlement`. Run the general worker with `WORKER_QUEUES=webhook,settlement`; `WORKER_CONCURRENCY` is bounded from 1 to 32. A unique active dedupe key prevents concurrent enqueue from creating duplicate reconciliation jobs.

Workers claim jobs atomically with `FOR UPDATE SKIP LOCKED`. Claims record a worker ID and renewable lease. Completion, failure, and lease renewal require the same worker ID, so a process that lost its lease cannot later commit a result.

Failures use exponential backoff with bounded jitter and become `DEAD_LETTER` after `maxAttempts`. Expired leases return to `RETRY`. A healthy CKB transaction below final observation depth is lease-safely deferred by `CKB_RECONCILIATION_POLL_MS` without being counted as a job failure; ambiguous/reorg state remains explicit in the transaction and escrow records. The worker also releases stale locks, refreshes reconciliation metrics, and periodically removes expired idempotency records.

On `SIGTERM` or `SIGINT`, polling stops and the current cycle drains up to `SHUTDOWN_TIMEOUT_MS`. Configure platform termination grace above that value.

Infrastructure administrators can list jobs with `GET /v1/admin/jobs` and replay an eligible terminal job with `POST /v1/admin/jobs/:id/replay`. Fix the underlying delivery failure before replay and verify the endpoint will tolerate duplicate event receipt.
