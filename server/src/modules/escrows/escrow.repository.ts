import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import type { CreateEscrowInput } from './escrow.validation';
import type { TenantContext } from '../../common/tenancy/tenant-context';

export function createEscrow(tenant: TenantContext, input: CreateEscrowInput, tx: Prisma.TransactionClient) {
  return tx.escrow.create({
    data: {
      appId: tenant.appId,
      agreementId: input.agreementId,
      milestoneId: input.milestoneId ?? null,
      amount: input.amount,
      currency: input.currency,
      rail: input.rail,
      network: input.network,
      status: 'not_created',
    },
  });
}

export function updateEscrow(
  tenant: TenantContext,
  escrowId: string,
  data: Prisma.EscrowUpdateInput,
  tx: Prisma.TransactionClient,
) {
  return tx.escrow.update({
    where: {
      id_appId: {
        id: escrowId,
        appId: tenant.appId,
      },
    },
    data,
  });
}

export function transitionEscrowStatus(
  tenant: TenantContext,
  escrowId: string,
  fromStatus: string,
  data: Prisma.EscrowUpdateInput,
  tx: Prisma.TransactionClient,
) {
  return tx.escrow.updateMany({
    where: {
      id: escrowId,
      appId: tenant.appId,
      status: fromStatus,
    },
    data,
  });
}

export function findEscrowForApp(tenant: TenantContext, escrowId: string, tx?: Prisma.TransactionClient) {
  return (tx ?? prisma).escrow.findFirst({
    where: {
      id: escrowId,
      appId: tenant.appId,
    },
  });
}

export function listEscrowsForApp(tenant: TenantContext, params: {
  agreementId?: string;
  status?: string;
  limit: number;
  cursor?: string;
}) {
  return prisma.escrow.findMany({
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

export function findTerminalEscrowForAgreement(tenant: TenantContext, agreementId: string, tx: Prisma.TransactionClient) {
  return tx.escrow.findFirst({
    where: {
      appId: tenant.appId,
      agreementId,
      milestoneId: null,
      status: {
        in: ['released', 'refunded'],
      },
    },
  });
}

export function findTerminalEscrowForMilestone(tenant: TenantContext, milestoneId: string, tx: Prisma.TransactionClient) {
  return tx.escrow.findFirst({
    where: {
      appId: tenant.appId,
      milestoneId,
      status: {
        in: ['released', 'refunded'],
      },
    },
  });
}

export function listEscrowsForAgreement(tenant: TenantContext, agreementId: string, tx: Prisma.TransactionClient) {
  return tx.escrow.findMany({
    where: {
      appId: tenant.appId,
      agreementId,
    },
    select: {
      id: true,
      milestoneId: true,
      status: true,
    },
  });
}
