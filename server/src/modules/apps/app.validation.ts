import { z } from 'zod';

export const appEnvironmentSchema = z.enum(['sandbox', 'production']);
export const appStatusSchema = z.enum(['active', 'disabled', 'suspended']);

export const createAppSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase letters, numbers, and hyphens.'),
  environment: appEnvironmentSchema.default('sandbox'),
  defaultCurrency: z.string().trim().min(2).max(12).default('CKB'),
  defaultNetwork: z.string().trim().min(2).max(32).default('sandbox'),
});

export const updateAppSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: appStatusSchema.optional(),
  defaultCurrency: z.string().trim().min(2).max(12).optional(),
  defaultNetwork: z.string().trim().min(2).max(32).optional(),
}).refine((data) => Object.keys(data).length > 0, 'At least one field is required.');

export const appListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type CreateAppInput = z.infer<typeof createAppSchema>;
export type UpdateAppInput = z.infer<typeof updateAppSchema>;
export type AppListQuery = z.infer<typeof appListQuerySchema>;
