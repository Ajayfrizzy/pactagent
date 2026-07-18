import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import type { CreateProofInput, ProofListQuery } from './proof.validation';

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

export function createProof(appId: string, input: CreateProofInput, tx: Prisma.TransactionClient) {
  return tx.proof.create({
    data: {
      appId,
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

export function listProofsForApp(appId: string, params: ProofListQuery) {
  return prisma.proof.findMany({
    where: {
      appId,
      ...(params.agreementId ? { agreementId: params.agreementId } : {}),
      ...(params.milestoneId ? { milestoneId: params.milestoneId } : {}),
      ...(params.status ? { status: params.status } : {}),
    },
    orderBy: { submittedAt: 'desc' },
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}

export function findProofForApp(appId: string, proofId: string, tx?: Prisma.TransactionClient) {
  return (tx ?? prisma).proof.findFirst({
    where: {
      id: proofId,
      appId,
    },
  });
}

export function updateProofStatus(
  appId: string,
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
      appId,
    },
    data,
  });
}
