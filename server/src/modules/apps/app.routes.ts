import { Router } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { validateBody, validateQuery } from '../../common/validation/validate';
import { requireAuth } from '../../middleware/auth';
import { requireApiKey } from '../api-keys/api-key.middleware';
import { requireScope } from '../auth/rbac.middleware';
import * as appController from './app.controller';
import { appListQuerySchema, createAppSchema, updateAppSchema } from './app.validation';

const router = Router();

router.get(
  '/current',
  requireApiKey,
  requireScope('apps:read'),
  asyncHandler(appController.getCurrentApp),
);

router.post(
  '/',
  requireAuth,
  validateBody(createAppSchema),
  asyncHandler(appController.createApp),
);

router.get(
  '/',
  requireAuth,
  validateQuery(appListQuerySchema),
  asyncHandler(appController.listApps),
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(appController.getApp),
);

router.patch(
  '/:id',
  requireAuth,
  validateBody(updateAppSchema),
  asyncHandler(appController.updateApp),
);

router.post(
  '/:id/disable',
  requireAuth,
  asyncHandler(appController.disableApp),
);

export default router;
