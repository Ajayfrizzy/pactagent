import { Router, Request, Response } from 'express';
import { getLogs } from '../services/logService';

const router = Router();

// ─── GET /api/logs ───
router.get('/', async (req: Request, res: Response) => {
  try {
    const agreementId = req.query.agreementId as string | undefined;
    const limit = parseInt(req.query.limit as string || '100', 10);
    const logs = await getLogs(agreementId, limit);
    res.json({ success: true, data: logs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
