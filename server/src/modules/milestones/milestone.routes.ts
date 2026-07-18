import { Router } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { validateQuery } from '../../common/validation/validate';
import { requireApiKey } from '../api-keys/api-key.middleware';
import { requireScope } from '../auth/rbac.middleware';
import * as milestoneController from './milestone.controller';
import { milestoneListQuerySchema } from './milestone.validation';

const router = Router();

router.get(
  '/',
  requireApiKey,
  requireScope('milestones:read'),
  validateQuery(milestoneListQuerySchema),
  asyncHandler(milestoneController.listAppMilestones),
);

router.get(
  '/:id',
  requireApiKey,
  requireScope('milestones:read'),
  asyncHandler(milestoneController.getMilestone),
);

export default router;
