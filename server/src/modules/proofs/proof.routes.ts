import { Router } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { validateBody, validateQuery } from '../../common/validation/validate';
import { requireApiKey } from '../api-keys/api-key.middleware';
import { requireScope } from '../auth/rbac.middleware';
import * as proofController from './proof.controller';
import { createProofSchema, proofListQuerySchema, reviewProofSchema } from './proof.validation';

const router = Router();

router.post(
  '/',
  requireApiKey,
  requireScope('proofs:create'),
  validateBody(createProofSchema),
  asyncHandler(proofController.createProof),
);

router.get(
  '/',
  requireApiKey,
  requireScope('proofs:read'),
  validateQuery(proofListQuerySchema),
  asyncHandler(proofController.listProofs),
);

router.get(
  '/:id',
  requireApiKey,
  requireScope('proofs:read'),
  asyncHandler(proofController.getProof),
);

router.post(
  '/:id/review',
  requireApiKey,
  requireScope('proofs:review'),
  validateBody(reviewProofSchema),
  asyncHandler(proofController.reviewProof),
);

export default router;
