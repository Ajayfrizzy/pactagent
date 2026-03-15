import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { getLogsForParticipant } from '../services/logService';

const router = Router();

router.use(requireAuth);

router.get('/', async (req: Request, res: Response) => {
  try {
    const agreementId = req.query.agreementId as string | undefined;
    const limit = parseInt((req.query.limit as string) || '100', 10);
    const address = req.auth?.address;

    if (!address) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const logs = await getLogsForParticipant(address, agreementId, limit);
    res.json({ success: true, data: logs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
