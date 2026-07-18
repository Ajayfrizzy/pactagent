import { z } from 'zod';
import { AGREEMENT_STATUSES } from './agreement.state-machine';

const positiveIntegerString = z.string().regex(/^[1-9]\d*$/, 'Amount must be a positive integer string.');

const metadataSchema = z
  .record(z.unknown())
  .default({})
  .refine((value) => Buffer.byteLength(JSON.stringify(value), 'utf8') <= 16 * 1024, {
    message: 'Metadata must be 16KB or smaller.',
  });

export const createAgreementSchema = z.object({
  externalReferenceId: z.string().trim().min(1).max(160).optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).default(''),
  clientExternalId: z.string().trim().min(1).max(160),
  workerExternalId: z.string().trim().min(1).max(160),
  totalAmount: positiveIntegerString,
  currency: z.string().trim().min(2).max(12).default('CKB'),
  releaseMode: z.enum(['manual', 'milestone', 'automatic']).default('milestone'),
  disputeMode: z.enum(['app_managed', 'pactagent_managed']).default('app_managed'),
  sourceType: z.string().trim().min(1).max(80).optional(),
  sourceUrl: z.string().url().optional(),
  metadata: metadataSchema,
});

export const agreementListQuerySchema = z.object({
  status: z.enum(AGREEMENT_STATUSES).optional(),
  externalReferenceId: z.string().trim().min(1).max(160).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type CreateAgreementInput = z.infer<typeof createAgreementSchema>;
export type AgreementListQuery = z.infer<typeof agreementListQuerySchema>;
