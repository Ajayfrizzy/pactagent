# Performance policy

All externally reachable collections use cursor pagination with a maximum page size of 100. Legacy development-only collections preserve their response shape but are capped; staging and production disable those routes. Large historical computations should use database aggregates or bounded batches rather than loading an unbounded relation graph.

The worker performs a resumable initial sweep in 200-row pages, then schedules only records changed since the completed sweep, near-deadline records, and unsettled records. Deadline reminders are durable `AgentJob` rows with future `availableAt` values. Scheduler indexes correspond to these filters; inspect them with `EXPLAIN (ANALYZE, BUFFERS)` using staging-sized data and record query latency before removing or adding indexes.

API responses default to `Cache-Control: no-store`. Only static documentation and the non-secret capability response have short public cache lifetimes. OpenAPI JSON supports gzip. Endpoint-specific body ceilings protect common write paths while the global parser limit remains an emergency upper bound.

CI executes `server/prisma/performance-query-plans.sql` with `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` and uploads the measured plans. The release engineer compares total execution time, row-estimate error, sequential scans, and buffer growth before accepting a critical-query change. Abort the release when a critical path loses its intended index or exceeds the staging baseline without an approved exception.

Staging promotion runs the API, queue, and webhook k6 profiles. Their committed p95 and error-rate thresholds are release gates. The queue profile also proves concurrent idempotent replay returns the original agreement. The performance owner may change thresholds only with recorded before/after evidence and a capacity justification.
