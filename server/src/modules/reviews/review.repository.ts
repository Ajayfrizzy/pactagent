import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import type { ReviewProofInput } from '../proofs/proof.validation';
import type { TenantContext } from '../../common/tenancy/tenant-context';

export function createReview(tenant: TenantContext, input: {
  agreementId: string;
  milestoneId: string;
  proofSubmissionId: string;
} & ReviewProofInput, tx: Prisma.TransactionClient) {
  return tx.review.create({
    data: {
      appId: tenant.appId,
      agreementId: input.agreementId,
      milestoneId: input.milestoneId,
      proofSubmissionId: input.proofSubmissionId,
      reviewerExternalId: input.reviewerExternalId,
      decision: input.decision,
      note: input.note ?? null,
    },
  });
}

export function listReviewsForApp(tenant: TenantContext, params: {
  agreementId?: string;
  milestoneId?: string;
  proofSubmissionId?: string;
  decision?: string;
  limit: number;
  cursor?: string;
}) {
  return prisma.review.findMany({
    where: {
      appId: tenant.appId,
      ...(params.agreementId ? { agreementId: params.agreementId } : {}),
      ...(params.milestoneId ? { milestoneId: params.milestoneId } : {}),
      ...(params.proofSubmissionId ? { proofSubmissionId: params.proofSubmissionId } : {}),
      ...(params.decision ? { decision: params.decision } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}
