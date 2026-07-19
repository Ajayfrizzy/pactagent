# Configuration reference

Secrets should use their corresponding `*_FILE` variable where available. `NODE_ENV` accepts `development`, `test`, `staging`, or `production`. Boolean values must be exactly `true` or `false`.

| Variables | Secret | Purpose |
| --- | --- | --- |
| `NODE_ENV`, `SERVICE_ROLE`, `PORT`, `WORKER_HEALTH_PORT` | No | Runtime policy, role, and listener ports |
| `BUILD_VERSION`, `BUILD_COMMIT`, `WORKER_ID` | No | Release and worker identity |
| `SERVICE_NAME` | No | Structured-log service identity |
| `DATABASE_URL`, `DIRECT_URL` | Yes | PostgreSQL credentials and endpoints |
| `DB_POOL_MAX`, `DB_POOL_IDLE_TIMEOUT_MS`, `DB_CONNECTION_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`, `DB_QUERY_TIMEOUT_MS`, `DB_TRANSACTION_MAX_WAIT_MS`, `DB_TRANSACTION_TIMEOUT_MS` | No | Database pool and timeout bounds |
| `REDIS_URL`, `REDIS_URL_FILE` | Yes | Distributed rate-limit store |
| `CORS_ORIGIN`, `TRUST_PROXY_HOPS`, `ENABLE_LEGACY_PRODUCT_API` | No | HTTP boundary and legacy policy |
| `AUTH_JWT_SECRET`, `AUTH_JWT_SECRET_FILE`, `AUTH_JWT_KEYRING`, `AUTH_JWT_KEYRING_FILE` | Yes | JWT signing keys |
| `AUTH_JWT_ACTIVE_KID`, `AUTH_TOKEN_TTL_SECS`, `AUTH_CHALLENGE_TTL_SECS` | No | JWT key selection and lifetimes |
| `ADMIN_ADDRESSES` | No | Administrative identity allowlist |
| `AUTH_RATE_LIMIT_WINDOW_MS`, `AUTH_RATE_LIMIT_MAX`, `ACTION_RATE_LIMIT_WINDOW_MS`, `ACTION_RATE_LIMIT_MAX` | No | Legacy authentication/action limits |
| `V1_IP_RATE_LIMIT_WINDOW_MS`, `V1_IP_RATE_LIMIT_MAX`, `V1_API_KEY_RATE_LIMIT_WINDOW_MS`, `V1_API_KEY_RATE_LIMIT_MAX`, `RATE_LIMIT_FAIL_CLOSED` | No | Infrastructure API limits and failure policy |
| `CKB_NODE_URL`, `CKB_NETWORK`, `DEFAULT_CKB_FEE_RATE` | No | CKB RPC, `testnet`/`mainnet`, and fees |
| `TREASURY_SIGNER_PROVIDER`, `TREASURY_SIGNER_URL`, `TREASURY_CKB_ADDRESS` | No | `local`/`managed` signer selection and public endpoint/address |
| `TREASURY_CKB_PRIVATE_KEY`, `TREASURY_CKB_PRIVATE_KEY_FILE`, `TREASURY_SIGNER_TOKEN`, `TREASURY_SIGNER_TOKEN_FILE` | Yes | Treasury signing credentials |
| `ONCHAIN_ESCROW_ENABLED`, `ONCHAIN_LOCK_CODE_HASH`, `ONCHAIN_LOCK_HASH_TYPE`, `ONCHAIN_LOCK_TX_HASH`, `ONCHAIN_LOCK_INDEX`, `ONCHAIN_LOCK_DEP_TYPE`, `ONCHAIN_ESCROW_ARGS_SALT` | No | On-chain contract deployment and script settings |
| `FIBER_ENABLED`, `FIBER_RPC_URL` | No | Fiber feature gate and RPC endpoint |
| `FIBER_RPC_API_KEY`, `FIBER_RPC_API_KEY_FILE` | Yes | Fiber RPC credential |
| `REQUIRE_WORKER_READY`, `REQUIRE_SETTLEMENT_READY`, `WORKER_HEARTBEAT_STALE_MS`, `AGENT_INTERVAL_MS`, `SHUTDOWN_TIMEOUT_MS` | No | Readiness and worker lifecycle policy |
| `AI_ENABLED`, `AI_PROVIDER`, `OPENAI_MODEL`, `AI_TIMEOUT_MS` | No | AI feature, provider/model, and timeout settings |
| `OPENAI_API_KEY` | Yes | OpenAI provider credential |
| `WEBHOOK_SECRET_ENCRYPTION_KEY`, `WEBHOOK_SECRET_ENCRYPTION_KEY_FILE`, `WEBHOOK_ENCRYPTION_KEYRING`, `WEBHOOK_ENCRYPTION_KEYRING_FILE` | Yes | Webhook secret encryption keys |
| `WEBHOOK_ACTIVE_KEY_ID`, `WEBHOOK_TIMEOUT_MS`, `WEBHOOK_MAX_ATTEMPTS`, `WEBHOOK_MAX_REDIRECTS`, `WEBHOOK_RESPONSE_SNIPPET_BYTES`, `WEBHOOK_RETENTION_DAYS` | No | Webhook delivery and retention policy |
| `IDEMPOTENCY_RETENTION_MS`, `IDEMPOTENCY_PROCESSING_LEASE_MS`, `IDEMPOTENCY_MAX_RESPONSE_BYTES` | No | Idempotency storage limits |
| `EVENT_RETENTION_DAYS`, `JOB_RETENTION_DAYS`, `AUDIT_ARCHIVE_AFTER_DAYS` | No | Data retention policy |
| `METRICS_BEARER_TOKEN`, `METRICS_BEARER_TOKEN_FILE` | Yes | Metrics endpoint credential |
| `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_EXPORTER_OTLP_HEADERS_FILE` | Yes | Telemetry exporter authorization headers |
| `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT` | No | Telemetry service and collector endpoint |
| `WS_MAX_CONNECTIONS`, `WS_MAX_CONNECTIONS_PER_IP`, `WS_MAX_PAYLOAD_BYTES`, `WS_HEARTBEAT_INTERVAL_MS`, `WS_MAX_BUFFERED_BYTES` | No | WebSocket resource limits |
| `FORUM_PUBLISH_ENABLED`, `FORUM_PUBLISH_PROVIDER`, `FORUM_PUBLISH_API_USERNAME`, `FORUM_PUBLISH_WEBHOOK_URL`, `FORUM_PUBLISH_TIMEOUT_MS` | No | Forum publishing behavior |
| `FORUM_PUBLISH_API_KEY` | Yes | Forum provider credential |
| `COINGECKO_API_BASE_URL`, `MARKET_PRICE_CACHE_TTL_MS` | No | Price provider endpoint and stable quote cache lifetime |
| `COINGECKO_API_KEY` | Yes | Price provider credential |
| `SEED_SANDBOX_API_KEY`, `SEED_SANDBOX_FULL_API_KEY`, `SEED_SANDBOX_WEBHOOK_SECRET` | Yes | Optional deterministic seed credentials |
| `RUN_DB_INTEGRATION_TESTS` | No | Explicit database integration-test gate |

`AUTH_JWT_ACTIVE_KID` and `WEBHOOK_ACTIVE_KEY_ID` are identifiers, not secrets. Contract hashes, transaction hashes, and public addresses are also non-secret. URLs containing embedded credentials are secret even when the corresponding row normally says No.
