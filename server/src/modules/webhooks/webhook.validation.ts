import { z } from 'zod';
import { INFRASTRUCTURE_EVENT_TYPES } from './webhook.events';

const eventTypeSchema = z.enum(INFRASTRUCTURE_EVENT_TYPES);

export const createWebhookEndpointSchema = z.object({
  url: z.string().trim().url().max(2048),
  description: z.string().trim().max(240).optional(),
  subscribedEvents: z.array(eventTypeSchema).min(1).max(50),
});

export const webhookEndpointListQuerySchema = z.object({
  status: z.enum(['active', 'disabled']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const updateWebhookEndpointSchema = z.object({
  url: z.string().trim().url().max(2048).optional(),
  description: z.string().trim().max(240).nullable().optional(),
  subscribedEvents: z.array(eventTypeSchema).min(1).max(50).optional(),
  status: z.enum(['active', 'disabled']).optional(),
}).refine((input) => Object.keys(input).length > 0, {
  message: 'At least one field must be provided.',
});

export const webhookDeliveryListQuerySchema = z.object({
  endpointId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional(),
  status: z.enum(['pending', 'delivered', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type CreateWebhookEndpointInput = z.infer<typeof createWebhookEndpointSchema>;
export type WebhookEndpointListQuery = z.infer<typeof webhookEndpointListQuerySchema>;
export type UpdateWebhookEndpointInput = z.infer<typeof updateWebhookEndpointSchema>;
export type WebhookDeliveryListQuery = z.infer<typeof webhookDeliveryListQuerySchema>;
