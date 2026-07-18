import { z } from 'zod';
import { DISPUTE_RESOLUTION_TYPES, DISPUTE_STATUSES } from './dispute.state-machine';

const positiveIntegerString = z.string().regex(/^[1-9]\d*$/, 'Amount must be a positive integer string.');

export const createDisputeSchema = z.object({
  agreementId: z.string().uuid(),
  milestoneId: z.string().uuid(),
  openedByExternalId: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(5000),
  evidenceLinks: z.array(z.string().url().max(2048)).max(20).default([]),
});

export const disputeListQuerySchema = z.object({
  agreementId: z.string().uuid().optional(),
  milestoneId: z.string().uuid().optional(),
  status: z.enum(DISPUTE_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const resolveDisputeSchema = z.object({
  resolutionType: z.enum(DISPUTE_RESOLUTION_TYPES),
  resolutionNote: z.string().trim().max(5000).optional(),
  workerAmount: positiveIntegerString.optional(),
  clientAmount: positiveIntegerString.optional(),
}).superRefine((value, ctx) => {
  if (value.resolutionType !== 'split') {
    return;
  }

  if (!value.workerAmount || !value.clientAmount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Split resolution requires workerAmount and clientAmount.',
      path: ['workerAmount'],
    });
  }
});

export type CreateDisputeInput = z.infer<typeof createDisputeSchema>;
export type DisputeListQuery = z.infer<typeof disputeListQuerySchema>;
export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;
