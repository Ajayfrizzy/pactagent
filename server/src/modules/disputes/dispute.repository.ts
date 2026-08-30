import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import type { CreateDisputeInput, DisputeListQuery, ResolveDisputeInput } from './dispute.validation';
import { statusForResolutionType } from './dispute.state-machine';
import { assertLifecycleCompareAndSwap } from '../../common/lifecycle/compare-and-swap';

export function createDispute(appId: string, input: CreateDisputeInput, tx: Prisma.TransactionClient) {
  return tx.dispute.create({
    data: {
      appId,
      agreementId: input.agreementId,
      milestoneId: input.milestoneId,
      openedByExternalId: input.openedByExternalId,
      reason: input.reason,
      evidenceLinksJson: JSON.stringify(input.evidenceLinks),
      status: 'open',
    },
  });
}

export function listDisputesForApp(appId: string, params: DisputeListQuery) {
  return prisma.dispute.findMany({
    where: {
      appId,
      ...(params.agreementId ? { agreementId: params.agreementId } : {}),
      ...(params.milestoneId ? { milestoneId: params.milestoneId } : {}),
      ...(params.status ? { status: params.status } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}

export function findDisputeForApp(appId: string, disputeId: string, tx?: Prisma.TransactionClient) {
  return (tx ?? prisma).dispute.findFirst({
    where: {
      id: disputeId,
      appId,
    },
  });
}

export function findUnresolvedDisputeForScope(
  appId: string,
  agreementId: string,
  milestoneId: string,
  tx: Prisma.TransactionClient,
) {
  return tx.dispute.findFirst({
    where: {
      appId,
      agreementId,
      milestoneId,
      status: { in: ['open', 'awaiting_response', 'under_review'] },
    },
  });
}

export function findResolvedReleaseDisputeForEscrowScope(
  appId: string,
  agreementId: string,
  milestoneId: string | null,
  tx?: Prisma.TransactionClient,
) {
  return (tx ?? prisma).dispute.findFirst({
    where: {
      appId,
      agreementId,
      ...(milestoneId ? { milestoneId } : {}),
      status: 'resolved_release',
      resolutionType: 'release',
    },
    orderBy: { resolvedAt: 'desc' },
  });
}

export async function resolveDisputeForApp(
  appId: string,
  disputeId: string,
  expectedStatus: string,
  input: ResolveDisputeInput,
  tx: Prisma.TransactionClient,
) {
  const nextStatus = statusForResolutionType(input.resolutionType);
  const result = await tx.dispute.updateMany({
    where: {
      id: disputeId,
      appId,
      status: expectedStatus,
    },
    data: {
      status: nextStatus,
      resolutionType: input.resolutionType,
      resolutionNote: input.resolutionNote ?? null,
      workerAmount: input.workerAmount ?? null,
      clientAmount: input.clientAmount ?? null,
      resolvedAt: new Date(),
    },
  });
  assertLifecycleCompareAndSwap({
    resource: 'dispute',
    affectedRows: result.count,
    expectedStatus,
    nextStatus,
  });
  return tx.dispute.findUniqueOrThrow({
    where: { id_appId: { id: disputeId, appId } },
  });
}
