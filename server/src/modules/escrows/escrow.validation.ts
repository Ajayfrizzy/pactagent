import { z } from 'zod';

const positiveIntegerString = z.string().regex(/^[1-9]\d*$/, 'Amount must be a positive integer string.');

export const createEscrowSchema = z.object({
  agreementId: z.string().uuid(),
  milestoneId: z.string().uuid().optional(),
  amount: positiveIntegerString,
  currency: z.string().trim().min(2).max(12).default('CKB'),
  rail: z.enum(['mock', 'manual', 'ckb', 'future_fiat', 'future_usdt']).default('mock'),
  network: z.enum(['sandbox', 'testnet', 'mainnet']).default('sandbox'),
});

export const escrowListQuerySchema = z.object({
  agreementId: z.string().uuid().optional(),
  status: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const markFundedSchema = z.object({
  txHash: z.string().trim().min(1).max(200).optional(),
});

export const emptyActionSchema = z.object({}).strict();

export type CreateEscrowInput = z.infer<typeof createEscrowSchema>;
export type EscrowListQuery = z.infer<typeof escrowListQuerySchema>;
export type MarkFundedInput = z.infer<typeof markFundedSchema>;
