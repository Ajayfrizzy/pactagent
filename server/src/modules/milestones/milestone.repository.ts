import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import type { CreateMilestoneInput } from './milestone.validation';

export function createMilestone(appId: string, agreementId: string, input: CreateMilestoneInput & { order: number; currency: string }, tx: Prisma.TransactionClient) {
  return tx.milestone.create({
    data: {
      appId,
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

export function listMilestonesForAgreement(appId: string, agreementId: string, params: {
  limit: number;
  cursor?: string;
}) {
  return prisma.milestone.findMany({
    where: {
      appId,
      agreementId,
    },
    orderBy: { sortOrder: 'asc' },
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}

export function listMilestonesForApp(appId: string, params: {
  agreementId?: string;
  status?: string;
  limit: number;
  cursor?: string;
}) {
  return prisma.milestone.findMany({
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

export function findMilestoneForApp(appId: string, milestoneId: string, tx?: Prisma.TransactionClient) {
  return (tx ?? prisma).milestone.findFirst({
    where: {
      id: milestoneId,
      appId,
    },
  });
}

export function updateMilestoneStatus(
  appId: string,
  milestoneId: string,
  status: string,
  tx: Prisma.TransactionClient,
) {
  return tx.milestone.update({
    where: {
      id: milestoneId,
      appId,
    },
    data: {
      status,
    },
  });
}

export function getMilestoneAmountSumForAgreement(agreementId: string, tx: Prisma.TransactionClient) {
  return tx.milestone.findMany({
    where: { agreementId },
    select: { amount: true },
  });
}

export function getNextMilestoneOrder(agreementId: string, tx: Prisma.TransactionClient) {
  return tx.milestone.findFirst({
    where: { agreementId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });
}
