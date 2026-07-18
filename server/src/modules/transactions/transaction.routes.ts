import { Router } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { validateQuery } from '../../common/validation/validate';
import { requireApiKey } from '../api-keys/api-key.middleware';
import { requireAnyScope } from '../auth/rbac.middleware';
import * as transactionController from './transaction.controller';
import { transactionListQuerySchema } from './transaction.validation';

const router = Router();

router.get(
  '/',
  requireApiKey,
  requireAnyScope(['escrows:read', 'admin:read']),
  validateQuery(transactionListQuerySchema),
  asyncHandler(transactionController.listTransactions),
);

export default router;
