import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { z } from 'zod';

dotenv.config();

const optionalUrl = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().url().optional(),
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  SERVICE_ROLE: z.enum(['api', 'worker']).default('api'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(4001),
  DATABASE_URL: optionalUrl,
  DIRECT_URL: optionalUrl,
  REDIS_URL: optionalUrl,
  WEBHOOK_EGRESS_PROXY_URL: optionalUrl,
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
  CKB_NODE_URL: z.string().url().default('https://testnet.ckb.dev/'),
  CKB_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
  DEFAULT_CKB_FEE_RATE: z.string().regex(/^[1-9][0-9]*$/).default('1200'),
  TREASURY_SIGNER_PROVIDER: z.enum(['local', 'managed']).default('local'),
  TREASURY_SIGNER_URL: optionalUrl,
  FIBER_RPC_URL: optionalUrl,
  AI_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
  FORUM_PUBLISH_PROVIDER: z.enum(['DISCOURSE', 'WEBHOOK']).default('DISCOURSE'),
  ONCHAIN_LOCK_HASH_TYPE: z.enum(['type', 'data', 'data1']).default('type'),
  ONCHAIN_LOCK_DEP_TYPE: z.enum(['code', 'depGroup']).default('code'),
  ONCHAIN_LOCK_CODE_HASH: z.preprocess((value) => value === '' ? undefined : value, z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional()),
  ONCHAIN_LOCK_TX_HASH: z.preprocess((value) => value === '' ? undefined : value, z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional()),
  ONCHAIN_LOCK_INDEX: z.preprocess((value) => value === '' ? undefined : value, z.string().regex(/^0x[a-fA-F0-9]+$/).optional()),
  REQUIRE_SETTLEMENT_READY: z.enum(['true', 'false']).optional(),
  COINGECKO_API_BASE_URL: z.string().url().default('https://api.coingecko.com/api/v3'),
  FORUM_PUBLISH_WEBHOOK_URL: optionalUrl,
}).passthrough();

const parsedEnvironment = environmentSchema.safeParse(process.env);
if (!parsedEnvironment.success) {
  const details = parsedEnvironment.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid environment configuration: ${details}`);
}
const environment = parsedEnvironment.data;

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function isDeployedEnvironment() {
  return process.env.NODE_ENV === 'staging' || process.env.NODE_ENV === 'production';
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

export function parseBoolean(value: string | undefined, fallback = false, name = 'boolean setting') {
  if (value === undefined || value === '') {
    return fallback;
  }

  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be exactly "true" or "false".`);
}

function parseCorsOrigins(value?: string) {
  if (!value) {
    return ['http://localhost:3000'];
  }

  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of origins) {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('CORS_ORIGIN entries must use http or https.');
    }
  }
  return origins;
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

export function databaseEndpointIdentity(value: string) {
  const url = new URL(value);
  return `${url.protocol}//${url.hostname}:${url.port || '5432'}${url.pathname}`;
}

export function assertDistinctDatabaseEndpoints(databaseUrl: string, directUrl: string) {
  if (databaseEndpointIdentity(databaseUrl) === databaseEndpointIdentity(directUrl)) {
    throw new Error('DATABASE_URL must use the pooled application endpoint and DIRECT_URL must use a distinct direct migration endpoint in staging and production.');
  }
}

export function assertControlledEgressProxy(proxyUrl: string) {
  requireConfig(proxyUrl, 'WEBHOOK_EGRESS_PROXY_URL');
  if (new URL(proxyUrl).protocol !== 'http:') {
    throw new Error('WEBHOOK_EGRESS_PROXY_URL must use http so HTTPS destinations can use an authenticated CONNECT tunnel.');
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
  nodeEnv: environment.NODE_ENV,
  serviceRole: environment.SERVICE_ROLE,
  port: environment.PORT,
  workerHealthPort: environment.WORKER_HEALTH_PORT,
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGIN),
  allowLocalhostCors: !isProduction(),
  enableLegacyProductApi: parseBoolean(process.env.ENABLE_LEGACY_PRODUCT_API, environment.NODE_ENV === 'development', 'ENABLE_LEGACY_PRODUCT_API'),

  ckbNodeUrl: environment.CKB_NODE_URL,
  ckbNetwork: environment.CKB_NETWORK,
  treasurySignerProvider: environment.TREASURY_SIGNER_PROVIDER,
  treasuryPrivateKey: secretValue('TREASURY_CKB_PRIVATE_KEY'),
  treasuryAddress: process.env.TREASURY_CKB_ADDRESS || '',
  treasurySignerUrl: environment.TREASURY_SIGNER_URL || '',
  treasurySignerToken: secretValue('TREASURY_SIGNER_TOKEN'),
  defaultCkbFeeRate: environment.DEFAULT_CKB_FEE_RATE,

  agentIntervalMs: parseNumber(process.env.AGENT_INTERVAL_MS, 2000),
  shutdownTimeoutMs: parseBoundedNumber(process.env.SHUTDOWN_TIMEOUT_MS, 30_000, 'SHUTDOWN_TIMEOUT_MS', 5_000, 120_000),
  workerHeartbeatStaleMs: parseBoundedNumber(process.env.WORKER_HEARTBEAT_STALE_MS, 30_000, 'WORKER_HEARTBEAT_STALE_MS', 5_000, 10 * 60_000),
  workerId: process.env.WORKER_ID || '',
  workerQueues: parseCsv(process.env.WORKER_QUEUES || 'settlement,webhook,ai'),
  workerConcurrency: parseBoundedNumber(process.env.WORKER_CONCURRENCY, 4, 'WORKER_CONCURRENCY', 1, 32),
  jobLeaseMs: parseBoundedNumber(process.env.JOB_LEASE_MS, 60_000, 'JOB_LEASE_MS', 10_000, 15 * 60_000),
  jobTimeoutMs: parseBoundedNumber(process.env.JOB_TIMEOUT_MS, 5 * 60_000, 'JOB_TIMEOUT_MS', 5_000, 30 * 60_000),
  requireWorkerReady: parseBoolean(process.env.REQUIRE_WORKER_READY, isDeployedEnvironment(), 'REQUIRE_WORKER_READY'),
  requireSettlementReady: parseBoolean(process.env.REQUIRE_SETTLEMENT_READY, isProduction(), 'REQUIRE_SETTLEMENT_READY'),
  metricsBearerToken: secretValue('METRICS_BEARER_TOKEN'),
  buildVersion: process.env.BUILD_VERSION || 'development',
  buildCommit: process.env.BUILD_COMMIT || 'unknown',

  aiEnabled: parseBoolean(process.env.AI_ENABLED, false, 'AI_ENABLED'),
  aiProvider: environment.AI_PROVIDER,
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
  v1TenantRateLimitMax: parseBoundedNumber(process.env.V1_TENANT_RATE_LIMIT_MAX, 1200, 'V1_TENANT_RATE_LIMIT_MAX', 1, 100_000),
  dbTransactionMaxWaitMs: parseBoundedNumber(process.env.DB_TRANSACTION_MAX_WAIT_MS, 5_000, 'DB_TRANSACTION_MAX_WAIT_MS', 1_000, 60_000),
  dbTransactionTimeoutMs: parseBoundedNumber(process.env.DB_TRANSACTION_TIMEOUT_MS, 30_000, 'DB_TRANSACTION_TIMEOUT_MS', 5_000, 120_000),
  dbPoolMax: parseBoundedNumber(process.env.DB_POOL_MAX, 10, 'DB_POOL_MAX', 1, 100),
  dbPoolIdleTimeoutMs: parseBoundedNumber(process.env.DB_POOL_IDLE_TIMEOUT_MS, 30_000, 'DB_POOL_IDLE_TIMEOUT_MS', 1_000, 10 * 60_000),
  dbConnectionTimeoutMs: parseBoundedNumber(process.env.DB_CONNECTION_TIMEOUT_MS, 10_000, 'DB_CONNECTION_TIMEOUT_MS', 1_000, 60_000),
  dbStatementTimeoutMs: parseBoundedNumber(process.env.DB_STATEMENT_TIMEOUT_MS, 30_000, 'DB_STATEMENT_TIMEOUT_MS', 1_000, 120_000),
  dbQueryTimeoutMs: parseBoundedNumber(process.env.DB_QUERY_TIMEOUT_MS, 35_000, 'DB_QUERY_TIMEOUT_MS', 1_000, 180_000),
  trustProxyHops: parseNonNegativeNumber(process.env.TRUST_PROXY_HOPS, 0),
  redisUrl: secretValue('REDIS_URL'),
  webhookEgressProxyUrl: environment.WEBHOOK_EGRESS_PROXY_URL || '',
  rateLimitFailClosed: parseBoolean(process.env.RATE_LIMIT_FAIL_CLOSED, isDeployedEnvironment(), 'RATE_LIMIT_FAIL_CLOSED'),
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
  forumPublishEnabled: parseBoolean(process.env.FORUM_PUBLISH_ENABLED, false, 'FORUM_PUBLISH_ENABLED'),
  forumPublishProvider: environment.FORUM_PUBLISH_PROVIDER,
  forumPublishApiKey: process.env.FORUM_PUBLISH_API_KEY || '',
  forumPublishApiUsername: process.env.FORUM_PUBLISH_API_USERNAME || '',
  forumPublishWebhookUrl: environment.FORUM_PUBLISH_WEBHOOK_URL || '',
  forumPublishTimeoutMs: parseNumber(process.env.FORUM_PUBLISH_TIMEOUT_MS, 10_000),
  coinGeckoApiBaseUrl: environment.COINGECKO_API_BASE_URL,
  coinGeckoApiKey: process.env.COINGECKO_API_KEY || '',
  marketPriceCacheTtlMs: parseNumber(process.env.MARKET_PRICE_CACHE_TTL_MS, 60_000),

  onchainEscrowEnabled: parseBoolean(process.env.ONCHAIN_ESCROW_ENABLED, false, 'ONCHAIN_ESCROW_ENABLED'),
  onchainLockCodeHash: environment.ONCHAIN_LOCK_CODE_HASH || '',
  onchainLockHashType: environment.ONCHAIN_LOCK_HASH_TYPE,
  onchainLockTxHash: environment.ONCHAIN_LOCK_TX_HASH || '',
  onchainLockIndex: environment.ONCHAIN_LOCK_INDEX || '',
  onchainLockDepType: environment.ONCHAIN_LOCK_DEP_TYPE,
  onchainEscrowArgsSalt: process.env.ONCHAIN_ESCROW_ARGS_SALT || '',

  fiberEnabled: parseBoolean(process.env.FIBER_ENABLED, false, 'FIBER_ENABLED'),
  fiberRpcUrl: environment.FIBER_RPC_URL || '',
  fiberRpcApiKey: secretValue('FIBER_RPC_API_KEY'),
};

export function requireConfig(value: string, name: string) {
  if (!value) {
    throw new Error(`Missing required configuration: ${name}`);
  }

  return value;
}

export function validateProductionConfig() {
  if (config.onchainEscrowEnabled) {
    requireConfig(config.onchainLockCodeHash, 'ONCHAIN_LOCK_CODE_HASH');
    requireConfig(config.onchainLockTxHash, 'ONCHAIN_LOCK_TX_HASH');
    requireConfig(config.onchainLockIndex, 'ONCHAIN_LOCK_INDEX');
    if (!/^0x[a-fA-F0-9]{64}$/.test(config.onchainLockCodeHash)) {
      throw new Error('ONCHAIN_LOCK_CODE_HASH must be a 32-byte 0x-prefixed hex value.');
    }
    if (!/^0x[a-fA-F0-9]{64}$/.test(config.onchainLockTxHash)) {
      throw new Error('ONCHAIN_LOCK_TX_HASH must be a 32-byte 0x-prefixed transaction hash.');
    }
    if (!/^0x[a-fA-F0-9]+$/.test(config.onchainLockIndex)) {
      throw new Error('ONCHAIN_LOCK_INDEX must be a 0x-prefixed hexadecimal index.');
    }
    if (config.treasurySignerProvider === 'local') {
      requireConfig(config.treasuryPrivateKey, 'TREASURY_CKB_PRIVATE_KEY');
    }
  }

  if (config.fiberEnabled) {
    requireConfig(config.fiberRpcUrl, 'FIBER_RPC_URL');
    requireConfig(config.fiberRpcApiKey, 'FIBER_RPC_API_KEY');
  }

  if (config.treasurySignerProvider === 'managed') {
    requireConfig(config.treasurySignerUrl, 'TREASURY_SIGNER_URL');
    requireConfig(config.treasuryAddress, 'TREASURY_CKB_ADDRESS');
    requireConfig(config.treasurySignerToken, 'TREASURY_SIGNER_TOKEN');
  }

  if (config.aiEnabled && config.aiProvider === 'openai') {
    requireConfig(config.openaiApiKey, 'OPENAI_API_KEY');
  }

  if (config.forumPublishEnabled) {
    if (config.forumPublishProvider === 'DISCOURSE') {
      requireConfig(config.forumPublishApiKey, 'FORUM_PUBLISH_API_KEY');
      requireConfig(config.forumPublishApiUsername, 'FORUM_PUBLISH_API_USERNAME');
    } else {
      requireConfig(config.forumPublishWebhookUrl, 'FORUM_PUBLISH_WEBHOOK_URL');
    }
  }

  if (!isDeployedEnvironment()) {
    return;
  }

  requireConfig(process.env.DATABASE_URL || '', 'DATABASE_URL');
  requireConfig(process.env.DIRECT_URL || '', 'DIRECT_URL');
  assertDistinctDatabaseEndpoints(process.env.DATABASE_URL!, process.env.DIRECT_URL!);
  if (config.serviceRole === 'api' && !config.redisUrl) {
    throw new Error('REDIS_URL or REDIS_URL_FILE is required in staging and production for distributed rate limiting.');
  }
  assertControlledEgressProxy(config.webhookEgressProxyUrl);
  if (config.serviceRole === 'worker') {
    const invalidQueues = config.workerQueues.filter((queue) => !['settlement', 'webhook', 'ai'].includes(queue));
    if (config.workerQueues.length === 0 || invalidQueues.length > 0) {
      throw new Error(`WORKER_QUEUES must contain settlement, webhook, or ai. Invalid values: ${invalidQueues.join(', ')}`);
    }
    if (config.jobTimeoutMs >= config.jobLeaseMs * 30) {
      throw new Error('JOB_TIMEOUT_MS must be less than 30 lease periods.');
    }
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
    throw new Error('TREASURY_SIGNER_PROVIDER=local is not allowed for mainnet or enabled on-chain escrow in staging or production.');
  }

  if (config.treasurySignerProvider === 'managed') {
    requireStrongSecret(config.treasurySignerToken, 'TREASURY_SIGNER_TOKEN');
  }

  if (config.serviceRole === 'api' && !config.adminAddresses.length) {
    throw new Error('ADMIN_ADDRESSES must include at least one admin identity in staging and production.');
  }

  if (config.serviceRole === 'api' && !process.env.CORS_ORIGIN) {
    throw new Error('CORS_ORIGIN must be set explicitly in staging and production.');
  }

  if (config.serviceRole === 'api' && config.corsOrigins.some((origin) => hasWildcardOrigin(origin) || hasLocalhostOrigin(origin))) {
    throw new Error('Staging and production CORS origins cannot include wildcards, localhost, or invalid URLs.');
  }

  if (config.serviceRole === 'api' && config.enableLegacyProductApi) {
    throw new Error('ENABLE_LEGACY_PRODUCT_API must be false in staging and production.');
  }
}
