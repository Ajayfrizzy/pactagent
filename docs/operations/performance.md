# Performance policy

All externally reachable collections use cursor pagination with a maximum page size of 100. Large retention and administrative operations use bounded batches rather than loading unbounded relation graphs.

API responses default to `Cache-Control: no-store`. Static documentation has a short public cache lifetime, OpenAPI JSON supports gzip, and endpoint-specific body ceilings protect write paths.

The webhook worker claims durable `AgentJob` rows with `FOR UPDATE SKIP LOCKED`, bounded concurrency, renewable leases, and retry backoff. Monitor worker heartbeat age, job execution duration, dead-letter count, and oldest queued-job age before changing capacity.

CI executes `server/prisma/performance-query-plans.sql` with `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` and uploads measured plans. Staging promotion runs API, queue, and webhook k6 profiles with committed p95 and error-rate thresholds.
