export type EscrowAdapterCreateInput = {
  escrowId: string;
  appId: string;
  agreementId: string;
  milestoneId?: string | null;
  amount: string;
  currency: string;
  rail: string;
  network: string;
};

export type EscrowAdapterResult = {
  status: string;
  lockAddress?: string | null;
  txHash?: string | null;
  rawPayload?: unknown;
};

export interface EscrowAdapter {
  createEscrowLock(input: EscrowAdapterCreateInput): Promise<EscrowAdapterResult>;
  checkFundingStatus(input: { escrowId: string }): Promise<EscrowAdapterResult>;
  markFunded(input: { escrowId: string; txHash?: string | null }): Promise<EscrowAdapterResult>;
  release(input: { escrowId: string; amount: string; currency: string }): Promise<EscrowAdapterResult>;
  refund(input: { escrowId: string; amount: string; currency: string }): Promise<EscrowAdapterResult>;
  getTransactionStatus(input: { txHash: string }): Promise<EscrowAdapterResult>;
}
