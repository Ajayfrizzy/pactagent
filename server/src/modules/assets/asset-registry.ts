import { invalidRequest } from '../../common/errors/app-error';

export type AssetId = `asset:v1:${string}`;
export type Asset = Readonly<{
  version: 1; id: AssetId; chain: 'ckb' | 'sandbox'; network: string;
  deployment: string; kind: 'native' | 'synthetic'; token: string;
  decimals: number; maxBaseUnits: string; symbol: string;
}>;
// Named network identity, not a claim of verified genesis or escrow deployment.
// Mainnet is deliberately absent. Historical mainnet records stay on v1.
export const CKB_TESTNET: Asset = Object.freeze({
  version: 1, id: 'asset:v1:ckb:aggron4/native:ckb', chain: 'ckb',
  network: 'ckb:aggron4', deployment: 'native', kind: 'native', token: 'ckb',
  decimals: 8, maxBaseUnits: '18446744073709551615', symbol: 'CKB',
});
export const SANDBOX: Asset = Object.freeze({
  version: 1, id: 'asset:v1:sandbox:local/synthetic:units', chain: 'sandbox',
  network: 'sandbox:local', deployment: 'synthetic:v1', kind: 'synthetic', token: 'units',
  decimals: 0, maxBaseUnits: ((1n << 256n) - 1n).toString(), symbol: 'TEST',
});
export const BASE_SEPOLIA_CANDIDATE = Object.freeze({
  status: 'unavailable' as const, chain: 'eip155', network: 'eip155:84532',
  symbol: 'USDC', candidateDecimals: 6, token: null, deployment: null, assetId: null,
  reason: 'M2 requires verified issuer/token, genesis/network and escrow deployment evidence.',
});
export const assets: readonly Asset[] = Object.freeze([CKB_TESTNET, SANDBOX]);
export function resolveAsset(id: string): Asset {
  const asset = assets.find((entry) => entry.id === id);
  if (!asset) throw invalidRequest('Unregistered asset identity.', 'unsupported_asset');
  return asset;
}
export function assertAssetIdentity(input: Asset): Asset {
  const asset = resolveAsset(input.id);
  for (const key of Object.keys(asset) as (keyof Asset)[]) {
    if (asset[key] !== input[key]) throw invalidRequest('Asset identity mismatch.', 'unsupported_asset');
  }
  return asset;
}
export function baseUnits(assetId: string, value: string, positive = false): bigint {
  const asset = resolveAsset(assetId);
  if (typeof value !== 'string' || value.length > asset.maxBaseUnits.length || !/^(0|[1-9]\d*)$/.test(value)) {
    throw invalidRequest('Expected canonical integer base units.', 'invalid_amount');
  }
  const n = BigInt(value);
  if (n > BigInt(asset.maxBaseUnits) || (positive && n === 0n)) throw invalidRequest('Amount out of range.', 'amount_out_of_range');
  return n;
}
export function addAmounts(a: { assetId: string; value: string }, b: { assetId: string; value: string }) {
  if (a.assetId !== b.assetId) throw invalidRequest('Mixed asset arithmetic.', 'asset_mismatch');
  const value = (baseUnits(a.assetId, a.value) + baseUnits(b.assetId, b.value)).toString();
  baseUnits(a.assetId, value);
  return { assetId: a.assetId, value };
}
export function legacyAsset(input: { rail: string; network: string; currency: string }) {
  return input.rail === 'ckb' && input.network === 'testnet' && input.currency === 'CKB'
    ? { status: 'legacy_translation' as const, asset: CKB_TESTNET, deployment: null }
    : { status: 'legacy_unverified' as const, asset: null, deployment: null };
}
