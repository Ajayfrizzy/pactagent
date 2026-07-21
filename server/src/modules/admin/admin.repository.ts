import { prisma } from '../../db';
import type { AdminListQuery } from './admin.validation';

export async function getSystemCounts() {
  const [
    apps,
    activeApps,
    suspendedApps,
    agreements,
    infrastructureAgreements,
    escrows,
    fundedEscrows,
    pendingWebhookDeliveries,
    failedWebhookDeliveries,
    events,
    auditLogs,
  ] = await Promise.all([
    prisma.app.count(),
    prisma.app.count({ where: { status: 'active' } }),
    prisma.app.count({ where: { status: 'suspended' } }),
    prisma.agreement.count(),
    prisma.agreement.count({ where: { status: { in: ['draft', 'pending_acceptance', 'accepted', 'funding_required', 'funded', 'in_progress', 'proof_submitted', 'under_review', 'approved', 'release_pending', 'released', 'rejected', 'disputed', 'cancelled', 'refunded', 'expired'] } } }),
    prisma.escrow.count(),
    prisma.escrow.count({ where: { status: 'funded' } }),
    prisma.webhookDelivery.count({ where: { appId: { not: null }, status: { in: ['PENDING', 'RETRY'] } } }),
    prisma.webhookDelivery.count({ where: { appId: { not: null }, status: 'FAILED' } }),
    prisma.event.count(),
    prisma.auditLog.count({ where: { appId: { not: null } } }),
  ]);

  return {
    apps,
    activeApps,
    suspendedApps,
    agreements,
    infrastructureAgreements,
    escrows,
    fundedEscrows,
    pendingWebhookDeliveries,
    failedWebhookDeliveries,
    events,
    auditLogs,
  };
}

export function listApps(params: AdminListQuery) {
  return prisma.app.findMany({
    where: {
      ...(params.status ? { status: params.status } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}

export function listAgreements(params: AdminListQuery) {
  return prisma.agreement.findMany({
    where: {
      ...(params.appId ? { appId: params.appId } : {}),
      ...(params.status ? { status: params.status } : {}),
    },
    include: {
      milestones: {
        select: {
          id: true,
          amount: true,
          status: true,
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}

export function listEscrows(params: AdminListQuery) {
  return prisma.escrow.findMany({
    where: {
      ...(params.appId ? { appId: params.appId } : {}),
      ...(params.status ? { status: params.status } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}

export function listEvents(params: AdminListQuery) {
  return prisma.event.findMany({
    where: {
      ...(params.appId ? { appId: params.appId } : {}),
      ...(params.type ? { type: params.type } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}

export function listWebhookDeliveries(params: AdminListQuery) {
  return prisma.webhookDelivery.findMany({
    where: {
      appId: { not: null },
      ...(params.appId ? { appId: params.appId } : {}),
      ...(params.status ? { status: params.status } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}

export function listAuditLogs(params: AdminListQuery) {
  return prisma.auditLog.findMany({
    where: {
      appId: { not: null },
      ...(params.appId ? { appId: params.appId } : {}),
      ...(params.type ? { action: params.type } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}

export function listJobs(params: AdminListQuery) {
  return prisma.agentJob.findMany({
    where: {
      ...(params.status ? { status: params.status } : {}),
      ...(params.type ? { queue: params.type } : {}),
      ...(params.appId ? { agreement: { appId: params.appId } } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}
