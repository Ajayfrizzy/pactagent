export type TransactionRecord = {
  id: string;
  appId: string;
  agreementId: string | null;
  milestoneId: string | null;
  escrowId: string | null;
  type: string;
  rail: string;
  network: string;
  status: string;
  operationId: string | null;
  txHash: string | null;
  blockHash: string | null;
  blockNumber: string | null;
  confirmations: number;
  lastCheckedAt: Date | null;
  broadcastAt: Date | null;
  confirmedAt: Date | null;
  reconciliationError: string | null;
  amount: string;
  currency: string;
  rawPayloadJson: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function parsePayload(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function serializeTransaction(transaction: TransactionRecord) {
  return {
    id: transaction.id,
    appId: transaction.appId,
    agreementId: transaction.agreementId,
    milestoneId: transaction.milestoneId,
    escrowId: transaction.escrowId,
    type: transaction.type,
    rail: transaction.rail,
    network: transaction.network,
    status: transaction.status,
    operationId: transaction.operationId,
    txHash: transaction.txHash,
    blockHash: transaction.blockHash,
    blockNumber: transaction.blockNumber,
    confirmations: transaction.confirmations,
    lastCheckedAt: transaction.lastCheckedAt?.toISOString() ?? null,
    broadcastAt: transaction.broadcastAt?.toISOString() ?? null,
    confirmedAt: transaction.confirmedAt?.toISOString() ?? null,
    reconciliationError: transaction.reconciliationError,
    amount: transaction.amount,
    currency: transaction.currency,
    rawPayload: parsePayload(transaction.rawPayloadJson),
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
  };
}
