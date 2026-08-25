import { Router } from 'express';
import { z } from 'zod';
import { invalidRequest } from '../../common/errors/app-error';
import { asyncHandler } from '../../common/middleware/async-handler';
import { sendSuccess } from '../../common/middleware/response';
import { validateBody } from '../../common/validation/validate';
import { config } from '../../config';
import { requireAuth } from '../../middleware/auth';
import { createRateLimit } from '../../middleware/rateLimit';
import { createChallenge, verifyChallenge } from '../../services/authService';

const router = Router();
const authRateLimit = createRateLimit({
  namespace: 'auth',
  windowMs: config.authRateLimitWindowMs,
  max: config.authRateLimitMax,
});

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

router.post(
  '/challenge',
  authRateLimit,
  validateBody(challengeSchema),
  asyncHandler(async (req, res) => sendSuccess(res, createChallenge(req.body.address))),
);

router.post(
  '/verify',
  authRateLimit,
  validateBody(verifySchema),
  asyncHandler(async (req, res) => {
    try {
      return sendSuccess(res, await verifyChallenge(req.body));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to verify wallet signature.';
      throw invalidRequest(message, 'authentication_verification_failed');
    }
  }),
);

router.get('/me', requireAuth, (req, res) => {
  return sendSuccess(res, req.auth);
});

export default router;
