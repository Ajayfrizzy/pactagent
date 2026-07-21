# ADR 0004: Database tenant enforcement without row-level security

- Status: Accepted
- Date: 2026-07-20

## Context

Infrastructure resources duplicate `appId` so tenant filtering is efficient, but a single-column parent foreign key does not prove that the child and parent belong to the same app. API-key authentication also needs to establish one mandatory tenant context before repository access.

PostgreSQL row-level security was considered as an additional defense. PactAgent currently uses one application database role for API, worker, migrations, administrative operations, and legacy product code. Enabling RLS with that role structure would either break trusted worker operations or require broad bypass privileges that substantially reduce the value of the policies.

## Decision

Use compound `(id, appId)` foreign keys for every core `/v1` ownership relationship. Infrastructure repositories accept a branded `TenantContext`; API-key middleware creates that context after successful authentication and attaches it to the request. Administrative and background operations that intentionally cross tenants remain separate and must log the resolved `appId`.

Do not enable RLS in this phase. Reconsider it when API, worker, migration, and administration use separate least-privilege database roles and the connection pool can set a transaction-local tenant identifier safely.

## Consequences

- PostgreSQL rejects cross-app references even if application validation is bypassed.
- Repository call sites cannot pass an arbitrary resource ID without deliberately constructing tenant context.
- Legacy nullable webhook rows remain supported; compound foreign keys enforce ownership whenever `appId` is present.
- RLS remains a future defense-in-depth control, not a claimed production guarantee.
- The read-only tenant-integrity audit must pass before constraint migrations are deployed.
