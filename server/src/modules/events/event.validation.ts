import { z } from 'zod';

export const eventListQuerySchema = z.object({
  type: z.string().trim().min(1).max(120).optional(),
  agreementId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type EventListQuery = z.infer<typeof eventListQuerySchema>;
