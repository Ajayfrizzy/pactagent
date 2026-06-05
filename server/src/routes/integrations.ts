import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { requireAuth } from '../middleware/auth';
import { createRateLimit } from '../middleware/rateLimit';
import { normalizeWalletAddress } from '../services/authService';
import { fetchCkbPriceQuote } from '../services/marketPriceService';

const router = Router();
const actionRateLimit = createRateLimit({
  namespace: 'integration-action',
  windowMs: config.actionRateLimitWindowMs,
  max: config.actionRateLimitMax,
});

const ckbPriceQuerySchema = z.object({
  fresh: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((value) => value === 'true'),
});

function getAuthAddress(req: Request) {
  if (!req.auth?.address) {
    throw new Error('Authentication required');
  }

  return normalizeWalletAddress(req.auth.address);
}

router.get('/market/ckb-price', requireAuth, actionRateLimit, async (req: Request, res: Response) => {
  try {
    getAuthAddress(req);
    const query = ckbPriceQuerySchema.parse(req.query);
    const quote = await fetchCkbPriceQuote(Boolean(query.fresh));
    res.json({ success: true, data: quote });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch the current CKB price';
    res.status(400).json({ success: false, error: msg });
  }
});

export default router;
