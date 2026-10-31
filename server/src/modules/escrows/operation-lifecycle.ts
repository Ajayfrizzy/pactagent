import { conflict } from '../../common/errors/app-error';

export type OperationState = 'unauthorized' | 'authorized' | 'broadcast' | 'unknown' | 'observed' | 'settled' | 'reconciliation_required';
export type FinalityPolicy =
  | { kind: 'unavailable'; version: string }
  | { kind: 'ckb-depth-canonical'; version: string; minimumDepth: number }
  | { kind: 'base-finalized'; version: string };
export type Observation = Readonly<{
  version: 1; operationId: string; deploymentId: string; network: string; transactionId: string;
  logIndex: string | null; blockHash: string | null; blockNumber: string | null;
  headHash: string | null; headNumber: string | null; policyVersion: string;
  canonical: 'verified' | 'unknown' | 'removed' | 'disagreeing';
  allocation: 'verified' | 'unknown'; confirmations: number | null;
  finalizedBlockHash: string | null; finalizedBlockNumber: string | null;
  providerEvidenceHash: string; correctionOf: string | null;
}>;
export type Operation = Readonly<{
  id: string; state: OperationState; deploymentId: string; network: string;
  transactionId: string | null; artifactHash: string | null; artifactReference: string | null;
  authorizationProofHash: string | null; policy: FinalityPolicy; lastBlockHash: string | null;
}>;
const integer = (value: string | null): value is string => value !== null && /^(0|[1-9]\d*)$/.test(value) && value.length <= 78;
const chainHash = (value: string | null): boolean => value !== null && /^0x[0-9a-f]{64}$/.test(value);
// This evaluates supplied VERIFIED evidence. It does not verify RPCs or signatures.
// There is deliberately no production verifier/writer or broadcaster in M1.
export function satisfiesFinality(policy: FinalityPolicy, observation: Observation): boolean {
  if (policy.version !== observation.policyVersion || policy.kind === 'unavailable'
    || observation.canonical !== 'verified' || observation.allocation !== 'verified'
    || !chainHash(observation.transactionId) || !chainHash(observation.blockHash) || !chainHash(observation.headHash) || !integer(observation.blockNumber)
    || !integer(observation.headNumber) || BigInt(observation.headNumber) < BigInt(observation.blockNumber)
    || !/^[a-f0-9]{64}$/.test(observation.providerEvidenceHash)) return false;
  if (policy.kind === 'ckb-depth-canonical') {
    return Number.isSafeInteger(policy.minimumDepth) && policy.minimumDepth > 0
      && Number.isSafeInteger(observation.confirmations) && observation.confirmations! >= policy.minimumDepth
      && BigInt(observation.confirmations!) === BigInt(observation.headNumber) - BigInt(observation.blockNumber) + 1n;
  }
  return chainHash(observation.finalizedBlockHash) && integer(observation.finalizedBlockNumber)
    && BigInt(observation.finalizedBlockNumber) >= BigInt(observation.blockNumber)
    && BigInt(observation.finalizedBlockNumber) <= BigInt(observation.headNumber);
}
export function beginBroadcast(operation: Operation): Operation {
  if (operation.state !== 'authorized' || !operation.authorizationProofHash || !operation.artifactHash
    || !operation.artifactReference || !operation.transactionId) throw conflict('Persist verified authorization and recoverable artifact before broadcast.', 'consent_required');
  return { ...operation, state: 'broadcast' };
}
export function broadcastTimeout(operation: Operation): Operation {
  if (operation.state !== 'broadcast') throw conflict('No broadcast is active.', 'invalid_operation_state');
  return { ...operation, state: 'unknown' };
}
export function observeOperation(operation: Operation, observation: Observation): Operation {
  if (['unauthorized', 'authorized'].includes(operation.state) || !operation.transactionId
    || !operation.authorizationProofHash || !operation.artifactHash || !operation.artifactReference) {
    throw conflict('Operation has no persisted authorized broadcast.', 'consent_required');
  }
  if (operation.id !== observation.operationId || operation.network !== observation.network
    || operation.deploymentId !== observation.deploymentId || operation.transactionId !== observation.transactionId) {
    throw conflict('Observation belongs to another semantic operation.', 'observation_mismatch');
  }
  const uncertain = observation.canonical !== 'verified' || observation.policyVersion !== operation.policy.version
    || (operation.lastBlockHash !== null && operation.lastBlockHash !== observation.blockHash);
  // A changed block always records reconciliation first, including same-tx reorgs.
  if (uncertain || operation.state === 'reconciliation_required') return { ...operation, state: 'reconciliation_required' };
  const final = satisfiesFinality(operation.policy, observation);
  if (operation.state === 'settled' && !final) return { ...operation, state: 'reconciliation_required' };
  // Unknown broadcasts first recover an observed projection; they cannot jump to paid.
  return { ...operation, state: final && operation.state !== 'unknown' ? 'settled' : 'observed', lastBlockHash: observation.blockHash };
}
