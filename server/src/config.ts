import dotenv from 'dotenv';
import { readFileSync } from 'fs';

dotenv.config({ override: true });

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeNumber(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseBoundedNumber(value: string | undefined, fallback: number, name: string, min: number, max: number) {
  const parsed = parseNumber(value, fallback);
  if (parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }

  return parsed;
}

function parseBoolean(value: string | undefined, fallback = false) {
  if (value === undefined || value === '') {
    return fallback;
  }

  return value === 'true';
}

function parseCorsOrigins(value?: string) {
  if (!value) {
    return ['http://localhost:3000'];
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function parseCsv(value?: string) {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function secretValue(name: string) {
  const file = process.env[`${name}_FILE`];
  if (file) {
    return readFileSync(file, 'utf8').trim();
  }
  return process.env[name] || '';
}

function parseSecretKeyring(name: string) {
  const raw = secretValue(name);
  if (!raw) return {} as Record<string, string>;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => (
      Boolean(entry[0]) && typeof entry[1] === 'string' && Boolean(entry[1])
    )));
  } catch {
    throw new Error(`${name} must be a JSON object mapping key IDs to secrets.`);
  }
}

function hasWildcardOrigin(origin: string) {
  return origin === '*' || origin.includes('*');
}

function hasLocalhostOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(parsed.hostname);
  } catch {
    return true;
  }
}

function requireStrongSecret(value: string, name: string) {
  requireConfig(value, name);
  if (value.length < 32) {
    throw new Error(`${name} must be at least 32 characters in production.`);
  }

  if (/^(change-me|changeme|secret|password|development|dev|test)$/i.test(value)) {
    throw new Error(`${name} must not use a placeholder value in production.`);
  }
}

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  serviceRole: process.env.SERVICE_ROLE || 'api',
  port: parseNumber(process.env.PORT, 4000),
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGIN),
  allowLocalhostCors: !isProduction(),
  enableLegacyProductApi: parseBoolean(process.env.ENABLE_LEGACY_PRODUCT_API, !isProduction()),

  ckbNodeUrl: process.env.CKB_NODE_URL || 'https://testnet.ckb.dev/',
  ckbNetwork: (process.env.CKB_NETWORK || 'testnet') as 'testnet' | 'mainnet',
  treasurySignerProvider: process.env.TREASURY_SIGNER_PROVIDER || 'local',
  treasuryPrivateKey: secretValue('TREASURY_CKB_PRIVATE_KEY'),
  treasuryAddress: process.env.TREASURY_CKB_ADDRESS || '',
  treasurySignerUrl: process.env.TREASURY_SIGNER_URL || '',
  treasurySignerToken: secretValue('TREASURY_SIGNER_TOKEN'),
  defaultCkbFeeRate: process.env.DEFAULT_CKB_FEE_RATE || '1200',

  agentIntervalMs: parseNumber(process.env.AGENT_INTERVAL_MS, 2000),
  shutdownTimeoutMs: parseBoundedNumber(process.env.SHUTDOWN_TIMEOUT_MS, 30_000, 'SHUTDOWN_TIMEOUT_MS', 5_000, 120_000),
  workerHeartbeatStaleMs: parseBoundedNumber(process.env.WORKER_HEARTBEAT_STALE_MS, 30_000, 'WORKER_HEARTBEAT_STALE_MS', 5_000, 10 * 60_000),
  workerId: process.env.WORKER_ID || '',
  requireWorkerReady: parseBoolean(process.env.REQUIRE_WORKER_READY, isProduction()),
  metricsBearerToken: secretValue('METRICS_BEARER_TOKEN'),
  buildVersion: process.env.BUILD_VERSION || 'development',
  buildCommit: process.env.BUILD_COMMIT || 'unknown',

  aiEnabled: parseBoolean(process.env.AI_ENABLED),
  aiProvider: process.env.AI_PROVIDER || 'mock',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  aiTimeoutMs: parseNumber(process.env.AI_TIMEOUT_MS, 30000),

  authJwtSecret: secretValue('AUTH_JWT_SECRET'),
  authJwtActiveKid: process.env.AUTH_JWT_ACTIVE_KID || 'legacy',
  authJwtKeys: parseSecretKeyring('AUTH_JWT_KEYRING'),
  authTokenTtlSecs: parseNumber(process.env.AUTH_TOKEN_TTL_SECS, 604800),
  authChallengeTtlSecs: parseNumber(process.env.AUTH_CHALLENGE_TTL_SECS, 600),
  webhookSecretEncryptionKey: secretValue('WEBHOOK_SECRET_ENCRYPTION_KEY'),
  webhookActiveKeyId: process.env.WEBHOOK_ACTIVE_KEY_ID || 'legacy',
  webhookEncryptionKeys: parseSecretKeyring('WEBHOOK_ENCRYPTION_KEYRING'),

  adminAddresses: parseCsv(process.env.ADMIN_ADDRESSES).map((address) => address.toLowerCase()),
  authRateLimitWindowMs: parseBoundedNumber(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000, 'AUTH_RATE_LIMIT_WINDOW_MS', 1_000, 24 * 60 * 60 * 1000),
  authRateLimitMax: parseBoundedNumber(process.env.AUTH_RATE_LIMIT_MAX, 20, 'AUTH_RATE_LIMIT_MAX', 1, 10_000),
  actionRateLimitWindowMs: parseBoundedNumber(process.env.ACTION_RATE_LIMIT_WINDOW_MS, 60 * 1000, 'ACTION_RATE_LIMIT_WINDOW_MS', 1_000, 24 * 60 * 60 * 1000),
  actionRateLimitMax: parseBoundedNumber(process.env.ACTION_RATE_LIMIT_MAX, 12, 'ACTION_RATE_LIMIT_MAX', 1, 10_000),
  v1IpRateLimitWindowMs: parseBoundedNumber(process.env.V1_IP_RATE_LIMIT_WINDOW_MS, 60_000, 'V1_IP_RATE_LIMIT_WINDOW_MS', 1_000, 24 * 60 * 60 * 1000),
  v1IpRateLimitMax: parseBoundedNumber(process.env.V1_IP_RATE_LIMIT_MAX, 300, 'V1_IP_RATE_LIMIT_MAX', 1, 100_000),
  v1ApiKeyRateLimitWindowMs: parseBoundedNumber(process.env.V1_API_KEY_RATE_LIMIT_WINDOW_MS, 60_000, 'V1_API_KEY_RATE_LIMIT_WINDOW_MS', 1_000, 24 * 60 * 60 * 1000),
  v1ApiKeyRateLimitMax: parseBoundedNumber(process.env.V1_API_KEY_RATE_LIMIT_MAX, 600, 'V1_API_KEY_RATE_LIMIT_MAX', 1, 100_000),
  dbTransactionMaxWaitMs: parseBoundedNumber(process.env.DB_TRANSACTION_MAX_WAIT_MS, 5_000, 'DB_TRANSACTION_MAX_WAIT_MS', 1_000, 60_000),
  dbTransactionTimeoutMs: parseBoundedNumber(process.env.DB_TRANSACTION_TIMEOUT_MS, 30_000, 'DB_TRANSACTION_TIMEOUT_MS', 5_000, 120_000),
  dbPoolMax: parseBoundedNumber(process.env.DB_POOL_MAX, 10, 'DB_POOL_MAX', 1, 100),
  dbPoolIdleTimeoutMs: parseBoundedNumber(process.env.DB_POOL_IDLE_TIMEOUT_MS, 30_000, 'DB_POOL_IDLE_TIMEOUT_MS', 1_000, 10 * 60_000),
  dbConnectionTimeoutMs: parseBoundedNumber(process.env.DB_CONNECTION_TIMEOUT_MS, 10_000, 'DB_CONNECTION_TIMEOUT_MS', 1_000, 60_000),
  dbStatementTimeoutMs: parseBoundedNumber(process.env.DB_STATEMENT_TIMEOUT_MS, 30_000, 'DB_STATEMENT_TIMEOUT_MS', 1_000, 120_000),
  dbQueryTimeoutMs: parseBoundedNumber(process.env.DB_QUERY_TIMEOUT_MS, 35_000, 'DB_QUERY_TIMEOUT_MS', 1_000, 180_000),
  trustProxyHops: parseNonNegativeNumber(process.env.TRUST_PROXY_HOPS, 0),
  redisUrl: secretValue('REDIS_URL'),
  rateLimitFailClosed: parseBoolean(process.env.RATE_LIMIT_FAIL_CLOSED, isProduction()),
  webhookTimeoutMs: parseBoundedNumber(process.env.WEBHOOK_TIMEOUT_MS, 10_000, 'WEBHOOK_TIMEOUT_MS', 1_000, 30_000),
  webhookMaxAttempts: parseBoundedNumber(process.env.WEBHOOK_MAX_ATTEMPTS, 5, 'WEBHOOK_MAX_ATTEMPTS', 1, 10),
  webhookMaxRedirects: parseBoundedNumber(process.env.WEBHOOK_MAX_REDIRECTS, 3, 'WEBHOOK_MAX_REDIRECTS', 0, 5),
  webhookResponseSnippetBytes: parseBoundedNumber(process.env.WEBHOOK_RESPONSE_SNIPPET_BYTES, 2000, 'WEBHOOK_RESPONSE_SNIPPET_BYTES', 0, 8192),
  idempotencyRetentionMs: parseBoundedNumber(process.env.IDEMPOTENCY_RETENTION_MS, 24 * 60 * 60 * 1000, 'IDEMPOTENCY_RETENTION_MS', 60_000, 7 * 24 * 60 * 60 * 1000),
  idempotencyProcessingLeaseMs: parseBoundedNumber(process.env.IDEMPOTENCY_PROCESSING_LEASE_MS, 2 * 60_000, 'IDEMPOTENCY_PROCESSING_LEASE_MS', 10_000, 30 * 60_000),
  idempotencyMaxResponseBytes: parseBoundedNumber(process.env.IDEMPOTENCY_MAX_RESPONSE_BYTES, 256 * 1024, 'IDEMPOTENCY_MAX_RESPONSE_BYTES', 1024, 1024 * 1024),
  webhookRetentionDays: parseBoundedNumber(process.env.WEBHOOK_RETENTION_DAYS, 30, 'WEBHOOK_RETENTION_DAYS', 1, 3650),
  eventRetentionDays: parseBoundedNumber(process.env.EVENT_RETENTION_DAYS, 90, 'EVENT_RETENTION_DAYS', 1, 3650),
  jobRetentionDays: parseBoundedNumber(process.env.JOB_RETENTION_DAYS, 30, 'JOB_RETENTION_DAYS', 1, 3650),
  auditArchiveAfterDays: parseBoundedNumber(process.env.AUDIT_ARCHIVE_AFTER_DAYS, 365, 'AUDIT_ARCHIVE_AFTER_DAYS', 30, 3650),
  wsMaxConnections: parseBoundedNumber(process.env.WS_MAX_CONNECTIONS, 1000, 'WS_MAX_CONNECTIONS', 1, 100_000),
  wsMaxConnectionsPerIp: parseBoundedNumber(process.env.WS_MAX_CONNECTIONS_PER_IP, 20, 'WS_MAX_CONNECTIONS_PER_IP', 1, 1000),
  wsMaxPayloadBytes: parseBoundedNumber(process.env.WS_MAX_PAYLOAD_BYTES, 64 * 1024, 'WS_MAX_PAYLOAD_BYTES', 1024, 1024 * 1024),
  wsHeartbeatIntervalMs: parseBoundedNumber(process.env.WS_HEARTBEAT_INTERVAL_MS, 30_000, 'WS_HEARTBEAT_INTERVAL_MS', 5_000, 5 * 60_000),
  wsMaxBufferedBytes: parseBoundedNumber(process.env.WS_MAX_BUFFERED_BYTES, 1024 * 1024, 'WS_MAX_BUFFERED_BYTES', 64 * 1024, 16 * 1024 * 1024),
  forumPublishEnabled: parseBoolean(process.env.FORUM_PUBLISH_ENABLED),
  forumPublishProvider: (process.env.FORUM_PUBLISH_PROVIDER || 'DISCOURSE') as 'DISCOURSE' | 'WEBHOOK',
  forumPublishApiKey: process.env.FORUM_PUBLISH_API_KEY || '',
  forumPublishApiUsername: process.env.FORUM_PUBLISH_API_USERNAME || '',
  forumPublishWebhookUrl: process.env.FORUM_PUBLISH_WEBHOOK_URL || '',
  forumPublishTimeoutMs: parseNumber(process.env.FORUM_PUBLISH_TIMEOUT_MS, 10_000),
  coinGeckoApiBaseUrl:
    process.env.COINGECKO_API_BASE_URL
    || 'https://api.coingecko.com/api/v3',
  coinGeckoApiKey: process.env.COINGECKO_API_KEY || '',
  marketPriceCacheTtlMs: parseNumber(process.env.MARKET_PRICE_CACHE_TTL_MS, 60_000),

  onchainEscrowEnabled: parseBoolean(process.env.ONCHAIN_ESCROW_ENABLED),
  onchainLockCodeHash: process.env.ONCHAIN_LOCK_CODE_HASH || '',
  onchainLockHashType: (process.env.ONCHAIN_LOCK_HASH_TYPE || 'type') as 'type' | 'data' | 'data1',
  onchainLockTxHash: process.env.ONCHAIN_LOCK_TX_HASH || '',
  onchainLockIndex: process.env.ONCHAIN_LOCK_INDEX || '',
  onchainLockDepType: (process.env.ONCHAIN_LOCK_DEP_TYPE || 'code') as 'code' | 'depGroup',
  onchainEscrowArgsSalt: process.env.ONCHAIN_ESCROW_ARGS_SALT || '',
};

export function requireConfig(value: string, name: string) {
  if (!value) {
    throw new Error(`Missing required configuration: ${name}`);
  }

  return value;
}

export function validateProductionConfig() {
  if (!isProduction()) {
    return;
  }

  requireConfig(process.env.DATABASE_URL || '', 'DATABASE_URL');
  if (config.serviceRole === 'api' && !config.redisUrl) {
    throw new Error('REDIS_URL or REDIS_URL_FILE is required in production for distributed rate limiting.');
  }
  const activeJwtKey = config.authJwtKeys[config.authJwtActiveKid] || config.authJwtSecret;
  const activeWebhookKey = config.webhookEncryptionKeys[config.webhookActiveKeyId] || config.webhookSecretEncryptionKey;
  requireStrongSecret(activeWebhookKey, `webhook encryption key ${config.webhookActiveKeyId}`);

  if (config.serviceRole === 'api') {
    requireStrongSecret(activeJwtKey, `JWT key ${config.authJwtActiveKid}`);
    requireStrongSecret(config.metricsBearerToken, 'METRICS_BEARER_TOKEN');
  }

  if (!['local', 'managed'].includes(config.treasurySignerProvider)) {
    throw new Error('TREASURY_SIGNER_PROVIDER must be local or managed.');
  }

  if (config.treasurySignerProvider === 'local' && (config.onchainEscrowEnabled || config.ckbNetwork === 'mainnet')) {
    throw new Error('TREASURY_SIGNER_PROVIDER=local is not allowed for mainnet or enabled on-chain escrow in production.');
  }

  if (config.treasurySignerProvider === 'managed') {
    requireConfig(config.treasurySignerUrl, 'TREASURY_SIGNER_URL');
    requireConfig(config.treasuryAddress, 'TREASURY_CKB_ADDRESS');
    requireStrongSecret(config.treasurySignerToken, 'TREASURY_SIGNER_TOKEN');
  }

  if (config.serviceRole === 'api' && !config.adminAddresses.length) {
    throw new Error('ADMIN_ADDRESSES must include at least one admin identity in production.');
  }

  if (config.serviceRole === 'api' && !process.env.CORS_ORIGIN) {
    throw new Error('CORS_ORIGIN must be set explicitly in production.');
  }

  if (config.serviceRole === 'api' && config.corsOrigins.some((origin) => hasWildcardOrigin(origin) || hasLocalhostOrigin(origin))) {
    throw new Error('Production CORS origins cannot include wildcards, localhost, or invalid URLs.');
  }

  if (config.serviceRole === 'api' && config.enableLegacyProductApi) {
    throw new Error('ENABLE_LEGACY_PRODUCT_API must be false in production.');
  }
}
