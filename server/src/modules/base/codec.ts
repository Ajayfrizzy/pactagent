import { keccak_256 } from '@noble/hashes/sha3.js';

// Provisional local-review codec; must not be served as an activated signing API.
export const DOMAIN_VERSION = '2-local-review-1';
export const TERMS_TYPE = 'Terms(bytes32 appId,bytes32 agreementId,bytes32 milestoneId,bytes32 escrowId,bytes32 applicationCommitment,address token,address client,address worker,address treasury,uint256 principal,uint256 clientBps,uint256 workerBps,bytes32 feePolicy,uint256 fallbackWorker,uint256 disputeDeadline,uint256 finalDeadline,uint256 threshold,bytes32 arbiterSetHash)';
export const ACTION_TYPES = {
  funding: 'FundingApproval(bytes32 termsHash,uint256 nonce,uint256 validUntil)',
  mutual: 'MutualSettlement(bytes32 termsHash,uint256 workerAmount,uint256 clientAmount,uint256 nonce,uint256 validUntil)',
  dispute: 'DisputeInvocation(bytes32 termsHash,uint256 nonce,uint256 validUntil)',
  arbitration: 'ArbitralSettlement(bytes32 termsHash,uint256 workerAmount,uint256 clientAmount,uint256 nonce,uint256 validUntil)',
} as const;
export type Action = keyof typeof ACTION_TYPES;
export type Terms = {
  appId: string; agreementId: string; milestoneId: string; escrowId: string; applicationCommitment: string;
  token: string; client: string; worker: string; treasury: string; principal: string;
  clientBps: string; workerBps: string; feePolicy: string; fallbackWorker: string;
  disputeDeadline: string; finalDeadline: string; threshold: string; arbiters: string[];
};
export const hash = (bytes: Uint8Array): string => `0x${Buffer.from(keccak_256(bytes)).toString('hex')}`;
const typeHash = (s: string) => hash(Buffer.from(s));
export function bytes32(s: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(s)) throw new Error('invalid_bytes32');
  return s.slice(2).toLowerCase();
}
export function addressWord(s: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(s) || BigInt(s) === 0n) throw new Error('invalid_address');
  return s.slice(2).toLowerCase().padStart(64, '0');
}
export function uint(s: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(s) || s.length > 78 || BigInt(s) >= 1n << 256n) throw new Error('invalid_uint256');
  return BigInt(s);
}
const word = (s: string) => uint(s).toString(16).padStart(64, '0');
const digestWords = (...words: string[]) => hash(Buffer.from(words.join(''), 'hex'));
export function termsHash(t: Terms): string {
  const p = uint(t.principal), bc = uint(t.clientBps), bw = uint(t.workerBps);
  const recipients = [t.client, t.worker, t.treasury].map(addressWord);
  const token = addressWord(t.token);
  if (new Set(recipients).size !== 3 || recipients.includes(token) || p === 0n || bc > 1000n || bw > 1000n
    || p + p * bc / 10000n >= 1n << 256n || uint(t.fallbackWorker) > p
    || uint(t.disputeDeadline) >= uint(t.finalDeadline) || t.arbiters.length > 16) throw new Error('invalid_terms');
  const threshold = uint(t.threshold);
  if (t.arbiters.length === 0 ? threshold !== 0n : threshold === 0n || threshold > BigInt(t.arbiters.length)) throw new Error('invalid_threshold');
  const arbiters = t.arbiters.map(addressWord);
  for (let i = 1; i < arbiters.length; i++) if (arbiters[i] <= arbiters[i - 1]) throw new Error('unsorted_or_duplicate_arbiters');
  // Solidity abi.encode(address[]): offset, array length, then padded addresses.
  const arbiterSetHash = digestWords(word('32'), word(String(arbiters.length)), ...arbiters);
  return digestWords(bytes32(typeHash(TERMS_TYPE)), ...[t.appId, t.agreementId, t.milestoneId, t.escrowId, t.applicationCommitment].map(bytes32),
    token, ...recipients, word(t.principal), word(t.clientBps), word(t.workerBps), bytes32(t.feePolicy),
    word(t.fallbackWorker), word(t.disputeDeadline), word(t.finalDeadline), word(t.threshold), bytes32(arbiterSetHash));
}
export function authorizationDigest(input: { action: Action; terms: Terms; chainId: string; instance: string; validUntil: string; workerAmount?: string }): string {
  const domain = digestWords(bytes32(typeHash('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
    bytes32(typeHash('PactAgentEscrow')), bytes32(typeHash(DOMAIN_VERSION)), word(input.chainId), addressWord(input.instance));
  const fields = [bytes32(typeHash(ACTION_TYPES[input.action])), bytes32(termsHash(input.terms))];
  if (input.action === 'mutual' || input.action === 'arbitration') {
    const w = uint(input.workerAmount ?? ''), p = uint(input.terms.principal);
    if (w > p) throw new Error('invalid_allocation');
    fields.push(word(w.toString()), word((p - w).toString()));
  } else if (input.workerAmount !== undefined) throw new Error('unexpected_allocation');
  fields.push(word('0'), word(input.validUntil));
  return hash(Buffer.from(`1901${bytes32(domain)}${bytes32(digestWords(...fields))}`, 'hex'));
}
