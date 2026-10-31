import { SANDBOX } from '../assets/asset-registry';
import type { FundingTerms } from './funding-terms';
export function sampleTerms(overrides: Partial<FundingTerms> = {}): FundingTerms {
  return {
    version: 1, protocol: 'PactAgent:application-terms', appId: 'app-a', agreementId: 'agreement-a',
    milestoneId: null, escrowId: 'escrow-a', network: SANDBOX.network, deploymentId: 'synthetic:v1', assetId: SANDBOX.id,
    principal: '1000', clientFeeDeposit: '20', clientFeeBps: 200, workerFeeBps: 300,
    feeAlgorithm: 'worker-principal-floor-v1', feePolicyVersion: 'product-2026-10-31',
    treasury: { recipient: 'synthetic-treasury', version: '1' },
    client: { recipient: 'synthetic-client', signingIdentity: 'client', bindingVersion: '1' },
    worker: { recipient: 'synthetic-worker', signingIdentity: 'worker', bindingVersion: '1' },
    fallback: { workerPrincipal: '370', clientPrincipal: '630', deadline: '100', timing: 'exclusive-proposed', policyVersion: '1' },
    fundingExpiry: { value: '90', enforcement: 'application-only' }, arbitration: { kind: 'none' },
    bounds: { minPrincipal: '1', maxFunding: SANDBOX.maxBaseUnits }, capacity: null,
    billing: { kind: 'separate-app-liability-unimplemented', rateVersion: null }, finalityPolicyVersion: 'unavailable-v1',
    ...overrides,
  };
}
