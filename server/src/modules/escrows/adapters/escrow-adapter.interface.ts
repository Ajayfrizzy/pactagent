export type EscrowAdapterCreateInput = {
  escrowId: string;
  appId: string;
  agreementId: string;
  milestoneId?: string | null;
  amount: string;
  currency: string;
  rail: string;
  network: string;
  milestoneIndex?: number | null;
  clientLockScript?: unknown;
  workerLockScript?: unknown;
  refundTimeoutSince?: string | null;
};

export type EscrowAdapterResult = {
  status: string;
  lockAddress?: string | null;
  txHash?: string | null;
  rawPayload?: unknown;
  lockOutputIndex?: number | null;
  lockScript?: unknown;
  clientLockScript?: unknown;
  workerLockScript?: unknown;
  cellData?: string | null;
  contractVersion?: number | null;
  refundTimeoutSince?: string | null;
  confirmations?: number;
  blockHash?: string | null;
  blockNumber?: string | null;
};

export type EscrowAdapterContext = {
  escrowId: string;
  amount: string;
  currency: string;
  network: string;
  lockTxHash?: string | null;
  lockOutputIndex?: number | null;
  lockScriptJson?: string | null;
  clientLockScriptJson?: string | null;
  workerLockScriptJson?: string | null;
  cellData?: string | null;
  refundTimeoutSince?: string | null;
};

export interface EscrowAdapter {
  createEscrowLock(input: EscrowAdapterCreateInput): Promise<EscrowAdapterResult>;
  checkFundingStatus(input: EscrowAdapterContext): Promise<EscrowAdapterResult>;
  markFunded(input: EscrowAdapterContext & { txHash?: string | null }): Promise<EscrowAdapterResult>;
  release(input: EscrowAdapterContext): Promise<EscrowAdapterResult>;
  refund(input: EscrowAdapterContext): Promise<EscrowAdapterResult>;
  getTransactionStatus(input: { txHash: string }): Promise<EscrowAdapterResult>;
  checkSettlementStatus(input: EscrowAdapterContext & {
    operation: 'release' | 'refund';
    txHash: string;
  }): Promise<EscrowAdapterResult>;
}
