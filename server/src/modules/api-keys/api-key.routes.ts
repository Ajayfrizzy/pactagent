import { Router } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { validateBody, validateQuery } from '../../common/validation/validate';
import { requireAuth } from '../../middleware/auth';
import * as apiKeyController from './api-key.controller';
import { apiKeyListQuerySchema, createApiKeySchema } from './api-key.validation';

const router = Router();

router.post(
  '/',
  requireAuth,
  validateBody(createApiKeySchema),
  asyncHandler(apiKeyController.createApiKey),
);

router.get(
  '/',
  requireAuth,
  validateQuery(apiKeyListQuerySchema),
  asyncHandler(apiKeyController.listApiKeys),
);

router.delete(
  '/:id',
  requireAuth,
  asyncHandler(apiKeyController.revokeApiKey),
);

export default router;
