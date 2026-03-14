import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { createChallenge, verifyChallenge } from '../services/authService';

const router = Router();

const challengeSchema = z.object({
  address: z.string().min(1),
});

const verifySchema = z.object({
  address: z.string().min(1),
  message: z.string().min(1),
  signature: z.object({
    signature: z.string().min(1),
    identity: z.string().min(1),
    signType: z.string().min(1),
  }),
});

router.post('/challenge', (req, res) => {
  try {
    const { address } = challengeSchema.parse(req.body);
    const result = createChallenge(address);
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create auth challenge';
    res.status(400).json({ success: false, error: message });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const data = verifySchema.parse(req.body);
    const result = await verifyChallenge(data);
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to verify wallet signature';
    res.status(400).json({ success: false, error: message });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ success: true, data: req.auth });
});

export default router;
