import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',

  ckbNodeUrl: process.env.CKB_NODE_URL || 'https://testnet.ckb.dev/',
  ckbNetwork: (process.env.CKB_NETWORK || 'testnet') as 'testnet' | 'mainnet',
  treasuryPrivateKey: process.env.TREASURY_CKB_PRIVATE_KEY || '',
  treasuryAddress: process.env.TREASURY_CKB_ADDRESS || '',
  defaultCkbFeeRate: process.env.DEFAULT_CKB_FEE_RATE || '1200',

  agentIntervalMs: parseInt(process.env.AGENT_INTERVAL_MS || '10000', 10),

  fiberEnabled: process.env.FIBER_ENABLED === 'true',
  fiberNodeUrl: process.env.FIBER_NODE_URL || 'http://localhost:8227',
  fiberApiKey: process.env.FIBER_API_KEY || '',

  aiEnabled: process.env.AI_ENABLED === 'true',
  aiProvider: process.env.AI_PROVIDER || 'mock',
  openaiApiKey: process.env.OPENAI_API_KEY || '',

  authJwtSecret: process.env.AUTH_JWT_SECRET || '',
  authTokenTtlSecs: parseInt(process.env.AUTH_TOKEN_TTL_SECS || '604800', 10),
  authChallengeTtlSecs: parseInt(process.env.AUTH_CHALLENGE_TTL_SECS || '600', 10),
};

export function requireConfig(value: string, name: string) {
  if (!value) {
    throw new Error(`Missing required configuration: ${name}`);
  }

  return value;
}
