# Performance policy

All externally reachable collections use cursor pagination with a maximum page size of 100. Legacy development-only collections preserve their response shape but are capped; staging and production disable those routes. Large historical computations should use database aggregates or bounded batches rather than loading an unbounded relation graph.

The worker performs a resumable initial sweep in 200-row pages, then schedules only records changed since the completed sweep, near-deadline records, and unsettled records. Deadline reminders are durable `AgentJob` rows with future `availableAt` values. Scheduler indexes correspond to these filters; inspect them with `EXPLAIN (ANALYZE, BUFFERS)` using staging-sized data and record query latency before removing or adding indexes.

API responses default to `Cache-Control: no-store`. Only static documentation and the non-secret capability response have short public cache lifetimes. OpenAPI JSON supports gzip. Endpoint-specific body ceilings protect common write paths while the global parser limit remains an emergency upper bound.
