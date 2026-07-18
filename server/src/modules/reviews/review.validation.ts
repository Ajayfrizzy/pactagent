import { z } from 'zod';
import { REVIEW_DECISIONS } from '../proofs/proof.lifecycle';

export const reviewListQuerySchema = z.object({
  agreementId: z.string().uuid().optional(),
  milestoneId: z.string().uuid().optional(),
  proofSubmissionId: z.string().uuid().optional(),
  decision: z.enum(REVIEW_DECISIONS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type ReviewListQuery = z.infer<typeof reviewListQuerySchema>;
