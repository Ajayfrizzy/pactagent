import { Router } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { validateBody, validateQuery } from '../../common/validation/validate';
import { requireApiKey } from '../api-keys/api-key.middleware';
import { requireScope } from '../auth/rbac.middleware';
import * as disputeController from './dispute.controller';
import { createDisputeSchema, disputeListQuerySchema, resolveDisputeSchema } from './dispute.validation';

const router = Router();

router.post(
  '/',
  requireApiKey,
  requireScope('disputes:create'),
  validateBody(createDisputeSchema),
  asyncHandler(disputeController.createDispute),
);

router.get(
  '/',
  requireApiKey,
  requireScope('disputes:read'),
  validateQuery(disputeListQuerySchema),
  asyncHandler(disputeController.listDisputes),
);

router.get(
  '/:id',
  requireApiKey,
  requireScope('disputes:read'),
  asyncHandler(disputeController.getDispute),
);

router.post(
  '/:id/resolve',
  requireApiKey,
  requireScope('disputes:resolve'),
  validateBody(resolveDisputeSchema),
  asyncHandler(disputeController.resolveDispute),
);

export default router;
