import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { createRateLimit } from '../middleware/rateLimit';
import { config } from '../config';
import { getFiberDiagnostics } from '../services/fiberDiagnosticsService';

const router = Router();
const fiberDiagnosticsRateLimit = createRateLimit({
  namespace: 'fiber-diagnostics',
  windowMs: config.actionRateLimitWindowMs,
  max: config.actionRateLimitMax,
});

router.use(requireAuth, requireAdmin, fiberDiagnosticsRateLimit);

router.get('/', async (_req, res) => {
  try {
    const diagnostics = await getFiberDiagnostics();
    res.json({ success: true, data: diagnostics });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
