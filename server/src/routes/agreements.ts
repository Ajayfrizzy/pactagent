import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { prisma } from '../db';
import * as agreementService from '../services/agreementService';
import { generateRecommendation, saveRecommendation } from '../services/disputeService';
import { getLogs } from '../services/logService';

const router = Router();

const createAgreementSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  clientAddress: z.string().min(1),
  workerAddress: z.string().min(1),
  deadlineAt: z.string().datetime(),
  disputeWindowSecs: z.number().int().min(3600).default(86400),
  proofType: z.enum(['URL', 'TEXT', 'FILE_HASH']).default('URL'),
  reviewerMode: z.enum(['AUTO', 'HYBRID', 'MANUAL']).default('AUTO'),
  releaseMode: z.enum(['FULL', 'PARTIAL']).default('FULL'),
  payoutNetwork: z.enum(['CKB', 'FIBER']).default('CKB'),
  milestones: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        description: z.string().min(1).max(1000),
        amount: z.string().min(1),
      })
    )
    .min(1),
});

const fundSchema = z.object({
  txHash: z.string().min(1),
});

const submitProofSchema = z.object({
  milestoneId: z.string().min(1),
  proofType: z.enum(['URL', 'TEXT', 'FILE_HASH']),
  content: z.string().min(1),
  contentHash: z.string().optional(),
});

const openDisputeSchema = z.object({
  milestoneId: z.string().min(1),
  openedBy: z.string().min(1),
  reason: z.string().min(1),
  evidenceNotes: z.string().optional(),
});

const addDisputeEvidenceSchema = z.object({
  disputeId: z.string().min(1),
  submittedBy: z.string().min(1),
  content: z.string().min(1),
});

const reviewActionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'ESCALATE']),
  reviewerAddress: z.string().min(1),
});

function getAuthAddress(req: Request) {
  if (!req.auth?.address) {
    throw new Error('Authentication required');
  }

  return req.auth.address;
}

async function getAgreementForParticipant(req: Request) {
  const agreement = await agreementService.getAgreementById(req.params.id);
  if (!agreement) {
    return { error: 'Agreement not found' as const };
  }

  const authAddress = getAuthAddress(req);
  if (agreement.clientAddress !== authAddress && agreement.workerAddress !== authAddress) {
    return { error: 'You are not a participant in this agreement' as const };
  }

  return { agreement };
}

router.use(requireAuth);

router.post('/', async (req: Request, res: Response) => {
  try {
    const authAddress = getAuthAddress(req);
    const data = createAgreementSchema.parse(req.body);

    if (data.clientAddress !== authAddress) {
      return res.status(403).json({ success: false, error: 'Authenticated wallet must match the client address' });
    }

    const agreement = await agreementService.createAgreement(data);
    res.json({ success: true, data: agreement });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validation error';
    res.status(400).json({ success: false, error: msg });
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const authAddress = getAuthAddress(req);
    const requestedAddress = req.query.address as string | undefined;

    if (requestedAddress && requestedAddress !== authAddress) {
      return res.status(403).json({ success: false, error: 'You can only view agreements for your own wallet' });
    }

    const agreements = await agreementService.getAgreements(authAddress);
    res.json({ success: true, data: agreements });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: msg });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await getAgreementForParticipant(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    res.json({ success: true, data: result.agreement });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: msg });
  }
});

router.post('/:id/fund', async (req: Request, res: Response) => {
  try {
    const result = await getAgreementForParticipant(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const authAddress = getAuthAddress(req);
    if (result.agreement.clientAddress !== authAddress) {
      return res.status(403).json({ success: false, error: 'Only the client can fund this agreement' });
    }

    const { txHash } = fundSchema.parse(req.body);
    const agreement = await agreementService.fundAgreement(req.params.id, txHash);
    res.json({ success: true, data: agreement });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validation error';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:id/submit-proof', async (req: Request, res: Response) => {
  try {
    const result = await getAgreementForParticipant(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const authAddress = getAuthAddress(req);
    if (result.agreement.workerAddress !== authAddress) {
      return res.status(403).json({ success: false, error: 'Only the worker can submit milestone proof' });
    }

    const data = submitProofSchema.parse(req.body);
    const response = await agreementService.submitProof(
      req.params.id,
      data.milestoneId,
      data.proofType,
      data.content,
      data.contentHash
    );
    res.json({ success: true, data: response });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validation error';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:id/open-dispute', async (req: Request, res: Response) => {
  try {
    const result = await getAgreementForParticipant(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const authAddress = getAuthAddress(req);
    const data = openDisputeSchema.parse(req.body);
    if (data.openedBy !== authAddress) {
      return res.status(403).json({ success: false, error: 'Authenticated wallet must match the dispute opener' });
    }

    const response = await agreementService.openDispute(
      req.params.id,
      data.milestoneId,
      data.openedBy,
      data.reason,
      data.evidenceNotes
    );
    res.json({ success: true, data: response });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validation error';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:id/dispute/evidence', async (req: Request, res: Response) => {
  try {
    const result = await getAgreementForParticipant(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const authAddress = getAuthAddress(req);
    const data = addDisputeEvidenceSchema.parse(req.body);
    if (data.submittedBy !== authAddress) {
      return res.status(403).json({ success: false, error: 'Authenticated wallet must match the evidence submitter' });
    }

    const response = await agreementService.addDisputeEvidence(
      req.params.id,
      data.disputeId,
      data.submittedBy,
      data.content
    );
    res.json({ success: true, data: response });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validation error';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:id/review-action', async (req: Request, res: Response) => {
  try {
    const result = await getAgreementForParticipant(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const authAddress = getAuthAddress(req);
    if (result.agreement.clientAddress !== authAddress) {
      return res.status(403).json({ success: false, error: 'Only the client can review milestones' });
    }

    const { action, reviewerAddress } = reviewActionSchema.parse(req.body);
    if (reviewerAddress !== authAddress) {
      return res.status(403).json({ success: false, error: 'Authenticated wallet must match the reviewer' });
    }

    if (action === 'APPROVE') {
      const updated = await agreementService.approveCurrentMilestone(req.params.id);
      return res.json({ success: true, data: updated });
    }

    if (action === 'REJECT') {
      const updated = await agreementService.refundCurrentMilestone(req.params.id);
      return res.json({ success: true, data: updated });
    }

    res.json({ success: true, data: { message: 'Escalated for manual review' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validation error';
    res.status(400).json({ success: false, error: msg });
  }
});

router.get('/:id/logs', async (req: Request, res: Response) => {
  try {
    const result = await getAgreementForParticipant(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const logs = await getLogs(req.params.id);
    res.json({ success: true, data: logs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: msg });
  }
});

router.get('/:id/dispute', async (req: Request, res: Response) => {
  try {
    const result = await getAgreementForParticipant(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const disputes = await prisma.dispute.findMany({
      where: { agreementId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: disputes });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: msg });
  }
});

router.post('/:id/dispute/recommendation', async (req: Request, res: Response) => {
  try {
    const result = await getAgreementForParticipant(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const agreement = result.agreement;
    const dispute = agreement.disputes.find((item) => !item.resolvedAt);
    if (!dispute) {
      return res.status(404).json({ success: false, error: 'No open dispute found' });
    }

    const milestone = agreement.milestones?.find((item) => item.id === dispute.milestoneId);
    const proof = milestone && 'proofs' in milestone
      ? milestone.proofs[0]
      : agreement.proofs.find((item) => item.milestoneId === dispute.milestoneId);

    const recommendation = await generateRecommendation(req.params.id, {
      agreementTitle: agreement.title,
      agreementAmount: milestone?.amount || agreement.amount,
      proofContent: proof?.content || null,
      proofType: proof?.proofType || null,
      disputeReason: dispute.reason,
      evidenceNotes: dispute.evidenceNotes,
      evidenceTimeline: (dispute.evidenceEntries || []).map((entry) => ({
        submittedBy: entry.submittedBy,
        content: entry.content,
        createdAt: entry.createdAt.toISOString(),
      })),
      deadlineAt: agreement.deadlineAt.toISOString(),
      status: agreement.status,
      milestoneTitle: milestone?.title || null,
    });

    await saveRecommendation(dispute.id, recommendation);

    res.json({ success: true, data: recommendation });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
