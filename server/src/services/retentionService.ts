import { Counter, Histogram } from 'prom-client';
import { config } from '../config';
import { prisma } from '../db';
import { metricsRegistry } from '../common/observability/metrics';

const retentionRows = new Counter({
  name: 'pactagent_retention_rows_total', help: 'Rows selected by retention class and action.',
  labelNames: ['record_class', 'action'] as const, registers: [metricsRegistry],
});
const retentionDuration = new Histogram({
  name: 'pactagent_retention_duration_seconds', help: 'Retention execution duration by mode.',
  labelNames: ['mode'] as const, registers: [metricsRegistry],
});

export type RetentionOptions = { dryRun: boolean; batchSize: number; maxBatches: number; now?: Date };
export type RetentionClass = 'idempotency' | 'webhook_delivery' | 'event' | 'job' | 'audit_archive';
export type RetentionResult = { recordClass: RetentionClass; eligible: number; affected: number; batches: number; truncated: boolean };
export type RetentionDatabase = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

export function retentionCutoffs(now = new Date()) {
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
  return {
    idempotency: now,
    webhookDelivery: daysAgo(config.webhookRetentionDays),
    event: daysAgo(config.eventRetentionDays),
    job: daysAgo(config.jobRetentionDays),
    auditArchive: daysAgo(config.auditArchiveAfterDays),
  };
}

type Definition = {
  recordClass: RetentionClass;
  countSql: string;
  mutateSql: string;
  cutoff: Date;
  action: 'delete' | 'archive';
};

function definitions(now: Date): Definition[] {
  const cutoff = retentionCutoffs(now);
  return [
    {
      recordClass: 'idempotency', cutoff: cutoff.idempotency, action: 'delete',
      countSql: `SELECT COUNT(*)::int AS count FROM "IdempotencyKey" WHERE "expiresAt" <= $1 OR (status = 'pending' AND "processingExpiresAt" <= $1)`,
      mutateSql: `WITH candidates AS (SELECT id FROM "IdempotencyKey" WHERE "expiresAt" <= $1 OR (status = 'pending' AND "processingExpiresAt" <= $1) ORDER BY "expiresAt", id LIMIT $2) DELETE FROM "IdempotencyKey" target USING candidates WHERE target.id = candidates.id RETURNING target.id`,
    },
    {
      recordClass: 'webhook_delivery', cutoff: cutoff.webhookDelivery, action: 'delete',
      countSql: `SELECT COUNT(*)::int AS count FROM "WebhookDelivery" WHERE status IN ('DELIVERED','FAILED') AND "updatedAt" < $1`,
      mutateSql: `WITH candidates AS (SELECT id FROM "WebhookDelivery" WHERE status IN ('DELIVERED','FAILED') AND "updatedAt" < $1 ORDER BY "updatedAt", id LIMIT $2) DELETE FROM "WebhookDelivery" target USING candidates WHERE target.id = candidates.id RETURNING target.id`,
    },
    {
      recordClass: 'event', cutoff: cutoff.event, action: 'delete',
      countSql: `SELECT COUNT(*)::int AS count FROM "Event" event WHERE event."createdAt" < $1 AND NOT EXISTS (SELECT 1 FROM "WebhookDelivery" delivery WHERE delivery."eventId" = event.id)`,
      mutateSql: `WITH candidates AS (SELECT event.id FROM "Event" event WHERE event."createdAt" < $1 AND NOT EXISTS (SELECT 1 FROM "WebhookDelivery" delivery WHERE delivery."eventId" = event.id) ORDER BY event."createdAt", event.id LIMIT $2) DELETE FROM "Event" target USING candidates WHERE target.id = candidates.id RETURNING target.id`,
    },
    {
      recordClass: 'job', cutoff: cutoff.job, action: 'delete',
      countSql: `SELECT COUNT(*)::int AS count FROM "AgentJob" WHERE status IN ('COMPLETED','DEAD_LETTER') AND "updatedAt" < $1`,
      mutateSql: `WITH candidates AS (SELECT id FROM "AgentJob" WHERE status IN ('COMPLETED','DEAD_LETTER') AND "updatedAt" < $1 ORDER BY "updatedAt", id LIMIT $2) DELETE FROM "AgentJob" target USING candidates WHERE target.id = candidates.id RETURNING target.id`,
    },
    {
      recordClass: 'audit_archive', cutoff: cutoff.auditArchive, action: 'archive',
      countSql: `SELECT COUNT(*)::int AS count FROM "AuditLog" source LEFT JOIN "AuditLogArchive" archive ON archive.id = source.id WHERE source."createdAt" < $1 AND archive.id IS NULL`,
      mutateSql: `WITH candidates AS (SELECT source.* FROM "AuditLog" source LEFT JOIN "AuditLogArchive" archive ON archive.id = source.id WHERE source."createdAt" < $1 AND archive.id IS NULL ORDER BY source."createdAt", source.id LIMIT $2) INSERT INTO "AuditLogArchive" SELECT candidates.*, CURRENT_TIMESTAMP FROM candidates ON CONFLICT (id) DO NOTHING RETURNING id`,
    },
  ];
}

export async function runRetention(options: RetentionOptions, database: RetentionDatabase = prisma): Promise<RetentionResult[]> {
  const endTimer = retentionDuration.startTimer({ mode: options.dryRun ? 'dry_run' : 'live' });
  try {
    const results: RetentionResult[] = [];
    for (const definition of definitions(options.now ?? new Date())) {
      const countRows = await database.$queryRawUnsafe<Array<{ count: number }>>(definition.countSql, definition.cutoff);
      const eligible = Number(countRows[0]?.count ?? 0);
      let affected = 0;
      let batches = 0;
      if (!options.dryRun) {
        while (batches < options.maxBatches && affected < eligible) {
          const rows = await database.$queryRawUnsafe<Array<{ id: string }>>(definition.mutateSql, definition.cutoff, options.batchSize);
          batches += 1;
          affected += rows.length;
          if (rows.length < options.batchSize) break;
        }
      }
      retentionRows.inc({ record_class: definition.recordClass, action: options.dryRun ? 'dry_run' : definition.action }, options.dryRun ? eligible : affected);
      results.push({ recordClass: definition.recordClass, eligible, affected, batches, truncated: !options.dryRun && affected < eligible });
    }
    return results;
  } finally {
    endTimer();
  }
}
