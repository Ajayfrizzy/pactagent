import { invalidRequest } from '../../../common/errors/app-error';

export type DeploymentBinding = Readonly<{
  rail: string; network: string; contractVersion: number | null;
  // Evidence comes from this escrow, NEVER from current global rail config.
  lockScriptJson: string | null; deploymentId: string | null;
}>;
export type RailCapabilities = {
  version: 1; binding: DeploymentBinding;
} & (
  | { kind: 'unavailable'; actions: readonly []; reason: string }
  | { kind: 'synthetic'; actions: readonly ['fund', 'release', 'refund']; signatureMode: 'none'; finality: 'synthetic-only' }
  | { kind: 'ckb-v1-unverified'; actions: readonly []; codeSemantics: typeof ckbV1Semantics; reason: string }
);
export function describeRail(binding: DeploymentBinding, expectedRail = binding.rail): RailCapabilities {
  const unavailable = (reason: string): RailCapabilities => ({ version: 1, binding, kind: 'unavailable', actions: [], reason });
  if (binding.rail !== expectedRail) return unavailable('Escrow rail does not match adapter.');
  if (['mock', 'manual'].includes(binding.rail) && binding.network === 'sandbox') {
    return { version: 1, binding, kind: 'synthetic', actions: ['fund', 'release', 'refund'], signatureMode: 'none', finality: 'synthetic-only' };
  }
  // A version label and script snapshot are evidence of the original commitment,
  // not proof that an arbitrary code hash implements this repository's script.
  if (binding.rail === 'ckb' && binding.contractVersion === 1 && binding.lockScriptJson) {
    return { version: 1, binding, kind: 'ckb-v1-unverified', actions: [], codeSemantics: ckbV1Semantics,
      reason: 'Legacy code semantics only; deployment evidence is not verified. Continue existing v1 routing.' };
  }
  return unavailable('Missing immutable deployment binding or unimplemented rail.');
}
export const ckbV1Semantics = Object.freeze({
  kind: 'ckb-v1-code-semantics', version: 1,
  actions: ['fund', 'release', 'refund', 'timeout-refund'],
  signatureMode: 'client-input-payout-or-worker-input-refund',
  expiration: 'no-upper-bound', exclusiveCutoff: 'unsupported', disputeInvocationGate: 'unsupported',
  fallback: 'lower-bound-competing-full-client-refund', arbiter: 'unsupported',
  settlement: 'single-terminal-full-capacity',
  finality: { current: 'legacy-depth-observation', required: 'versioned-depth-and-canonical-hash', m1Verifier: 'unavailable' },
});
export function requireCapability(descriptor: RailCapabilities, action: string) {
  if (!(descriptor.actions as readonly string[]).includes(action)) {
    throw invalidRequest('Capability is not supported by this escrow deployment.', 'unsupported_rail_capability');
  }
}
