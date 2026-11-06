// Read-only evidence collection. This tool never activates an asset or sends a transaction.
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const RPC = 'https://sepolia.base.org';
export const TOKEN = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const quantity = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const hash = /^0x[0-9a-fA-F]{64}$/;

function block(value) {
  if (!value || !quantity.test(value.number) || !hash.test(value.hash)) {
    throw new Error('missing_or_malformed_finalized_block');
  }
  return { number: value.number, hash: value.hash.toLowerCase() };
}

// Injectable transport allows deterministic negative tests without trusting a live provider.
export async function collectEvidence(call) {
  const evidence = { status: 'unavailable', activationAuthorized: false, observation: null,
    remainingGates: ['independent_provider_agreement', 'issuer_proxy_and_implementation_review',
      'deployment_provenance', 'architecture_review', 'contract_security_review', 'deployment_authorization'] };
  try {
    const chainId = await call('eth_chainId', []);
    if (chainId !== '0x14a34') throw new Error('wrong_or_malformed_chain_id');
    const finalized = block(await call('eth_getBlockByNumber', ['finalized', false]));
    // Pin all state reads to the observed canonical block hash, never latest.
    const at = { blockHash: finalized.hash, requireCanonical: true };
    const code = await call('eth_getCode', [TOKEN, at]);
    if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code) || /^0x(?:00)+$/.test(code)) {
      throw new Error('missing_or_malformed_token_code');
    }
    const decimals = await call('eth_call', [{ to: TOKEN, data: '0x313ce567' }, at]);
    if (typeof decimals !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(decimals) || BigInt(decimals) !== 6n) {
      throw new Error('wrong_or_malformed_decimals');
    }
    const canonical = block(await call('eth_getBlockByNumber', [finalized.number, false]));
    if (canonical.hash !== finalized.hash || canonical.number !== finalized.number) throw new Error('canonical_block_changed');
    if (await call('eth_chainId', []) !== chainId) throw new Error('provider_chain_changed');
    evidence.observation = { chainId: 84532, token: TOKEN, decimals: 6, block: finalized,
      // SHA-256 authenticates this evidence's bytes; it is NOT an EVM EXTCODEHASH.
      tokenCodeSha256: createHash('sha256').update(Buffer.from(code.slice(2), 'hex')).digest('hex'),
      tokenCode: code, tokenCodeKeccak256: null };
    evidence.result = 'single_provider_observation_only';
  } catch (error) {
    // Transport errors must be sanitized by the transport; do not echo URLs/credentials.
    const allowed = /^(wrong_or_malformed_chain_id|missing_or_malformed_finalized_block|missing_or_malformed_token_code|wrong_or_malformed_decimals|canonical_block_changed|provider_chain_changed)$/;
    evidence.result = allowed.test(error?.message) ? error.message : 'rpc_unavailable_or_invalid_response';
  }
  return evidence;
}

export function rpcTransport(fetchImpl = fetch) {
  let id = 0;
  const allowed = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call']);
  return async (method, params) => {
    if (!allowed.has(method)) throw new Error('read_only_transport');
    const requestId = ++id;
    const response = await fetchImpl(RPC, { method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) });
    if (!response.ok) throw new Error('rpc_http_failure');
    const data = await response.json();
    if (data?.jsonrpc !== '2.0' || data.id !== requestId || data.error || !Object.hasOwn(data, 'result')) {
      throw new Error('rpc_invalid_envelope');
    }
    return data.result;
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const evidence = await collectEvidence(rpcTransport());
  console.log(JSON.stringify({ retrievedAt: new Date().toISOString(), rpc: RPC, ...evidence }, null, 2));
  if (!evidence.observation) process.exitCode = 1;
}
