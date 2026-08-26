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

## Browser origins

Production `CORS_ORIGIN` must list every allowed browser origin. The infrastructure server has no WebSocket surface; lifecycle consumers receive events through durable signed webhooks.

## Controlled webhook egress

Staging and production require `WEBHOOK_EGRESS_PROXY_URL`. HTTP webhook requests use absolute-form proxy requests; HTTPS uses CONNECT to the DNS-validated IP while preserving the original hostname for TLS verification. Every redirect is shape-checked, resolved again, rejected if any answer is blocked, and pinned to an approved address. Configure the proxy itself to deny private, link-local, loopback, metadata, multicast, and internal destinations; source validation and network egress policy are both required.
