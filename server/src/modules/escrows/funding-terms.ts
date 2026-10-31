import { createHash } from 'node:crypto';
import { z } from 'zod';
import { baseUnits, resolveAsset } from '../assets/asset-registry';
import { invalidRequest } from '../../common/errors/app-error';

const identity = z.string().min(1).max(512);
const integer = z.string().max(78).regex(/^(0|[1-9]\d*)$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const participant = z.object({ recipient: identity, signingIdentity: identity, bindingVersion: identity }).strict();
export const fundingTermsSchema = z.object({
  version: z.literal(1), protocol: z.literal('PactAgent:application-terms'),
  appId: identity, agreementId: identity, milestoneId: identity.nullable(), escrowId: identity,
  network: identity, deploymentId: identity, assetId: identity,
  principal: integer, clientFeeDeposit: integer,
  clientFeeBps: z.number().int().min(0).max(1000), workerFeeBps: z.number().int().min(0).max(1000),
  feeAlgorithm: z.literal('worker-principal-floor-v1'), feePolicyVersion: identity,
  treasury: z.object({ recipient: identity, version: identity }).strict(),
  client: participant, worker: participant,
  fallback: z.object({
    workerPrincipal: integer, clientPrincipal: integer, deadline: integer,
    timing: z.enum(['lower-bound-competing', 'exclusive-proposed']), policyVersion: identity,
  }).strict(),
  fundingExpiry: z.object({ value: integer, enforcement: z.enum(['application-only', 'chain-proposed']) }).strict(),
  arbitration: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }).strict(),
    z.object({ kind: z.literal('proposed'), verifier: identity, policyVersion: identity,
      policyHash: hash, verificationDependencies: z.array(z.object({ identity, codeHash: hash }).strict()).min(1),
    }).strict(),
  ]),
  bounds: z.object({ minPrincipal: integer, maxFunding: integer }).strict(),
  capacity: z.object({ amount: integer, assetId: identity, owner: identity, topUpPolicyVersion: identity }).strict().nullable(),
  billing: z.object({ kind: z.literal('separate-app-liability-unimplemented'), rateVersion: identity.nullable() }).strict(),
  finalityPolicyVersion: identity,
}).strict();
export type FundingTerms = Readonly<z.infer<typeof fundingTermsSchema>>;

export function allocate(assetId: string, principal: string, workerPrincipal: string, clientBps: number, workerBps: number) {
  for (const bps of [clientBps, workerBps]) {
    if (!Number.isInteger(bps) || bps < 0 || bps > 1000) throw invalidRequest('Fee exceeds approved policy.', 'invalid_fee_policy');
  }
  const p = baseUnits(assetId, principal, true), w = baseUnits(assetId, workerPrincipal);
  if (w > p) throw invalidRequest('Allocation exceeds principal.', 'invalid_settlement_split');
  const deposit = p * BigInt(clientBps) / 10000n;
  const clientEarned = w * BigInt(clientBps) / 10000n;
  const workerFee = w * BigInt(workerBps) / 10000n;
  const amounts = {
    principalWorker: w, principalClient: p - w, clientFeeDeposit: deposit,
    clientFeeEarned: clientEarned, clientFeeReturned: deposit - clientEarned, workerFee,
    workerNet: w - workerFee, clientNet: p - w + deposit - clientEarned,
    treasuryNet: clientEarned + workerFee, fundingRequired: p + deposit,
  };
  return Object.fromEntries(Object.entries(amounts).map(([k, v]) => {
    baseUnits(assetId, v.toString());
    return [k, v.toString()];
  })) as { [K in keyof typeof amounts]: string };
}

// Application storage commitment ONLY. Not EIP-712, a CKB witness or a signing codec.
// UTF-8 JSON, sorted ASCII schema keys recursively, array order preserved, no whitespace.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  throw invalidRequest('Unsupported commitment value.', 'invalid_terms');
}
export function commitment(domain: 'terms' | 'intent' | 'operation' | 'artifact', value: unknown): string {
  return createHash('sha256').update(`PactAgent:application:${domain}:v1\n`).update(canonicalJson(value), 'utf8').digest('hex');
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
export function freezeTerms(input: unknown) {
  const parsed = fundingTermsSchema.safeParse(input);
  if (!parsed.success) throw invalidRequest('Invalid funding terms.', 'invalid_terms');
  const terms = parsed.data;
  const asset = resolveAsset(terms.assetId);
  if (terms.network !== asset.network) throw invalidRequest('Terms network does not match asset.', 'unsupported_asset');
  const amounts = allocate(terms.assetId, terms.principal, terms.fallback.workerPrincipal, terms.clientFeeBps, terms.workerFeeBps);
  if (amounts.principalClient !== terms.fallback.clientPrincipal || amounts.clientFeeDeposit !== terms.clientFeeDeposit) {
    throw invalidRequest('Terms allocation or fee reserve mismatch.', 'terms_mismatch');
  }
  if (baseUnits(terms.assetId, terms.bounds.minPrincipal, true) > BigInt(terms.principal)
    || baseUnits(terms.assetId, terms.bounds.maxFunding, true) < BigInt(amounts.fundingRequired)) {
    throw invalidRequest('Terms bounds violated.', 'amount_out_of_range');
  }
  if (terms.fallback.deadline === '0' || terms.fundingExpiry.value === '0') throw invalidRequest('Explicit positive deadline required.', 'invalid_terms');
  if (asset.chain === 'ckb' && (terms.fallback.timing !== 'lower-bound-competing' || terms.fundingExpiry.enforcement !== 'application-only')) {
    throw invalidRequest('CKB upper cutoff is unproven.', 'unsupported_rail_capability');
  }
  if (terms.capacity) {
    const capacityAsset = resolveAsset(terms.capacity.assetId);
    if (capacityAsset.chain !== 'ckb' || capacityAsset.network !== terms.network) throw invalidRequest('Capacity asset mismatch.', 'unsupported_asset');
    const capacity = baseUnits(terms.capacity.assetId, terms.capacity.amount);
    if (terms.capacity.assetId === terms.assetId) baseUnits(terms.assetId, (BigInt(amounts.fundingRequired) + capacity).toString());
  }
  return deepFreeze({ terms, termsHash: commitment('terms', terms), canonical: canonicalJson(terms) });
}
export function mutualIntent(input: unknown, workerPrincipal: string, clientPrincipal: string, revision: string) {
  const { terms, termsHash } = freezeTerms(input);
  if (!/^(0|[1-9]\d*)$/.test(revision) || revision.length > 78) throw invalidRequest('Invalid revision.', 'invalid_terms');
  const allocation = allocate(terms.assetId, terms.principal, workerPrincipal, terms.clientFeeBps, terms.workerFeeBps);
  if (allocation.principalClient !== clientPrincipal) throw invalidRequest('W + C must equal P.', 'invalid_settlement_split');
  const intent = { version: 1, action: 'mutual', nonce: '0', revision, termsHash,
    appId: terms.appId, escrowId: terms.escrowId, assetId: terms.assetId,
    deploymentId: terms.deploymentId, network: terms.network, allocation, authorization: 'unauthorized' };
  return deepFreeze({ intent, intentHash: commitment('intent', intent) });
}
