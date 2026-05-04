import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { createWebhookEndpoint, getWebhookEndpointDeliveries, listWebhookEndpoints } from '../services/webhookService';

const router = Router();

const createWebhookSchema = z.object({
  label: z.string().max(80).optional(),
  targetUrl: z.string().url(),
  eventTypes: z.array(z.enum([
    'agreement.created',
    'agreement.funded',
    'agreement.completed',
    'agreement.refunded',
    'agreement.expired',
    'agreement.proof_submitted',
    'review.action_taken',
    'dispute.opened',
    'dispute.updated',
    'settlement.pending',
    'settlement.confirmed',
    'settlement.failed',
  ])).min(1),
});

router.use(requireAuth);

router.get('/', async (req: Request, res: Response) => {
  try {
    const address = req.auth?.address;
    if (!address) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const endpoints = await listWebhookEndpoints(address);
    res.json({ success: true, data: endpoints });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load webhooks';
    res.status(500).json({ success: false, error: message });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const address = req.auth?.address;
    if (!address) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const data = createWebhookSchema.parse(req.body);
    const endpoint = await createWebhookEndpoint({
      ownerAddress: address,
      ...data,
    });
    res.json({ success: true, data: endpoint });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create webhook';
    res.status(400).json({ success: false, error: message });
  }
});

router.get('/:id/deliveries', async (req: Request, res: Response) => {
  try {
    const address = req.auth?.address;
    if (!address) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const limit = parseInt((req.query.limit as string) || '50', 10);
    const deliveries = await getWebhookEndpointDeliveries(address, req.params.id, limit);
    res.json({ success: true, data: deliveries });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load webhook deliveries';
    res.status(400).json({ success: false, error: message });
  }
});

export default router;
