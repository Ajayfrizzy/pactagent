# Configuration reference

`server/.env.example` is the executable inventory and is checked against `process.env` references in CI. Secrets should use the corresponding `*_FILE` variable where available. `NODE_ENV` accepts `development`, `test`, `staging`, or `production`; booleans must be exactly `true` or `false`.

| Variables | Secret | Purpose |
| --- | --- | --- |
| `NODE_ENV`, `SERVICE_ROLE`, `PORT`, `WORKER_HEALTH_PORT` | No | Runtime policy, role, and listeners |
| `BUILD_VERSION`, `BUILD_COMMIT`, `SERVICE_NAME`, `WORKER_ID` | No | Release, log, and worker identity |
| `DATABASE_URL`, `DIRECT_URL` | Yes | Pooled application and direct migration PostgreSQL endpoints |
| `DB_POOL_MAX`, `DB_POOL_IDLE_TIMEOUT_MS`, `DB_CONNECTION_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`, `DB_QUERY_TIMEOUT_MS`, `DB_TRANSACTION_MAX_WAIT_MS`, `DB_TRANSACTION_TIMEOUT_MS` | No | Database resource and timeout bounds |
| `REDIS_URL`, `REDIS_URL_FILE` | Yes | Distributed rate limiting and one-time wallet challenge storage |
| `CORS_ORIGIN`, `TRUST_PROXY_HOPS` | No | HTTP boundary |
| `AUTH_JWT_SECRET`, `AUTH_JWT_SECRET_FILE`, `AUTH_JWT_KEYRING`, `AUTH_JWT_KEYRING_FILE` | Yes | Operator-session signing and verification keys |
| `AUTH_JWT_ACTIVE_KID`, `AUTH_TOKEN_TTL_SECS`, `AUTH_CHALLENGE_TTL_SECS` | No | Operator-session key selection and lifetimes |
| `ADMIN_ADDRESSES` | No | Administrative wallet allowlist |
| `AUTH_RATE_LIMIT_WINDOW_MS`, `AUTH_RATE_LIMIT_MAX`, `ACTION_RATE_LIMIT_WINDOW_MS`, `ACTION_RATE_LIMIT_MAX` | No | Operator authentication and high-risk action limits |
| `V1_IP_RATE_LIMIT_WINDOW_MS`, `V1_IP_RATE_LIMIT_MAX`, `V1_API_KEY_RATE_LIMIT_WINDOW_MS`, `V1_API_KEY_RATE_LIMIT_MAX`, `V1_TENANT_RATE_LIMIT_MAX`, `RATE_LIMIT_FAIL_CLOSED` | No | Infrastructure API limits and failure policy |
| `CKB_RAIL_ENABLED`, `CKB_MAINNET_ENABLED`, `CKB_NODE_URL`, `CKB_INDEXER_URL`, `CKB_NETWORK`, `DEFAULT_CKB_FEE_RATE` | No | Explicit CKB enablement, separate node/indexer endpoints, network, and fee policy |
| `CKB_CONTRACT_CODE_HASH`, `CKB_CONTRACT_HASH_TYPE`, `CKB_CONTRACT_DEPLOYMENT_TX_HASH`, `CKB_CONTRACT_OUTPUT_INDEX`, `CKB_CONTRACT_DEP_TYPE` | No | Deployed escrow-lock commitment; required when the rail is enabled |
| `CKB_CONFIRMATIONS`, `CKB_RECONCILIATION_POLL_MS`, `CKB_STALE_TRANSACTION_MS`, `REQUIRE_SETTLEMENT_READY` | No | Confirmation/reorg polling, stale-transaction threshold, and node/indexer readiness |
| `CKB_SIGNER_MODE` | No | `disabled`, development-only `local_dev`, or future `external`; deployed enablement currently rejects unavailable external signing |
| `CKB_SIGNER_PRIVATE_KEY`, `CKB_SIGNER_PRIVATE_KEY_FILE` | Yes | Development testnet signer only; never permitted in staging, production, or mainnet |
| `REQUIRE_WORKER_READY`, `WORKER_HEARTBEAT_STALE_MS`, `AGENT_INTERVAL_MS`, `SHUTDOWN_TIMEOUT_MS` | No | Readiness and worker lifecycle |
| `WORKER_QUEUES`, `WORKER_CONCURRENCY`, `JOB_LEASE_MS`, `JOB_TIMEOUT_MS` | No | Webhook and settlement-reconciliation queue selection, concurrency, leases, and deadline |
| `WEBHOOK_EGRESS_PROXY_URL` | Deployed environments | Controlled webhook egress proxy |
| `WEBHOOK_SECRET_ENCRYPTION_KEY`, `WEBHOOK_SECRET_ENCRYPTION_KEY_FILE`, `WEBHOOK_ENCRYPTION_KEYRING`, `WEBHOOK_ENCRYPTION_KEYRING_FILE` | Yes | Webhook secret encryption keys |
| `WEBHOOK_ACTIVE_KEY_ID`, `WEBHOOK_TIMEOUT_MS`, `WEBHOOK_MAX_ATTEMPTS`, `WEBHOOK_MAX_REDIRECTS`, `WEBHOOK_RESPONSE_SNIPPET_BYTES`, `WEBHOOK_RETENTION_DAYS` | No | Webhook delivery and retention policy |
| `IDEMPOTENCY_RETENTION_MS`, `IDEMPOTENCY_PROCESSING_LEASE_MS`, `IDEMPOTENCY_MAX_RESPONSE_BYTES` | No | Idempotency storage limits |
| `EVENT_RETENTION_DAYS`, `JOB_RETENTION_DAYS`, `AUDIT_ARCHIVE_AFTER_DAYS` | No | Data retention policy |
| `METRICS_BEARER_TOKEN`, `METRICS_BEARER_TOKEN_FILE` | Yes | Metrics endpoint credential |
| `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_EXPORTER_OTLP_HEADERS_FILE` | Yes | Telemetry exporter authorization |
| `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT` | No | Telemetry identity and collector |
| `SEED_OWNER_ID`, `SEED_SANDBOX_API_KEY`, `SEED_SANDBOX_FULL_API_KEY`, `SEED_SANDBOX_WEBHOOK_SECRET` | Credentials except owner ID | Optional deterministic infrastructure fixtures |
| `RUN_DB_INTEGRATION_TESTS` | No | Explicit database integration-test gate |

`AUTH_JWT_ACTIVE_KID` and `WEBHOOK_ACTIVE_KEY_ID` are identifiers, not secrets. URLs containing embedded credentials remain secrets.

`AUTH_TOKEN_TTL_SECS` defaults to one hour and is capped at 24 hours in staging and production. Administrative status is never accepted from the token or request; it is recomputed from `ADMIN_ADDRESSES` whenever a token is verified. MFA/passkey enforcement remains a future identity-platform control.

`CKB_RAIL_ENABLED=false` is the safe default. Complete configuration is validated at startup. Mainnet additionally requires `CKB_MAINNET_ENABLED=true`, but still fails closed because no production external signer provider is installed. Fiber, fiat, USDT, forum, market-price, AI, legacy-route, websocket, and additional-chain variables are intentionally absent.
