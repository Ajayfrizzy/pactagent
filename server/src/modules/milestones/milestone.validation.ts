import { z } from 'zod';

const positiveIntegerString = z.string().regex(/^[1-9]\d*$/, 'Amount must be a positive integer string.');

export const createMilestoneSchema = z.object({
  externalReferenceId: z.string().trim().min(1).max(160).optional(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(3000).default(''),
  amount: positiveIntegerString,
  currency: z.string().trim().min(2).max(12).optional(),
  order: z.number().int().min(1).optional(),
  dueDate: z.string().datetime().optional(),
});

export const milestoneListQuerySchema = z.object({
  agreementId: z.string().uuid().optional(),
  status: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>;
export type MilestoneListQuery = z.infer<typeof milestoneListQuerySchema>;
