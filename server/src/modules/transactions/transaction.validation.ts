import { z } from 'zod';

export const transactionListQuerySchema = z.object({
  escrowId: z.string().uuid().optional(),
  agreementId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type TransactionListQuery = z.infer<typeof transactionListQuerySchema>;
