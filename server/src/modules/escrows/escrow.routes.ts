import { Router } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { validateBody, validateQuery } from '../../common/validation/validate';
import { requireApiKey } from '../api-keys/api-key.middleware';
import { requireScope } from '../auth/rbac.middleware';
import * as escrowController from './escrow.controller';
import {
  createEscrowSchema,
  emptyActionSchema,
  escrowListQuerySchema,
  markFundedSchema,
} from './escrow.validation';

const router = Router();

router.post(
  '/',
  requireApiKey,
  requireScope('escrows:create'),
  validateBody(createEscrowSchema),
  asyncHandler(escrowController.createEscrow),
);

router.get(
  '/',
  requireApiKey,
  requireScope('escrows:read'),
  validateQuery(escrowListQuerySchema),
  asyncHandler(escrowController.listEscrows),
);

router.get(
  '/:id',
  requireApiKey,
  requireScope('escrows:read'),
  asyncHandler(escrowController.getEscrow),
);

router.post(
  '/:id/mark-funded',
  requireApiKey,
  requireScope('escrows:fund'),
  validateBody(markFundedSchema),
  asyncHandler(escrowController.markEscrowFunded),
);

router.post(
  '/:id/release',
  requireApiKey,
  requireScope('escrows:release'),
  validateBody(emptyActionSchema),
  asyncHandler(escrowController.releaseEscrow),
);

router.post(
  '/:id/refund',
  requireApiKey,
  requireScope('escrows:refund'),
  validateBody(emptyActionSchema),
  asyncHandler(escrowController.refundEscrow),
);

export default router;
