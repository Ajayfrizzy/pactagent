import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { conflict, notFound } from '../../common/errors/app-error';
import { canonicalJson } from '../escrows/funding-terms';
import { addressWord, termsHash, type Terms } from './codec';
import { sealArtifact, openArtifact, sha256, type ArtifactKey } from './artifacts';

// Internal local harness only. No live API, broadcaster, or capability activation.
export async function storeLocalEscrow(tx: Prisma.TransactionClient, tenant: TenantContext, input: {
  agreementId: string; milestoneId: string; instance: string; terms: Terms;
}) {
  const milestone = await tx.milestone.findFirst({ where: { id: input.milestoneId, agreementId: input.agreementId, appId: tenant.appId } });
  if (!milestone) throw notFound();
  // Text IDs become opaque commitments; never confuse a caller-supplied hash with authenticated scope.
  const commitId = (value: string) => `0x${sha256(value)}`;
  if (input.terms.appId !== commitId(tenant.appId) || input.terms.agreementId !== commitId(input.agreementId)
    || input.terms.milestoneId !== commitId(input.milestoneId)) throw conflict('Parent commitment mismatch.', 'terms_mismatch');
  const instance = `0x${addressWord(input.instance).slice(24)}`;
  return tx.baseLocalEscrow.create({ data: { id: randomUUID(), appId: tenant.appId,
    agreementId: input.agreementId, milestoneId: input.milestoneId, instance,
    canonicalTerms: canonicalJson(input.terms), termsHash: termsHash(input.terms), chainId: 31337 } });
}
export async function reserveLocalArtifact(tx: Prisma.TransactionClient, tenant: TenantContext, input: {
  escrowId: string; idempotencyKey: string; action: 'funding' | 'mutual' | 'dispute' | 'arbitration' | 'fallback';
  signedArtifact: string; transactionId: string;
}, key: ArtifactKey) {
  if (!input.idempotencyKey || input.idempotencyKey.length > 200 || !/^0x[0-9a-f]{64}$/.test(input.transactionId)) throw conflict('Invalid operation.', 'invalid_operation');
  // Scope-wide serialization ensures same-key races on different escrows are also deterministic.
  await tx.$queryRaw`SELECT "id" FROM "App" WHERE "id" = ${tenant.appId} FOR UPDATE`;
  const escrow = await tx.baseLocalEscrow.findFirst({ where: { id: input.escrowId, appId: tenant.appId, chainId: 31337 } });
  if (!escrow) throw notFound();
  const slot = ['mutual', 'arbitration', 'fallback'].includes(input.action) ? 'terminal' : input.action;
  const artifactHash = sha256(input.signedArtifact);
  const requestHash = sha256(canonicalJson({ escrowId: escrow.id, action: input.action, artifactHash, transactionId: input.transactionId }));
  const old = await tx.baseLocalOperation.findUnique({ where: { appId_idempotencyKey: { appId: tenant.appId, idempotencyKey: input.idempotencyKey } } });
  if (old) {
    if (old.requestHash !== requestHash) throw conflict('Idempotency payload changed.', 'idempotency_conflict');
    return old;
  }
  const id = randomUUID();
  const operation = await tx.baseLocalOperation.create({ data: { id, appId: tenant.appId, escrowId: escrow.id,
    idempotencyKey: input.idempotencyKey, slot, action: input.action, requestHash, artifactHash,
    transactionId: input.transactionId, keyVersion: key.version,
    encryptedArtifact: sealArtifact(input.signedArtifact, key, `${tenant.appId}:${id}:${escrow.termsHash}`) } });
  await tx.baseLocalEvidence.create({ data: { id: randomUUID(), appId: tenant.appId, operationId: id,
    sequence: 1, state: 'prepared', evidenceJson: canonicalJson({ artifactHash, transactionId: input.transactionId }) } });
  return operation;
}
export async function recoverLocalArtifact(tx: Prisma.TransactionClient, tenant: TenantContext, operationId: string, key: ArtifactKey) {
  const op = await tx.baseLocalOperation.findFirst({ where: { id: operationId, appId: tenant.appId } });
  if (!op) throw notFound();
  if (op.keyVersion !== key.version) throw new Error('artifact_key_version_unavailable');
  const escrow = await tx.baseLocalEscrow.findFirstOrThrow({ where: { id: op.escrowId, appId: tenant.appId } });
  const artifact = openArtifact(op.encryptedArtifact, key, `${tenant.appId}:${op.id}:${escrow.termsHash}`);
  if (sha256(artifact) !== op.artifactHash) throw new Error('artifact_integrity_failure');
  return { artifact, transactionId: op.transactionId };
}
