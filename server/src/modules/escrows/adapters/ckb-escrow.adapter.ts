import { invalidRequest } from '../../../common/errors/app-error';
import type { EscrowAdapter, EscrowAdapterCreateInput, EscrowAdapterResult } from './escrow-adapter.interface';

export class CkbEscrowAdapter implements EscrowAdapter {
  async createEscrowLock(_input: EscrowAdapterCreateInput): Promise<EscrowAdapterResult> {
    throw invalidRequest('CKB escrow adapter is not implemented in this phase.', 'escrow_adapter_not_ready');
  }

  async checkFundingStatus(_input: { escrowId: string }): Promise<EscrowAdapterResult> {
    throw invalidRequest('CKB escrow adapter is not implemented in this phase.', 'escrow_adapter_not_ready');
  }

  async markFunded(_input: { escrowId: string; txHash?: string | null }): Promise<EscrowAdapterResult> {
    throw invalidRequest('CKB escrow adapter is not implemented in this phase.', 'escrow_adapter_not_ready');
  }

  async release(_input: { escrowId: string; amount: string; currency: string }): Promise<EscrowAdapterResult> {
    throw invalidRequest('CKB escrow adapter is not implemented in this phase.', 'escrow_adapter_not_ready');
  }

  async refund(_input: { escrowId: string; amount: string; currency: string }): Promise<EscrowAdapterResult> {
    throw invalidRequest('CKB escrow adapter is not implemented in this phase.', 'escrow_adapter_not_ready');
  }

  async getTransactionStatus(_input: { txHash: string }): Promise<EscrowAdapterResult> {
    throw invalidRequest('CKB escrow adapter is not implemented in this phase.', 'escrow_adapter_not_ready');
  }
}
