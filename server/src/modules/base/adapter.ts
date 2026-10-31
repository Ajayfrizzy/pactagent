import { termsHash, uint, bytes32, addressWord, type Terms } from './codec';
import { observeLocalSettlement, type Rpc, type VerifiedObservation } from './observer';

export const BASE_EXECUTION_CAPABILITY = Object.freeze({ rail: 'base', network: 'eip155:84532', status: 'unavailable',
  contractVersion: null, deploymentId: null, financialWrites: false, signingPayloads: false,
  reason: 'Local implementation only; independent identity/provenance/finality and engineering/security review remain required.' });

// A separate local type avoids silently upgrading the M1 candidate or legacy adapter.
export class LocalBaseAdapter {
  constructor(private readonly binding: { instance: string; codeHash: string; terms: Terms },
    private readonly providers: readonly { operator: string; rpc: Rpc }[]) {
    addressWord(binding.instance); bytes32(binding.codeHash); termsHash(binding.terms);
    this.binding = structuredClone(binding);
  }
  async observe(transactionId: string, workerPrincipal: string, path: 0 | 1 | 2, previous?: VerifiedObservation) {
    bytes32(transactionId);
    const t = this.binding.terms, p = uint(t.principal), w = uint(workerPrincipal);
    if (w > p || (path === 2 && w !== uint(t.fallbackWorker))) throw new Error('invalid_allocation');
    const reserve = p * uint(t.clientBps) / 10000n, fc = w * uint(t.clientBps) / 10000n, fw = w * uint(t.workerBps) / 10000n;
    return observeLocalSettlement({ chainId: '31337', ...this.binding, token: t.token, termsHash: termsHash(t), escrowId: t.escrowId,
      transactionId, policyVersion: 'local-two-provider-v1', workerPrincipal, clientPrincipal: (p-w).toString(),
      workerNet: (w-fw).toString(), clientNet: (p-w+reserve-fc).toString(), treasuryNet: (fc+fw).toString(), path }, this.providers, previous);
  }
}
