import { z } from 'zod';
import { API_KEY_SCOPES } from '../auth/scopes';

export const createApiKeySchema = z.object({
  appId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1),
});

export const apiKeyListQuerySchema = z.object({
  appId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type ApiKeyListQuery = z.infer<typeof apiKeyListQuerySchema>;
