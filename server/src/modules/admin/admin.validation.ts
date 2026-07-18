import { z } from 'zod';

export const adminListQuerySchema = z.object({
  appId: z.string().uuid().or(z.string().min(1)).optional(),
  status: z.string().trim().min(1).max(80).optional(),
  type: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type AdminListQuery = z.infer<typeof adminListQuerySchema>;
