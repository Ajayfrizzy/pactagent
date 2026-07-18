import { z } from 'zod';
import { PROOF_STATUSES, REVIEW_DECISIONS } from './proof.lifecycle';

const proofLinkSchema = z.string().url().max(2048);

export const createProofSchema = z.object({
  agreementId: z.string().uuid(),
  milestoneId: z.string().uuid(),
  submittedByExternalId: z.string().trim().min(1).max(160),
  type: z.enum(['text', 'url', 'file', 'github', 'mixed']),
  content: z.string().trim().min(1).max(20000),
  links: z.array(proofLinkSchema).max(10).default([]),
  fileRefs: z.array(z.string().trim().min(1).max(512)).max(20).default([]),
});

export const proofListQuerySchema = z.object({
  agreementId: z.string().uuid().optional(),
  milestoneId: z.string().uuid().optional(),
  status: z.enum(PROOF_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const reviewProofSchema = z.object({
  reviewerExternalId: z.string().trim().min(1).max(160),
  decision: z.enum(REVIEW_DECISIONS),
  note: z.string().trim().max(5000).optional(),
});

export type CreateProofInput = z.infer<typeof createProofSchema>;
export type ProofListQuery = z.infer<typeof proofListQuerySchema>;
export type ReviewProofInput = z.infer<typeof reviewProofSchema>;
