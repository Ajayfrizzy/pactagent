# Integrator Changelog

## Unreleased

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
