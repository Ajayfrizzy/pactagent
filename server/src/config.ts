import dotenv from 'dotenv';

dotenv.config({ override: true });

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

export const config = {
  port: parseNumber(process.env.PORT, 4000),
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGIN),

  ckbNodeUrl: process.env.CKB_NODE_URL || 'https://testnet.ckb.dev/',
  ckbNetwork: (process.env.CKB_NETWORK || 'testnet') as 'testnet' | 'mainnet',
  treasuryPrivateKey: process.env.TREASURY_CKB_PRIVATE_KEY || '',
  treasuryAddress: process.env.TREASURY_CKB_ADDRESS || '',
  defaultCkbFeeRate: process.env.DEFAULT_CKB_FEE_RATE || '1200',

  agentIntervalMs: parseNumber(process.env.AGENT_INTERVAL_MS, 2000),

  fiberEnabled: process.env.FIBER_ENABLED === 'true',
  fiberNodeUrl: process.env.FIBER_NODE_URL || 'http://localhost:8227',
  fiberApiKey: process.env.FIBER_API_KEY || '',

  aiEnabled: process.env.AI_ENABLED === 'true',
  aiProvider: process.env.AI_PROVIDER || 'mock',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  aiTimeoutMs: parseNumber(process.env.AI_TIMEOUT_MS, 30000),

  authJwtSecret: process.env.AUTH_JWT_SECRET || '',
  authTokenTtlSecs: parseNumber(process.env.AUTH_TOKEN_TTL_SECS, 604800),
  authChallengeTtlSecs: parseNumber(process.env.AUTH_CHALLENGE_TTL_SECS, 600),

  adminAddresses: parseCsv(process.env.ADMIN_ADDRESSES).map((address) => address.toLowerCase()),
  authRateLimitWindowMs: parseNumber(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  authRateLimitMax: parseNumber(process.env.AUTH_RATE_LIMIT_MAX, 20),
  actionRateLimitWindowMs: parseNumber(process.env.ACTION_RATE_LIMIT_WINDOW_MS, 60 * 1000),
  actionRateLimitMax: parseNumber(process.env.ACTION_RATE_LIMIT_MAX, 12),
  webhookTimeoutMs: parseNumber(process.env.WEBHOOK_TIMEOUT_MS, 10_000),
  webhookMaxAttempts: parseNumber(process.env.WEBHOOK_MAX_ATTEMPTS, 5),
  forumPublishEnabled: process.env.FORUM_PUBLISH_ENABLED === 'true',
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

  onchainEscrowEnabled: process.env.ONCHAIN_ESCROW_ENABLED === 'true',
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
