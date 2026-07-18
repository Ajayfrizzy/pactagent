import { MockEscrowAdapter } from './mock-escrow.adapter';

export class ManualEscrowAdapter extends MockEscrowAdapter {
  async createEscrowLock(input: Parameters<MockEscrowAdapter['createEscrowLock']>[0]) {
    const result = await super.createEscrowLock(input);
    return {
      ...result,
      lockAddress: `manual_escrow_${input.escrowId}`,
      rawPayload: { adapter: 'manual', operation: 'createEscrowLock' },
    };
  }
}
