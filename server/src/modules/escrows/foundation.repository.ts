import type { Prisma } from '@prisma/client';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { conflict, notFound } from '../../common/errors/app-error';
import { canonicalJson, commitment, freezeTerms, mutualIntent } from './funding-terms';
import { resolveAsset } from '../assets/asset-registry';

// Internal prospective persistence only. No public financial writer in M1.
export async function storeFoundation(tenant: TenantContext, input: unknown, tx: Prisma.TransactionClient) {
  const { terms, termsHash, canonical } = freezeTerms(input);
  if (terms.appId !== tenant.appId) throw notFound();
  const escrow = await tx.escrow.findFirst({ where: { id: terms.escrowId, appId: tenant.appId,
    agreementId: terms.agreementId, milestoneId: terms.milestoneId } });
  if (!escrow) throw notFound();
  const asset = resolveAsset(terms.assetId);
  if ((asset.chain === 'ckb' && (escrow.rail !== 'ckb' || escrow.network !== 'testnet'))
    || (asset.chain === 'sandbox' && (!['mock', 'manual'].includes(escrow.rail) || escrow.network !== 'sandbox'))) {
    throw conflict('Asset does not match escrow rail/network.', 'terms_mismatch');
  }
  if (!['not_created', 'awaiting_funding'].includes(escrow.status)) throw conflict('Legacy funded commitments cannot be relabeled.', 'terms_mismatch');
  const existing = await tx.escrowFoundation.findUnique({ where: { escrowId_appId: { escrowId: terms.escrowId, appId: tenant.appId } } });
  if (existing) {
    if (existing.termsHash !== termsHash) throw conflict('Immutable terms differ.', 'terms_mismatch');
    return existing;
  }
  return tx.escrowFoundation.create({ data: {
    appId: tenant.appId, escrowId: terms.escrowId, agreementId: terms.agreementId, milestoneId: terms.milestoneId,
    assetId: terms.assetId, network: terms.network, deploymentId: terms.deploymentId, termsHash, canonicalTerms: canonical,
    principal: terms.principal, clientFeeDeposit: terms.clientFeeDeposit,
    clientFeeBps: terms.clientFeeBps, workerFeeBps: terms.workerFeeBps,
    maxBaseUnits: resolveAsset(terms.assetId).maxBaseUnits, finalityPolicyVersion: terms.finalityPolicyVersion,
  } });
}
export async function reserveOperation(tenant: TenantContext, input: {
  foundationId: string; idempotencyKey: string; workerPrincipal: string; clientPrincipal: string; revision: string;
}, tx: Prisma.TransactionClient) {
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) throw conflict('Invalid idempotency key.', 'idempotency_conflict');
  const foundation = await tx.escrowFoundation.findFirst({ where: { id: input.foundationId, appId: tenant.appId } });
  if (!foundation) throw notFound();
  const { intent, intentHash } = mutualIntent(JSON.parse(foundation.canonicalTerms), input.workerPrincipal, input.clientPrincipal, input.revision);
  const requestHash = commitment('operation', { foundationId: input.foundationId, intentHash });
  const existing = await tx.settlementOperation.findUnique({ where: { appId_idempotencyKey: { appId: tenant.appId, idempotencyKey: input.idempotencyKey } } });
  if (existing) {
    if (existing.requestHash !== requestHash) throw conflict('Idempotency key payload changed.', 'idempotency_conflict');
    return existing;
  }
  // Unique foundation+nonce also reserves against competing keys/actions.
  // Caller transaction must roll back on P2002; never retry as another payment.
  return tx.settlementOperation.create({ data: {
    appId: tenant.appId, foundationId: foundation.id, idempotencyKey: input.idempotencyKey, requestHash,
    intentHash, canonicalIntent: canonicalJson(intent), principalWorker: input.workerPrincipal, principalClient: input.clientPrincipal,
  } });
}
