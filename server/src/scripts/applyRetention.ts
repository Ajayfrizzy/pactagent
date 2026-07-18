import { config } from '../config';
import { prisma } from '../db';
import { cleanupExpiredIdempotencyKeys } from '../common/idempotency/idempotency.repository';

const cutoff = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

async function main() {
  const [webhooks, events, jobs, idempotency] = await prisma.$transaction([
    prisma.webhookDelivery.deleteMany({
      where: { status: { in: ['DELIVERED', 'FAILED'] }, updatedAt: { lt: cutoff(config.webhookRetentionDays) } },
    }),
    prisma.event.deleteMany({
      where: { createdAt: { lt: cutoff(config.eventRetentionDays) }, webhookDeliveries: { none: {} } },
    }),
    prisma.agentJob.deleteMany({
      where: { status: { in: ['COMPLETED', 'DEAD_LETTER'] }, updatedAt: { lt: cutoff(config.jobRetentionDays) } },
    }),
    cleanupExpiredIdempotencyKeys(),
  ]);
  const archived = await prisma.$queryRaw<Array<{ pactagent_archive_audit_logs: bigint }>>`
    SELECT pactagent_archive_audit_logs(${cutoff(config.auditArchiveAfterDays)})
  `;
  console.log(JSON.stringify({
    webhookDeliveriesDeleted: webhooks.count,
    eventsDeleted: events.count,
    jobsDeleted: jobs.count,
    idempotencyKeysDeleted: idempotency.count,
    auditLogsArchived: String(archived[0]?.pactagent_archive_audit_logs ?? 0),
  }));
}

main().finally(() => prisma.$disconnect());
