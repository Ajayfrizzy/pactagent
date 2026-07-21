import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import type { CreateProofInput, ProofListQuery } from './proof.validation';
import type { TenantContext } from '../../common/tenancy/tenant-context';

export function createProofContentHash(input: Pick<CreateProofInput, 'type' | 'content' | 'links' | 'fileRefs'>) {
  return createHash('sha256')
    .update(JSON.stringify({
      type: input.type,
      content: input.content,
      links: input.links,
      fileRefs: input.fileRefs,
    }))
    .digest('hex');
}

export function createProof(tenant: TenantContext, input: CreateProofInput, tx: Prisma.TransactionClient) {
  return tx.proof.create({
    data: {
      appId: tenant.appId,
      agreementId: input.agreementId,
      milestoneId: input.milestoneId,
      submittedByExternalId: input.submittedByExternalId,
      proofType: input.type,
      content: input.content,
      contentHash: createProofContentHash(input),
      linksJson: JSON.stringify(input.links),
      fileRefsJson: JSON.stringify(input.fileRefs),
      status: 'submitted',
      reviewStatus: 'UNREVIEWED',
    },
  });
}

export function listProofsForApp(tenant: TenantContext, params: ProofListQuery) {
  return prisma.proof.findMany({
    where: {
      appId: tenant.appId,
      ...(params.agreementId ? { agreementId: params.agreementId } : {}),
      ...(params.milestoneId ? { milestoneId: params.milestoneId } : {}),
      ...(params.status ? { status: params.status } : {}),
    },
    orderBy: { submittedAt: 'desc' },
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}

export function findProofForApp(tenant: TenantContext, proofId: string, tx?: Prisma.TransactionClient) {
  return (tx ?? prisma).proof.findFirst({
    where: {
      id: proofId,
      appId: tenant.appId,
    },
  });
}

export function updateProofStatus(
  tenant: TenantContext,
  proofId: string,
  data: {
    status: string;
    reviewStatus?: string;
  },
  tx: Prisma.TransactionClient,
) {
  return tx.proof.update({
    where: {
      id: proofId,
      appId: tenant.appId,
    },
    data,
  });
}
