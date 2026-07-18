import { Router } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { validateQuery } from '../../common/validation/validate';
import { requireApiKey } from '../api-keys/api-key.middleware';
import { requireScope } from '../auth/rbac.middleware';
import * as reviewController from './review.controller';
import { reviewListQuerySchema } from './review.validation';

const router = Router();

router.get(
  '/',
  requireApiKey,
  requireScope('proofs:read'),
  validateQuery(reviewListQuerySchema),
  asyncHandler(reviewController.listReviews),
);

export default router;
