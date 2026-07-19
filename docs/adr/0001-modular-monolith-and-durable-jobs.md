# ADR 0001: Modular monolith with durable PostgreSQL jobs

- Status: accepted
- Date: 2026-07-19
- Owners: API and Data owners

## Context

Agreement state transitions and settlement reconciliation need transactional consistency. Splitting them across services would add distributed transaction and delivery complexity before independent scaling is justified.

## Decision

Keep the API and worker in one TypeScript codebase but separate runtime processes. PostgreSQL is the system of record and `AgentJob` is the durable work queue. Workers use atomic claims, bounded retries, dead letters, heartbeat reporting, and stale-lock recovery. Deadline work is stored in `availableAt` rather than discovered by continuous full scans.

## Consequences

API and worker deploy from the same artifact. Database availability is required for progress. Queue throughput can scale with worker replicas, while schema changes require coordinated migrations.
