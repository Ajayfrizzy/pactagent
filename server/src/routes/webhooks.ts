import { Router } from 'express';

const router = Router();

router.use((_req, res) => {
  res.status(410).json({
    success: false,
    error: 'Legacy wallet webhooks are disabled. Use /v1/webhook-endpoints with app-scoped API keys.',
  });
});

export default router;
