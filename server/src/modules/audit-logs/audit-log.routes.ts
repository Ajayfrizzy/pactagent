import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../common/middleware/async-handler';
import { sendList } from '../../common/middleware/response';
import { validateQuery } from '../../common/validation/validate';
import { requireApiKey } from '../api-keys/api-key.middleware';
import { requireScope } from '../auth/rbac.middleware';
import { listAppAuditLogs } from './audit-log.service';

const router = Router();

const auditLogListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

router.get(
  '/',
  requireApiKey,
  requireScope('apps:read'),
  validateQuery(auditLogListQuerySchema),
  asyncHandler(async (req, res) => {
    const result = await listAppAuditLogs(req.tenant!.appId, req.query as any);
    return sendList(res, result.data, result.pagination);
  }),
);

export default router;
