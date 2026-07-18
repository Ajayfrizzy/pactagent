# Resilience Operations

## Database

Use a managed PostgreSQL service with automated backups, point-in-time recovery, and a tested restore procedure. `DB_POOL_MAX` applies per process, so keep the sum of API and worker pools below the database or external pooler's connection limit. Start with 10 per process, monitor `pactagent_db_pool_connections{state="waiting"}`, and increase only when the database has capacity.

Keep statement and query timeouts finite. Alerts should cover connection errors, non-zero waiting connections sustained for five minutes, storage capacity, replication lag, and failed backups. Test a restore into an isolated database at least quarterly.

## Distributed Rate Limits

API replicas share limits through `REDIS_URL`. Production fails closed if Redis is unavailable, preventing an outage from silently disabling abuse controls. Run Redis as a managed, highly available service for production. The Compose Redis service is intended for local or single-host deployments only.

Set `TRUST_PROXY_HOPS` to the exact number of trusted reverse proxies between the client and API. Leave it at zero when the service is directly exposed; an incorrect value permits spoofed client IPs.

## Idempotency

Completed keys are retained for `IDEMPOTENCY_RETENTION_MS`; in-progress reservations can be reclaimed after `IDEMPOTENCY_PROCESSING_LEASE_MS`. The worker deletes expired rows every ten minutes. Responses larger than `IDEMPOTENCY_MAX_RESPONSE_BYTES` are rejected rather than growing the database without a bound.

Use a retention period longer than the maximum client retry window. Monitor table size and stale processing records.

## WebSockets

JWTs are sent through the `Sec-WebSocket-Protocol` header and must never be placed in URLs. Invalid credentials are rejected instead of being downgraded to public access. The server enforces configured origins, global and per-IP connection limits, maximum message size, heartbeat termination, and buffered-output limits.

Production `CORS_ORIGIN` must list every allowed browser origin. When operating behind a proxy, ensure it forwards WebSocket upgrades and preserves `Sec-WebSocket-Protocol`.
