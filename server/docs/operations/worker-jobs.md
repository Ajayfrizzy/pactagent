# Worker jobs

## Queue roles

Run workers with one or more comma-separated `WORKER_QUEUES` values: `settlement`, `webhook`, or `ai`. The production Compose definition runs each role separately so slow provider or AI work cannot consume settlement capacity. `WORKER_CONCURRENCY` is bounded from 1 to 32.

Only a worker serving the `settlement` queue schedules system jobs and performs idempotency cleanup. All roles share the same durable PostgreSQL queue.

## Claims, leases, and deadlines

Workers claim jobs atomically with `FOR UPDATE SKIP LOCKED`. A claim records the worker ID and a renewable expiry. Completion, failure, and renewal require the same worker ID, so a process that has lost its lease cannot commit a later result.

Set `JOB_LEASE_MS` longer than normal database jitter and shorter than the desired crash-recovery interval. The worker renews at one third of that interval. Set `JOB_TIMEOUT_MS` longer than the lease and within the provider's operational limit. Deadline cancellation is cooperative; provider requests retain their own timeouts, and settlement operation keys prevent an uncertain transfer from being blindly sent again.

Retries use exponential backoff with bounded jitter and become `DEAD_LETTER` after `maxAttempts`. Expired leases are returned to `RETRY` and can be claimed by another worker.

## Shutdown and recovery

On `SIGTERM` or `SIGINT`, a worker stops polling and waits for the current cycle up to `SHUTDOWN_TIMEOUT_MS`. Configure the platform termination grace period above that value. If the process is forcibly terminated, its in-flight jobs become recoverable after lease expiry.

Before scaling replacement workers, verify that the old instance has stopped renewing leases. Watch worker heartbeat age, dead-letter count, and oldest queued-job age while capacity changes.

## Dead-letter replay

Infrastructure administrators can list jobs with `GET /v1/admin/jobs` and replay an eligible terminal job with `POST /v1/admin/jobs/:id/replay`. Replay is authenticated, rate limited, creates a new queued job, and writes an audit entry linking the original and replayed job IDs.

Fix and verify the underlying failure before replay. For settlement work, independently reconcile the chain first. Never replay an operation whose provider outcome is uncertain.
