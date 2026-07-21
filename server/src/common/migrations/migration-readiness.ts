import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../db';

type MigrationRow = {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

export type MigrationReadiness = {
  status: 'ok' | 'missing' | 'failed';
  required: string[];
  missing: string[];
  failed: string[];
};

function defaultMigrationsDirectory() {
  const local = resolve(process.cwd(), 'prisma/migrations');
  if (existsSync(local)) return local;
  return resolve(process.cwd(), 'server/prisma/migrations');
}

export function requiredMigrationNames(migrationsDirectory = defaultMigrationsDirectory()) {
  return readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+_[a-z0-9_]+$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function evaluateMigrationReadiness(required: string[], rows: MigrationRow[]): MigrationReadiness {
  const applied = new Set(rows
    .filter((row) => row.finished_at !== null && row.rolled_back_at === null)
    .map((row) => row.migration_name));
  const failed = rows
    .filter((row) => row.finished_at === null && row.rolled_back_at === null)
    .map((row) => row.migration_name)
    .filter((name) => required.includes(name))
    .sort();
  const missing = required.filter((name) => !applied.has(name));
  return {
    status: failed.length > 0 ? 'failed' : missing.length > 0 ? 'missing' : 'ok',
    required,
    missing,
    failed,
  };
}

export async function getMigrationReadiness(client: Pick<PrismaClient, '$queryRawUnsafe'> = prisma) {
  const required = requiredMigrationNames();
  let rows: MigrationRow[];
  try {
    rows = await client.$queryRawUnsafe<MigrationRow[]>(`
      SELECT migration_name, finished_at, rolled_back_at
      FROM "_prisma_migrations"
      ORDER BY migration_name
    `);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : '';
    throw new Error(`Unable to verify required database migrations. Run prisma migrate deploy before starting the service.${detail}`);
  }
  return evaluateMigrationReadiness(required, rows);
}

export async function assertRequiredMigrationsApplied() {
  const readiness = await getMigrationReadiness();
  if (readiness.status !== 'ok') {
    throw new Error(`Database migrations are not ready: missing=[${readiness.missing.join(', ')}], failed=[${readiness.failed.join(', ')}].`);
  }
  return readiness;
}
