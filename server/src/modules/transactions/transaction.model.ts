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
  txHash: string | null;
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
    txHash: transaction.txHash,
    amount: transaction.amount,
    currency: transaction.currency,
    rawPayload: parsePayload(transaction.rawPayloadJson),
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
  };
}
