import { hash, bytes32, addressWord, uint } from './codec';
export type Rpc = (method: string, params: unknown[]) => Promise<unknown>;
export type LocalBinding = Readonly<{
  chainId: '31337'; instance: string; token: string; codeHash: string; termsHash: string;
  escrowId: string; transactionId: string; policyVersion: 'local-two-provider-v1';
  workerPrincipal: string; clientPrincipal: string; workerNet: string; clientNet: string; treasuryNet: string;
  path: 0 | 1 | 2;
}>;
export type VerifiedObservation = { state: 'unknown' | 'included' | 'finalized' | 'reconciliation_required';
  blockHash: string | null; blockNumber: string | null; evidenceHash: string; reason: string };
const record = (v: unknown): Record<string, any> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('invalid_rpc');
  return v as Record<string, any>;
};
const quantity = (v: unknown): bigint => {
  if (typeof v !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(v) || v.length > 66) throw new Error('invalid_quantity');
  return BigInt(v);
};
const blockHash = (v: unknown): string => `0x${bytes32(String(v))}`;
const selector = (s: string) => hash(Buffer.from(s)).slice(0, 10);
const eventTopic = hash(Buffer.from('Settled(bytes32,bytes32,uint8,uint256,uint256,uint256,uint256,uint256)'));
function hexWord(n: string) { return uint(n).toString(16).padStart(64, '0'); }
async function inspect(rpc: Rpc, b: LocalBinding) {
  if (await rpc('eth_chainId', []) !== '0x7a69') throw new Error('wrong_chain');
  const receiptValue = await rpc('eth_getTransactionReceipt', [b.transactionId]);
  if (receiptValue === null) throw new Error('missing_receipt');
  const r = record(receiptValue);
  if (r.status !== '0x1' || r.transactionHash !== b.transactionId || addressWord(r.to) !== addressWord(b.instance)) throw new Error('wrong_receipt');
  const number = quantity(r.blockNumber), bh = blockHash(r.blockHash);
  const canonical = record(await rpc('eth_getBlockByNumber', [r.blockNumber, false]));
  if (blockHash(canonical.hash) !== bh || quantity(canonical.number) !== number) throw new Error('noncanonical');
  const at = { blockHash: bh, requireCanonical: true };
  const code = await rpc('eth_getCode', [b.instance, at]);
  if (typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})+$/.test(code) || hash(Buffer.from(code.slice(2), 'hex')) !== b.codeHash) throw new Error('wrong_code');
  if (await rpc('eth_call', [{ to: b.instance, data: selector('termsHash()') }, at]) !== b.termsHash
    || await rpc('eth_call', [{ to: b.instance, data: selector('state()') }, at]) !== `0x${hexWord('3')}`) throw new Error('wrong_state');
  // Pinned termsHash binds token and all destinations; independently inspect token from terms().
  const terms = await rpc('eth_call', [{ to: b.instance, data: selector('terms()') }, at]);
  if (typeof terms !== 'string' || !/^0x[0-9a-f]+$/.test(terms) || terms.length !== 2 + 17 * 64
    || terms.slice(2 + 5 * 64, 2 + 6 * 64) !== addressWord(b.token)) throw new Error('wrong_token');
  if (!Array.isArray(r.logs)) throw new Error('missing_logs');
  const matching = r.logs.map(record).filter(l => typeof l.address === 'string' && l.address.toLowerCase() === b.instance.toLowerCase() && l.topics?.[0] === eventTopic);
  if (matching.length !== 1) throw new Error('ambiguous_event');
  const log = matching[0];
  const topics = [eventTopic, b.escrowId, b.termsHash, `0x${hexWord(String(b.path))}`];
  if (log.removed !== false || log.blockHash !== bh || log.transactionHash !== b.transactionId
    || JSON.stringify(log.topics) !== JSON.stringify(topics)
    || log.data !== `0x${[b.workerPrincipal, b.clientPrincipal, b.workerNet, b.clientNet, b.treasuryNet].map(hexWord).join('')}`) throw new Error('wrong_event');
  quantity(log.logIndex);
  const finalized = record(await rpc('eth_getBlockByNumber', ['finalized', false]));
  const fn = quantity(finalized.number), fh = blockHash(finalized.hash);
  const fc = record(await rpc('eth_getBlockByNumber', [finalized.number, false]));
  if (blockHash(fc.hash) !== fh || quantity(fc.number) !== fn) throw new Error('noncanonical_finality');
  // Recheck the receipt's canonical block after all reads; never substitute latest.
  const recheck = record(await rpc('eth_getBlockByNumber', [r.blockNumber, false]));
  if (blockHash(recheck.hash) !== bh || quantity(recheck.number) !== number || await rpc('eth_chainId', []) !== '0x7a69') throw new Error('changed_snapshot');
  return { blockHash: bh, blockNumber: number.toString(), finalizedHash: fh, finalizedNumber: fn.toString(),
    final: fn >= number, logIndex: log.logIndex };
}
// Local-only verifier, deliberately not connected to live Base adapters/routes.
// Provider operator identities come from trusted harness configuration, never API input.
export async function observeLocalSettlement(b: LocalBinding, providers: readonly { operator: string; rpc: Rpc }[], previous?: VerifiedObservation): Promise<VerifiedObservation> {
  const uncertain = (reason: string): VerifiedObservation => ({ state: previous && ['finalized', 'reconciliation_required'].includes(previous.state) ? 'reconciliation_required' : 'unknown',
    blockHash: previous?.blockHash ?? null, blockNumber: previous?.blockNumber ?? null, evidenceHash: hash(Buffer.from(reason)), reason });
  if (b.chainId !== '31337' || b.policyVersion !== 'local-two-provider-v1' || providers.length !== 2
    || !providers[0].operator || !providers[1].operator || providers[0].operator === providers[1].operator) return uncertain('unavailable_policy');
  try {
    const result = await Promise.all(providers.map(p => inspect(p.rpc, b)));
    if (JSON.stringify(result[0]) !== JSON.stringify(result[1])) return uncertain('provider_disagreement');
    const proof = result[0];
    if (previous?.state === 'reconciliation_required' || (previous?.blockHash && previous.blockHash !== proof.blockHash)) {
      return { ...uncertain('changed_block'), state: 'reconciliation_required' };
    }
    if (previous?.state === 'finalized' && !proof.final) return uncertain('finality_regressed');
    return { state: proof.final ? 'finalized' : 'included', blockHash: proof.blockHash, blockNumber: proof.blockNumber,
      evidenceHash: hash(Buffer.from(JSON.stringify(result))), reason: 'local_verified' };
  } catch { return uncertain('missing_or_invalid_evidence'); }
}
