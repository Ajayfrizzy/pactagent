import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import type { CreateEscrowInput } from './escrow.validation';

export function createEscrow(appId: string, input: CreateEscrowInput, tx: Prisma.TransactionClient) {
  return tx.escrow.create({
    data: {
      appId,
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
  appId: string,
  escrowId: string,
  data: Prisma.EscrowUpdateInput,
  tx: Prisma.TransactionClient,
) {
  return tx.escrow.update({
    where: {
      id_appId: {
        id: escrowId,
        appId,
      },
    },
    data,
  });
}

export function transitionEscrowStatus(
  appId: string,
  escrowId: string,
  fromStatus: string,
  data: Prisma.EscrowUpdateInput,
  tx: Prisma.TransactionClient,
) {
  return tx.escrow.updateMany({
    where: {
      id: escrowId,
      appId,
      status: fromStatus,
    },
    data,
  });
}

export function findEscrowForApp(appId: string, escrowId: string, tx?: Prisma.TransactionClient) {
  return (tx ?? prisma).escrow.findFirst({
    where: {
      id: escrowId,
      appId,
    },
  });
}

export function listEscrowsForApp(appId: string, params: {
  agreementId?: string;
  status?: string;
  limit: number;
  cursor?: string;
}) {
  return prisma.escrow.findMany({
    where: {
      appId,
      ...(params.agreementId ? { agreementId: params.agreementId } : {}),
      ...(params.status ? { status: params.status } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}

export function findTerminalEscrowForAgreement(appId: string, agreementId: string, tx: Prisma.TransactionClient) {
  return tx.escrow.findFirst({
    where: {
      appId,
      agreementId,
      milestoneId: null,
      status: {
        in: ['released', 'refunded'],
      },
    },
  });
}

export function findTerminalEscrowForMilestone(appId: string, milestoneId: string, tx: Prisma.TransactionClient) {
  return tx.escrow.findFirst({
    where: {
      appId,
      milestoneId,
      status: {
        in: ['released', 'refunded'],
      },
    },
  });
}

export function listEscrowsForAgreement(appId: string, agreementId: string, tx: Prisma.TransactionClient) {
  return tx.escrow.findMany({
    where: {
      appId,
      agreementId,
    },
    select: {
      id: true,
      milestoneId: true,
      status: true,
    },
  });
}
