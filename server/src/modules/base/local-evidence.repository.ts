import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { notFound } from '../../common/errors/app-error';
import { canonicalJson } from '../escrows/funding-terms';
import type { VerifiedObservation } from './observer';

export async function appendLocalObservation(tx: Prisma.TransactionClient, tenant: TenantContext, operationId: string, observation: VerifiedObservation) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "BaseLocalOperation" WHERE "id"=${operationId} AND "appId"=${tenant.appId} FOR UPDATE`;
  if (!rows.length) throw notFound();
  const previous = await tx.baseLocalEvidence.findFirst({ where: { operationId, appId: tenant.appId }, orderBy: { sequence: 'desc' } });
  let state = observation.state;
  if (previous?.state === 'reconciliation_required' || (previous?.state === 'finalized' && state !== 'finalized')) state = 'reconciliation_required';
  if (previous?.state === 'finalized') {
    const old = JSON.parse(previous.evidenceJson) as VerifiedObservation;
    if (old.blockHash !== observation.blockHash) state = 'reconciliation_required';
  }
  const evidenceJson = canonicalJson({ ...observation, state });
  if (previous?.evidenceJson === evidenceJson) return previous;
  return tx.baseLocalEvidence.create({ data: { id: randomUUID(), appId: tenant.appId, operationId,
    sequence: (previous?.sequence ?? 0) + 1, state, evidenceJson } });
}
