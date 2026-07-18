import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { config } from './config';
import { log } from './common/observability/logger';

const connectionString = process.env.DATABASE_URL;

export function requireDatabaseUrl() {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required.');
  }
}

export const dbPool = new Pool({
  connectionString: connectionString || 'postgresql://localhost:5432/pactagent_test_missing_database_url',
  max: config.dbPoolMax,
  idleTimeoutMillis: config.dbPoolIdleTimeoutMs,
  connectionTimeoutMillis: config.dbConnectionTimeoutMs,
  statement_timeout: config.dbStatementTimeoutMs,
  query_timeout: config.dbQueryTimeoutMs,
  application_name: `pactagent-${config.serviceRole}`,
  allowExitOnIdle: false,
});
const adapter = new PrismaPg(dbPool, {
  disposeExternalPool: true,
  onPoolError: (error) => log('error', 'database.pool.error', { error }),
  onConnectionError: (error) => log('error', 'database.connection.error', { error }),
});

// Singleton Prisma client — reused across the app
export const prisma = new PrismaClient({ adapter });
