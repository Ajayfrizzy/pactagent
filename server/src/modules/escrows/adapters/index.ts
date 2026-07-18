import { invalidRequest } from '../../../common/errors/app-error';
import type { EscrowAdapter } from './escrow-adapter.interface';
import { CkbEscrowAdapter } from './ckb-escrow.adapter';
import { ManualEscrowAdapter } from './manual-escrow.adapter';
import { MockEscrowAdapter } from './mock-escrow.adapter';

export function getEscrowAdapter(rail: string): EscrowAdapter {
  switch (rail) {
    case 'mock':
      return new MockEscrowAdapter();
    case 'manual':
      return new ManualEscrowAdapter();
    case 'ckb':
      return new CkbEscrowAdapter();
    default:
      throw invalidRequest(`Unsupported escrow rail: ${rail}.`, 'unsupported_escrow_rail');
  }
}
