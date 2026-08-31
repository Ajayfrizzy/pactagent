import { z } from 'zod';

const positiveIntegerString = z.string().regex(/^[1-9]\d*$/, 'Amount must be a positive integer string.');
const ckbScriptSchema = z.object({
  codeHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  hashType: z.enum(['data', 'type', 'data1', 'data2']),
  args: z.string().regex(/^0x[0-9a-fA-F]*$/),
});

export const createEscrowSchema = z.object({
  agreementId: z.string().uuid(),
  milestoneId: z.string().uuid().optional(),
  amount: positiveIntegerString,
  currency: z.string().trim().min(2).max(12).default('CKB'),
  rail: z.enum(['mock', 'manual', 'ckb']).default('mock'),
  network: z.enum(['sandbox', 'testnet', 'mainnet']).default('sandbox'),
  clientLockScript: ckbScriptSchema.optional(),
  workerLockScript: ckbScriptSchema.optional(),
  refundTimeoutSince: z.string().regex(/^(0|[1-9]\d*)$/).optional(),
}).superRefine((value, ctx) => {
  const validRailNetwork = value.rail === 'ckb'
    ? ['testnet', 'mainnet'].includes(value.network)
    : value.network === 'sandbox';
  if (!validRailNetwork) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['network'], message: 'Rail and network combination is invalid.' });
  }
  if (value.rail === 'ckb') {
    if (value.currency !== 'CKB') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['currency'], message: 'CKB rail requires CKB currency.' });
    }
    for (const field of ['milestoneId', 'clientLockScript', 'workerLockScript', 'refundTimeoutSince'] as const) {
      if (value[field] === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is required for CKB escrow.` });
      }
    }
  }
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
