# Integrator Changelog

## Unreleased

- WebSocket authentication moved from URL query parameters to `Sec-WebSocket-Protocol`.
- Distributed rate limits now return standard limit and retry headers.
- Idempotency records have a bounded processing lease, retention period, and response size.
- `/v1` OpenAPI changes are now checked for removed operations in CI.
- Collection endpoints use deterministic cursor pagination with a maximum page size of 100.
- Rate limits are independently enforced by IP, API key, tenant, and high-risk action class.
- Webhook delivery retries, durable jobs, and settlement operations have bounded idempotent recovery behavior.
- Production releases use immutable container digests, migration-first rollout, readiness gates, and automated application rollback.
- Retention periods and idempotency replay behavior are documented as operational API guarantees.

Breaking changes must include migration instructions, announcement date, deprecation date, and sunset date.
