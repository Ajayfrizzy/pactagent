import { Router } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { validateQuery } from '../../common/validation/validate';
import { requireApiKey } from '../api-keys/api-key.middleware';
import { requireScope } from '../auth/rbac.middleware';
import * as eventController from './event.controller';
import { eventListQuerySchema } from './event.validation';

const router = Router();

router.get(
  '/',
  requireApiKey,
  requireScope('events:read'),
  validateQuery(eventListQuerySchema),
  asyncHandler(eventController.listEvents),
);

router.get(
  '/:id',
  requireApiKey,
  requireScope('events:read'),
  asyncHandler(eventController.getEvent),
);

export default router;
