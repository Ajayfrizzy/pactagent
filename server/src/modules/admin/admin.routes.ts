import { Router } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { validateQuery } from '../../common/validation/validate';
import { requireAuth } from '../../middleware/auth';
import { requireInfrastructureAdmin } from './admin.auth';
import * as adminController from './admin.controller';
import { adminListQuerySchema } from './admin.validation';

const router = Router();

router.use(requireAuth, requireInfrastructureAdmin);

router.get('/system-health', asyncHandler(adminController.getSystemHealth));

router.get(
  '/apps',
  validateQuery(adminListQuerySchema),
  asyncHandler(adminController.listApps),
);

router.get(
  '/agreements',
  validateQuery(adminListQuerySchema),
  asyncHandler(adminController.listAgreements),
);

router.get(
  '/escrows',
  validateQuery(adminListQuerySchema),
  asyncHandler(adminController.listEscrows),
);

router.get(
  '/events',
  validateQuery(adminListQuerySchema),
  asyncHandler(adminController.listEvents),
);

router.get(
  '/webhook-deliveries',
  validateQuery(adminListQuerySchema),
  asyncHandler(adminController.listWebhookDeliveries),
);

router.get(
  '/audit-logs',
  validateQuery(adminListQuerySchema),
  asyncHandler(adminController.listAuditLogs),
);

export default router;
