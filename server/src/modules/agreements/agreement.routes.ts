import { Router } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { validateBody, validateQuery } from '../../common/validation/validate';
import { requireApiKey } from '../api-keys/api-key.middleware';
import { requireScope } from '../auth/rbac.middleware';
import * as agreementController from './agreement.controller';
import { agreementListQuerySchema, createAgreementSchema } from './agreement.validation';
import * as milestoneController from '../milestones/milestone.controller';
import { createMilestoneSchema, milestoneListQuerySchema } from '../milestones/milestone.validation';

const router = Router();

router.post(
  '/',
  requireApiKey,
  requireScope('agreements:create'),
  validateBody(createAgreementSchema),
  asyncHandler(agreementController.createAgreement),
);

router.get(
  '/',
  requireApiKey,
  requireScope('agreements:read'),
  validateQuery(agreementListQuerySchema),
  asyncHandler(agreementController.listAgreements),
);

router.post(
  '/:id/milestones',
  requireApiKey,
  requireScope('milestones:create'),
  validateBody(createMilestoneSchema),
  asyncHandler(milestoneController.createMilestone),
);

router.get(
  '/:id/milestones',
  requireApiKey,
  requireScope('milestones:read'),
  validateQuery(milestoneListQuerySchema),
  asyncHandler(milestoneController.listMilestones),
);

router.get(
  '/:id',
  requireApiKey,
  requireScope('agreements:read'),
  asyncHandler(agreementController.getAgreement),
);

router.post(
  '/:id/accept',
  requireApiKey,
  requireScope('agreements:update'),
  asyncHandler(agreementController.acceptAgreement),
);

router.post(
  '/:id/funding-required',
  requireApiKey,
  requireScope('agreements:update'),
  asyncHandler(agreementController.moveAgreementToFundingRequired),
);

router.post(
  '/:id/cancel',
  requireApiKey,
  requireScope('agreements:cancel'),
  asyncHandler(agreementController.cancelAgreement),
);

export default router;
