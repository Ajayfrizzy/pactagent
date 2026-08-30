import { createHash } from 'crypto';
import type { EscrowAdapter, EscrowAdapterCreateInput } from './escrow-adapter.interface';

function mockHash(parts: string[]) {
  return `mock_${createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 32)}`;
}

export class MockEscrowAdapter implements EscrowAdapter {
  async createEscrowLock(input: EscrowAdapterCreateInput) {
    return {
      status: 'awaiting_funding',
      lockAddress: `mock_escrow_${input.escrowId}`,
      txHash: mockHash(['lock', input.escrowId]),
      rawPayload: { adapter: 'mock', operation: 'createEscrowLock' },
    };
  }

  async checkFundingStatus(input: { escrowId: string }) {
    return {
      status: 'awaiting_funding',
      rawPayload: { adapter: 'mock', operation: 'checkFundingStatus', escrowId: input.escrowId },
    };
  }

  async markFunded(input: { escrowId: string; txHash?: string | null }) {
    return {
      status: 'funded',
      txHash: input.txHash ?? mockHash(['fund', input.escrowId]),
      rawPayload: { adapter: 'mock', operation: 'markFunded' },
    };
  }

  async release(input: { escrowId: string; amount: string; currency: string }) {
    return {
      status: 'released',
      txHash: mockHash(['release', input.escrowId]),
      rawPayload: { adapter: 'mock', operation: 'release' },
    };
  }

  async refund(input: { escrowId: string; amount: string; currency: string }) {
    return {
      status: 'refunded',
      txHash: mockHash(['refund', input.escrowId]),
      rawPayload: { adapter: 'mock', operation: 'refund' },
    };
  }

  async getTransactionStatus(input: { txHash: string }) {
    return {
      status: 'confirmed',
      txHash: input.txHash,
      rawPayload: { adapter: 'mock', operation: 'getTransactionStatus' },
    };
  }

  checkSettlementStatus(input: { txHash: string }) {
    return this.getTransactionStatus(input);
  }
}
