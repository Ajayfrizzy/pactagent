import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';

export function createTransaction(data: {
  appId: string;
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
      appId: data.appId,
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
  appId: string,
  transactionId: string,
  data: Prisma.TransactionUpdateInput,
  tx: Prisma.TransactionClient,
) {
  return tx.transaction.updateMany({
    where: {
      id: transactionId,
      appId,
    },
    data,
  });
}

export function listTransactionsForApp(appId: string, params: {
  escrowId?: string;
  agreementId?: string;
  limit: number;
  cursor?: string;
}) {
  return prisma.transaction.findMany({
    where: {
      appId,
      ...(params.escrowId ? { escrowId: params.escrowId } : {}),
      ...(params.agreementId ? { agreementId: params.agreementId } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}
