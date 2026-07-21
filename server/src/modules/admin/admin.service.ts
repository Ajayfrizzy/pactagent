import { prisma } from '../../db';
import { serializeAgreement } from '../agreements/agreement.model';
import { serializeApp } from '../apps/app.model';
import { serializeAuditLog } from '../audit-logs/audit-log.model';
import { serializeEscrow } from '../escrows/escrow.model';
import { serializeEvent } from '../events/event.model';
import { serializeWebhookDelivery } from '../webhooks/webhook.model';
import * as adminRepository from './admin.repository';
import type { AdminListQuery } from './admin.validation';
import { replayJob } from '../../services/jobQueueService';

export function paginateAdminRows<T extends { id?: string }>(rows: T[], limit: number, serializer: (row: T) => unknown) {
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);

  return {
    data: data.map(serializer),
    pagination: {
      limit,
      cursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    },
  };
}

async function databaseStatus() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return 'ok';
  } catch {
    return 'error';
  }
}

export async function getSystemHealth() {
  const [database, counts] = await Promise.all([
    databaseStatus(),
    adminRepository.getSystemCounts(),
  ]);

  return {
    status: database === 'ok' ? 'ok' : 'degraded',
    database,
    counts,
    timestamp: new Date().toISOString(),
  };
}

export async function listApps(query: AdminListQuery) {
  return paginateAdminRows(await adminRepository.listApps(query), query.limit, serializeApp);
}

export async function listAgreements(query: AdminListQuery) {
  return paginateAdminRows(await adminRepository.listAgreements(query), query.limit, serializeAgreement);
}

export async function listEscrows(query: AdminListQuery) {
  return paginateAdminRows(await adminRepository.listEscrows(query), query.limit, serializeEscrow);
}

export async function listEvents(query: AdminListQuery) {
  return paginateAdminRows(await adminRepository.listEvents(query), query.limit, serializeEvent);
}

export async function listWebhookDeliveries(query: AdminListQuery) {
  return paginateAdminRows(await adminRepository.listWebhookDeliveries(query), query.limit, serializeWebhookDelivery);
}

export async function listAuditLogs(query: AdminListQuery) {
  return paginateAdminRows(await adminRepository.listAuditLogs(query), query.limit, serializeAuditLog);
}

export async function listJobs(query: AdminListQuery) {
  return paginateAdminRows(await adminRepository.listJobs(query), query.limit, (job) => job);
}

export async function replayDeadLetterJob(jobId: string) {
  const job = await prisma.agentJob.findUnique({ where: { id: jobId } });
  if (!job?.agreementId) throw new Error('Dead-letter job with agreement not found.');
  return replayJob(jobId, job.agreementId);
}
