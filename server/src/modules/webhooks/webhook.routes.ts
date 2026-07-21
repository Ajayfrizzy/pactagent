import { Router } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { validateBody, validateQuery } from '../../common/validation/validate';
import { requireApiKey } from '../api-keys/api-key.middleware';
import { requireScope } from '../auth/rbac.middleware';
import { v1HighRiskActionRateLimit } from '../../common/rate-limit/infrastructure-rate-limit';
import * as webhookController from './webhook.controller';
import {
  createWebhookEndpointSchema,
  updateWebhookEndpointSchema,
  webhookDeliveryListQuerySchema,
  webhookEndpointListQuerySchema,
} from './webhook.validation';

const endpointRouter = Router();
const deliveryRouter = Router();

endpointRouter.post(
  '/',
  requireApiKey,
  requireScope('webhooks:manage'),
  v1HighRiskActionRateLimit,
  validateBody(createWebhookEndpointSchema),
  asyncHandler(webhookController.createWebhookEndpoint),
);

endpointRouter.get(
  '/',
  requireApiKey,
  requireScope('webhooks:read'),
  validateQuery(webhookEndpointListQuerySchema),
  asyncHandler(webhookController.listWebhookEndpoints),
);

endpointRouter.get(
  '/:id',
  requireApiKey,
  requireScope('webhooks:read'),
  asyncHandler(webhookController.getWebhookEndpoint),
);

endpointRouter.patch(
  '/:id',
  requireApiKey,
  requireScope('webhooks:manage'),
  validateBody(updateWebhookEndpointSchema),
  asyncHandler(webhookController.updateWebhookEndpoint),
);

endpointRouter.delete(
  '/:id',
  requireApiKey,
  requireScope('webhooks:manage'),
  asyncHandler(webhookController.deleteWebhookEndpoint),
);

deliveryRouter.get(
  '/',
  requireApiKey,
  requireScope('webhooks:read'),
  validateQuery(webhookDeliveryListQuerySchema),
  asyncHandler(webhookController.listWebhookDeliveries),
);

deliveryRouter.get(
  '/:id',
  requireApiKey,
  requireScope('webhooks:read'),
  asyncHandler(webhookController.getWebhookDelivery),
);

deliveryRouter.post(
  '/:id/retry',
  requireApiKey,
  requireScope('webhooks:manage'),
  v1HighRiskActionRateLimit,
  asyncHandler(webhookController.retryWebhookDelivery),
);

export { deliveryRouter as webhookDeliveryRoutes };
export default endpointRouter;
