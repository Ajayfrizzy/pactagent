import { Router } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { validateQuery } from '../../common/validation/validate';
import { requireAuth } from '../../middleware/auth';
import { createRateLimit } from '../../middleware/rateLimit';
import { config } from '../../config';
import { requireInfrastructureAdmin } from './admin.auth';
import * as adminController from './admin.controller';
import { adminListQuerySchema } from './admin.validation';

const router = Router();
const replayRateLimit = createRateLimit({
  namespace: 'admin-job-replay',
  windowMs: config.actionRateLimitWindowMs,
  max: config.actionRateLimitMax,
});

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

router.get(
  '/jobs',
  validateQuery(adminListQuerySchema),
  asyncHandler(adminController.listJobs),
);

router.post('/jobs/:id/replay', replayRateLimit, asyncHandler(adminController.replayJob));

export default router;
