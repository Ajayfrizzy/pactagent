import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import type { TenantContext } from '../../common/tenancy/tenant-context';

export function createTransaction(tenant: TenantContext, data: {
  agreementId?: string | null;
  milestoneId?: string | null;
  escrowId?: string | null;
  type: string;
  rail: string;
  network: string;
  status: string;
  txHash?: string | null;
  amount: string;
  currency: string;
  rawPayload?: unknown;
}, tx: Prisma.TransactionClient) {
  return tx.transaction.create({
    data: {
      appId: tenant.appId,
      agreementId: data.agreementId ?? null,
      milestoneId: data.milestoneId ?? null,
      escrowId: data.escrowId ?? null,
      type: data.type,
      rail: data.rail,
      network: data.network,
      status: data.status,
      txHash: data.txHash ?? null,
      amount: data.amount,
      currency: data.currency,
      rawPayloadJson: data.rawPayload === undefined ? null : JSON.stringify(data.rawPayload),
    },
  });
}

export function updateTransaction(
  tenant: TenantContext,
  transactionId: string,
  data: Prisma.TransactionUpdateInput,
  tx: Prisma.TransactionClient,
) {
  return tx.transaction.updateMany({
    where: {
      id: transactionId,
      appId: tenant.appId,
    },
    data,
  });
}

export function listTransactionsForApp(tenant: TenantContext, params: {
  escrowId?: string;
  agreementId?: string;
  limit: number;
  cursor?: string;
}) {
  return prisma.transaction.findMany({
    where: {
      appId: tenant.appId,
      ...(params.escrowId ? { escrowId: params.escrowId } : {}),
      ...(params.agreementId ? { agreementId: params.agreementId } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}
