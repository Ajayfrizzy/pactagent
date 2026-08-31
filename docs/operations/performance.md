# Performance policy

All externally reachable collections use cursor pagination with a maximum page size of 100. Large retention and administrative operations use bounded batches rather than loading unbounded relation graphs.

API responses default to `Cache-Control: no-store`. Static documentation has a short public cache lifetime, OpenAPI JSON supports gzip, and endpoint-specific body ceilings protect write paths.

The infrastructure worker claims webhook and settlement `AgentJob` rows with `FOR UPDATE SKIP LOCKED`, bounded concurrency, renewable leases, and retry backoff. Monitor worker heartbeat age, queue-specific job duration, dead letters, oldest queued-job age, and CKB reconciliation backlog before changing capacity.

CI executes `server/prisma/performance-query-plans.sql` with `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` and uploads measured plans. Staging promotion runs API, queue, and webhook k6 profiles with committed p95 and error-rate thresholds.
