# Webhook worker jobs

`AgentJob` is app-scoped and currently accepts one kind: `DELIVER_WEBHOOK` on the `webhook` queue. Run workers with `WORKER_QUEUES=webhook`; `WORKER_CONCURRENCY` is bounded from 1 to 32.

Workers claim jobs atomically with `FOR UPDATE SKIP LOCKED`. Claims record a worker ID and renewable lease. Completion, failure, and lease renewal require the same worker ID, so a process that lost its lease cannot later commit a result.

Retries use exponential backoff with bounded jitter and become `DEAD_LETTER` after `maxAttempts`. Expired leases return to `RETRY`. The worker also releases stale locks and periodically removes expired idempotency records.

On `SIGTERM` or `SIGINT`, polling stops and the current cycle drains up to `SHUTDOWN_TIMEOUT_MS`. Configure platform termination grace above that value.

Infrastructure administrators can list jobs with `GET /v1/admin/jobs` and replay an eligible terminal job with `POST /v1/admin/jobs/:id/replay`. Fix the underlying delivery failure before replay and verify the endpoint will tolerate duplicate event receipt.
