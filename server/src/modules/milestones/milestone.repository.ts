import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import type { CreateMilestoneInput } from './milestone.validation';
import type { TenantContext } from '../../common/tenancy/tenant-context';

export function createMilestone(tenant: TenantContext, agreementId: string, input: CreateMilestoneInput & { order: number; currency: string }, tx: Prisma.TransactionClient) {
  return tx.milestone.create({
    data: {
      appId: tenant.appId,
      agreementId,
      externalReferenceId: input.externalReferenceId ?? null,
      title: input.title,
      description: input.description,
      amount: input.amount,
      currency: input.currency,
      sortOrder: input.order,
      status: 'pending',
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
    },
  });
}

export function listMilestonesForAgreement(tenant: TenantContext, agreementId: string, params: {
  limit: number;
  cursor?: string;
}) {
  return prisma.milestone.findMany({
    where: {
      appId: tenant.appId,
      agreementId,
    },
    orderBy: { sortOrder: 'asc' },
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}

export function listMilestonesForApp(tenant: TenantContext, params: {
  agreementId?: string;
  status?: string;
  limit: number;
  cursor?: string;
}) {
  return prisma.milestone.findMany({
    where: {
      appId: tenant.appId,
      ...(params.agreementId ? { agreementId: params.agreementId } : {}),
      ...(params.status ? { status: params.status } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}

export function findMilestoneForApp(tenant: TenantContext, milestoneId: string, tx?: Prisma.TransactionClient) {
  return (tx ?? prisma).milestone.findFirst({
    where: {
      id: milestoneId,
      appId: tenant.appId,
    },
  });
}

export function updateMilestoneStatus(
  tenant: TenantContext,
  milestoneId: string,
  status: string,
  tx: Prisma.TransactionClient,
) {
  return tx.milestone.update({
    where: {
      id: milestoneId,
      appId: tenant.appId,
    },
    data: {
      status,
    },
  });
}

export function getMilestoneAmountSumForAgreement(tenant: TenantContext, agreementId: string, tx: Prisma.TransactionClient) {
  return tx.milestone.findMany({
    where: { agreementId, appId: tenant.appId },
    select: { amount: true },
  });
}

export function getNextMilestoneOrder(tenant: TenantContext, agreementId: string, tx: Prisma.TransactionClient) {
  return tx.milestone.findFirst({
    where: { agreementId, appId: tenant.appId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });
}
