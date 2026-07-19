import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { createInviteLink, getInviteLinkPreview, acceptInviteLink, listInvitesByCreator } from '../services/inviteService';
import { normalizeWalletAddress } from '../services/authService';
import { createAuditLog } from '../services/auditLogService';

const router = Router();

const agreementTemplateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  deadlineAt: z.string().datetime(),
  disputeWindowSecs: z.number().int().min(3600),
  proofType: z.enum(['URL', 'TEXT', 'FILE_HASH']),
  reviewerMode: z.enum(['AUTO', 'HYBRID', 'MANUAL']),
  releaseMode: z.enum(['FULL', 'PARTIAL']),
  payoutNetwork: z.literal('CKB'),
  escrowModel: z.enum(['TREASURY_BRIDGE', 'ONCHAIN_LOCK']).optional(),
  milestones: z.array(z.object({
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(1000),
    amount: z.string().min(1),
  })).min(1),
});

const createInviteSchema = z.object({
  createdByAddress: z.string().min(1),
  creatorRole: z.enum(['CLIENT', 'WORKER']),
  targetRole: z.enum(['CLIENT', 'WORKER']),
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  expiresAt: z.string().datetime().optional(),
  maxUses: z.number().int().min(1).max(20).optional(),
  agreementTemplate: agreementTemplateSchema,
});

router.get('/:token', async (req: Request, res: Response) => {
  try {
    const invite = await getInviteLinkPreview(req.params.token);
    if (!invite) {
      return res.status(404).json({ success: false, error: 'Invite link not found' });
    }

    res.json({ success: true, data: invite });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load invite';
    res.status(500).json({ success: false, error: message });
  }
});

router.use(requireAuth);

router.get('/', async (req: Request, res: Response) => {
  try {
    const address = req.auth?.address;
    if (!address) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const result = await listInvitesByCreator(address, limit, req.query.cursor as string | undefined);
    res.json({ success: true, data: result.data, pagination: result.pagination });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load invites';
    res.status(500).json({ success: false, error: message });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const address = req.auth?.address;
    if (!address) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const data = createInviteSchema.parse(req.body);
    if (normalizeWalletAddress(data.createdByAddress) !== normalizeWalletAddress(address)) {
      return res.status(403).json({ success: false, error: 'Authenticated wallet must match the invite creator.' });
    }

    const invite = await createInviteLink(data);
    await createAuditLog({
      actorAddress: address,
      action: 'INVITE_CREATED',
      resourceType: 'INVITE',
      resourceId: invite.id,
      metadata: {
        targetRole: invite.targetRole,
        maxUses: invite.maxUses,
      },
    });
    res.json({ success: true, data: invite });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create invite';
    res.status(400).json({ success: false, error: message });
  }
});

router.post('/:token/accept', async (req: Request, res: Response) => {
  try {
    const address = req.auth?.address;
    if (!address) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const accepted = await acceptInviteLink(req.params.token, address);
    await createAuditLog({
      agreementId: accepted.agreement.id,
      actorAddress: address,
      action: 'INVITE_ACCEPTED',
      resourceType: 'INVITE',
      resourceId: req.params.token,
    });
    res.json({ success: true, data: accepted });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to accept invite';
    res.status(400).json({ success: false, error: message });
  }
});

export default router;
