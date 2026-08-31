import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import type { CreateAgreementInput } from './agreement.validation';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { assertLifecycleCompareAndSwap } from '../../common/lifecycle/compare-and-swap';

export function createAgreement(tenant: TenantContext, input: CreateAgreementInput, tx: Prisma.TransactionClient) {
  const now = new Date();

  return tx.agreement.create({
    data: {
      appId: tenant.appId,
      externalReferenceId: input.externalReferenceId ?? null,
      title: input.title,
      description: input.description,
      clientExternalId: input.clientExternalId,
      workerExternalId: input.workerExternalId,
      amount: input.totalAmount,
      currency: input.currency,
      deadlineAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      releaseMode: input.releaseMode,
      disputeMode: input.disputeMode,
      sourceType: input.sourceType ?? null,
      sourceUrl: input.sourceUrl ?? null,
      metadataJson: JSON.stringify(input.metadata),
      status: 'draft',
      settlementStatus: 'UNFUNDED',
    },
  });
}

export function listAgreementsForApp(tenant: TenantContext, params: {
  status?: string;
  externalReferenceId?: string;
  limit: number;
  cursor?: string;
}) {
  return prisma.agreement.findMany({
    where: {
      appId: tenant.appId,
      ...(params.status ? { status: params.status } : {}),
      ...(params.externalReferenceId ? { externalReferenceId: params.externalReferenceId } : {}),
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

export function findAgreementForApp(tenant: TenantContext, agreementId: string, tx?: Prisma.TransactionClient) {
  return (tx ?? prisma).agreement.findFirst({
    where: {
      id: agreementId,
      appId: tenant.appId,
    },
    include: {
      milestones: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          amount: true,
          status: true,
        },
      },
    },
  });
}

export async function transitionAgreementStatus(
  tenant: TenantContext,
  agreementId: string,
  expectedStatus: string,
  nextStatus: string,
  tx: Prisma.TransactionClient,
) {
  const result = await tx.agreement.updateMany({
    where: {
      id: agreementId,
      appId: tenant.appId,
      status: expectedStatus,
    },
    data: {
      status: nextStatus,
      ...(nextStatus === 'funding_required' ? { settlementStatus: 'FUNDING_PENDING' } : {}),
      ...(nextStatus === 'funded' ? { settlementStatus: 'FUNDED', fundingConfirmedAt: new Date() } : {}),
      ...(nextStatus === 'released' ? { settlementStatus: 'PAYOUT_CONFIRMED' } : {}),
      ...(nextStatus === 'refunded' ? { settlementStatus: 'REFUND_CONFIRMED' } : {}),
    },
  });
  assertLifecycleCompareAndSwap({
    resource: 'agreement',
    affectedRows: result.count,
    expectedStatus,
    nextStatus,
  });

  return tx.agreement.findUniqueOrThrow({
    where: { id_appId: { id: agreementId, appId: tenant.appId } },
    include: {
      milestones: {
        select: {
          id: true,
          amount: true,
          status: true,
        },
      },
    },
  });
}
