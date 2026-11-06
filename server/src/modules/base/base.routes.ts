import { Router } from 'express';
import { requireApiKey } from '../api-keys/api-key.middleware';
import { requireScope } from '../auth/rbac.middleware';
import { invalidRequest } from '../../common/errors/app-error';
import { BASE_EXECUTION_CAPABILITY } from './adapter';
const router = Router();
router.use(requireApiKey);
router.get('/capabilities', requireScope('escrows:v2:read'), (_req, res) => res.json({ data: BASE_EXECUTION_CAPABILITY }));
// Explicit unavailable response, not a financial API implementation. No parsing,
// persistence, signing payload or provider/broadcast access exists in this route.
router.post('/proposals', requireScope('escrows:v2:propose'), () => {
  throw invalidRequest(BASE_EXECUTION_CAPABILITY.reason, 'unsupported_capability');
});
export default router;
