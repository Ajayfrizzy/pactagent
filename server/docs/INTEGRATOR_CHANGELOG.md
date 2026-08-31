# Integrator Changelog

## Unreleased

### Phase 2 infrastructure hardening

- Agreement, milestone, proof, dispute, and escrow lifecycle writes now use compare-and-swap transitions; stale concurrent actions return `409` instead of overwriting newer state.
- `Idempotency-Key` is now required for agreement create/actions, milestone create, proof submit/review, dispute create/resolve, and escrow create/fund/release/refund.
- Milestone allocation is serialized on the parent agreement. Active escrow and unresolved dispute scopes are database-unique, and split resolution must equal the funded amount exactly.
- Cross-resource app ownership is enforced with composite foreign keys and non-enumerating relationship failures.
- Wallet challenges are shared, TTL-bound, and atomically consumed through Redis in deployed API processes.
- CKB funding can no longer be asserted by the client. When explicitly enabled for development testnet, the service verifies the persisted lock script, cell data, amount, transaction state, and confirmation depth.
- CKB release/refund use reserve/broadcast/finalize semantics. Ambiguous broadcasts and reorgs surface as `reconciliation_required`; `failed` and `reconciliation_required` both block replacement escrow creation until reconciliation establishes a safe state.
- The CKB rail remains disabled by default and is not mainnet-ready; deployed external signing is not implemented.

- `/v1` is the only supported infrastructure lifecycle API; every legacy `/api/*` path now returns `410 Gone`.
- Operator wallet authentication moved from `/api/auth` to `/v1/auth` and now uses the standard `/v1` response envelope.
- Public profiles, reputation, invitations, forum/bounty imports, product comments, WebSocket updates, Fiber payout behavior, and product-only agreement fields were removed.
- API keys, generic external participant/reference metadata, app-scoped lifecycle resources, proof reviews, webhooks, audit logs, idempotency, and the CKB settlement boundary remain supported.
- Distributed rate limits now return standard limit and retry headers.
- Idempotency records have a bounded processing lease, retention period, and response size.
- `/v1` OpenAPI changes are now checked for removed operations in CI.
- Collection endpoints use deterministic cursor pagination with a maximum page size of 100.
- Rate limits are independently enforced by IP, API key, tenant, and high-risk action class.
- Webhook delivery retries, durable jobs, and settlement operations have bounded idempotent recovery behavior.
- Production releases use immutable container digests, migration-first rollout, readiness gates, and automated application rollback.
- Retention periods and idempotency replay behavior are documented as operational API guarantees.

### Phase 1 cleanup migration

- Announcement date: 2026-08-22
- Deprecation date: 2026-08-22
- Sunset date: 2026-08-22
- Migration: move operator auth calls to `/v1/auth`, replace every legacy lifecycle call with its OpenAPI-documented `/v1` equivalent, and move product-specific UI or integration behavior into the integrating application.

Breaking changes must include migration instructions, announcement date, deprecation date, and sunset date.
