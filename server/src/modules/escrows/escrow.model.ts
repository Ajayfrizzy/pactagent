export type EscrowRecord = {
  id: string;
  appId: string;
  agreementId: string;
  milestoneId: string | null;
  amount: string;
  currency: string;
  rail: string;
  network: string;
  status: string;
  lockAddress: string | null;
  lockTxHash: string | null;
  lockOutputIndex: number | null;
  lockScriptJson: string | null;
  clientLockScriptJson: string | null;
  workerLockScriptJson: string | null;
  cellData: string | null;
  contractVersion: number | null;
  refundTimeoutSince: string | null;
  releaseTxHash: string | null;
  refundTxHash: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeEscrow(escrow: EscrowRecord) {
  return {
    id: escrow.id,
    appId: escrow.appId,
    agreementId: escrow.agreementId,
    milestoneId: escrow.milestoneId,
    amount: escrow.amount,
    currency: escrow.currency,
    rail: escrow.rail,
    network: escrow.network,
    status: escrow.status,
    lockAddress: escrow.lockAddress,
    lockTxHash: escrow.lockTxHash,
    lockOutputIndex: escrow.lockOutputIndex,
    lockScript: escrow.lockScriptJson ? JSON.parse(escrow.lockScriptJson) : null,
    clientLockScript: escrow.clientLockScriptJson ? JSON.parse(escrow.clientLockScriptJson) : null,
    workerLockScript: escrow.workerLockScriptJson ? JSON.parse(escrow.workerLockScriptJson) : null,
    cellData: escrow.cellData,
    contractVersion: escrow.contractVersion,
    refundTimeoutSince: escrow.refundTimeoutSince,
    releaseTxHash: escrow.releaseTxHash,
    refundTxHash: escrow.refundTxHash,
    createdAt: escrow.createdAt.toISOString(),
    updatedAt: escrow.updatedAt.toISOString(),
  };
}
