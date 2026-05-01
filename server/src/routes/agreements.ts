import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { requireAuth } from '../middleware/auth';
import { createRateLimit } from '../middleware/rateLimit';
import { prisma } from '../db';
import * as agreementService from '../services/agreementService';
import { createAuditLog, getAuditLogsForAgreement } from '../services/auditLogService';
import {
  evaluateRecommendationReadiness,
  generateRecommendation,
  saveRecommendation,
} from '../services/disputeService';
import { isValidFiberPublicKey } from '../services/fiberService';
import { getLogs } from '../services/logService';
import { runAgentCycle } from '../worker/agentLoop';

const router = Router();
const actionRateLimit = createRateLimit({
  namespace: 'agreement-action',
  windowMs: config.actionRateLimitWindowMs,
  max: config.actionRateLimitMax,
});

type AgreementParticipantRecord = NonNullable<
  Awaited<ReturnType<typeof agreementService.getAgreementParticipantById>>
>;
type AgreementDetailRecord = NonNullable<
  Awaited<ReturnType<typeof agreementService.getAgreementById>>
>;
type AgreementAccessError = 'Agreement not found' | 'You are not a participant in this agreement';
type AgreementAccessResult<T> = { agreement: T } | { error: AgreementAccessError };

const createAgreementSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  clientAddress: z.string().min(1),
  workerAddress: z.string().min(1),
  workerFiberPubkey: z.string().min(1).optional(),
  deadlineAt: z.string().datetime(),
  disputeWindowSecs: z.number().int().min(3600).default(86400),
  proofType: z.enum(['URL', 'TEXT', 'FILE_HASH']).default('URL'),
  reviewerMode: z.enum(['AUTO', 'HYBRID', 'MANUAL']).default('AUTO'),
  releaseMode: z.enum(['FULL', 'PARTIAL']).default('FULL'),
  payoutNetwork: z.enum(['CKB', 'FIBER']).default('CKB'),
  escrowModel: z.enum(['TREASURY_BRIDGE', 'ONCHAIN_LOCK']).default('TREASURY_BRIDGE'),
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
  milestoneOutputs: z.array(
    z.object({
      milestoneId: z.string().min(1),
      outputIndex: z.number().int().min(0),
      escrowCellData: z.string().min(1),
      refundTimeoutBlock: z.string().min(1),
    })
  ).optional(),
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

const mutualRefundConsentSchema = z.object({
  actorAddress: z.string().min(1),
});

const reviewActionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'ESCALATE']),
  reviewerAddress: z.string().min(1),
});

const onchainResolutionSchema = z.object({
  milestoneId: z.string().min(1),
  txHash: z.string().min(1),
  direction: z.enum(['PAYOUT', 'REFUND']),
});

function getAuthAddress(req: Request) {
  if (!req.auth?.address) {
    throw new Error('Authentication required');
  }

  return req.auth.address;
}

function triggerAgentCycleSoon(reason: string) {
  void runAgentCycle().catch((err) => {
    console.error(`[AGENT] Immediate cycle failed after ${reason}:`, err);
  });
}

async function getAgreementParticipantRecord(req: Request): Promise<AgreementAccessResult<AgreementParticipantRecord>> {
  const agreement = await agreementService.getAgreementParticipantById(req.params.id);
  if (!agreement) {
    return { error: 'Agreement not found' as const };
  }

  const authAddress = getAuthAddress(req);
  if (
    agreement.clientAddress !== authAddress &&
    agreement.workerAddress !== authAddress &&
    agreement.arbitratorAddress !== authAddress
  ) {
    return { error: 'You are not a participant in this agreement' as const };
  }

  return { agreement };
}

async function getAgreementDetailForParticipant(req: Request): Promise<AgreementAccessResult<AgreementDetailRecord>> {
  const result = await getAgreementParticipantRecord(req);
  if ('error' in result) {
    return result;
  }

  const agreement = await agreementService.getAgreementById(req.params.id);
  if (!agreement) {
    return { error: 'Agreement not found' as const };
  }

  return { agreement };
}

router.use(requireAuth);

router.post('/', actionRateLimit, async (req: Request, res: Response) => {
  try {
    const authAddress = getAuthAddress(req);
    const data = createAgreementSchema.parse(req.body);

    if (data.clientAddress !== authAddress) {
      return res.status(403).json({ success: false, error: 'Authenticated wallet must match the client address' });
    }

    if (data.escrowModel === 'ONCHAIN_LOCK') {
      return res.status(400).json({
        success: false,
        error: 'On-chain lock escrow is temporarily unavailable while mutual settlement replaces the arbitrator flow.',
      });
    }

    if (data.payoutNetwork === 'FIBER' && !data.workerFiberPubkey) {
      return res.status(400).json({
        success: false,
        error: 'Fiber payouts require the worker Fiber public key.',
      });
    }

    if (data.workerFiberPubkey && !isValidFiberPublicKey(data.workerFiberPubkey)) {
      return res.status(400).json({
        success: false,
        error: 'The worker Fiber public key format is invalid.',
      });
    }

    const agreement = await agreementService.createAgreement(data);
    await createAuditLog({
      agreementId: agreement.id,
      actorAddress: authAddress,
      action: 'AGREEMENT_CREATED',
      resourceType: 'AGREEMENT',
      resourceId: agreement.id,
      metadata: {
        payoutNetwork: agreement.payoutNetwork,
        reviewerMode: agreement.reviewerMode,
        escrowModel: agreement.escrowModel,
      },
    });
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
    const result = await getAgreementDetailForParticipant(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    res.json({ success: true, data: result.agreement });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: msg });
  }
});

router.post('/:id/fund', actionRateLimit, async (req: Request, res: Response) => {
  try {
    const result = await getAgreementParticipantRecord(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const authAddress = getAuthAddress(req);
    if (result.agreement.clientAddress !== authAddress) {
      return res.status(403).json({ success: false, error: 'Only the client can fund this agreement' });
    }

    const { txHash, milestoneOutputs } = fundSchema.parse(req.body);
    const agreement = result.agreement.id && (await agreementService.getAgreementById(req.params.id));
    const updated = agreement?.escrowModel === 'ONCHAIN_LOCK'
      ? await agreementService.registerOnchainFundingIntent(req.params.id, txHash, milestoneOutputs || [])
      : await agreementService.fundAgreement(req.params.id, txHash);
    await createAuditLog({
      agreementId: req.params.id,
      actorAddress: authAddress,
      action: 'AGREEMENT_FUNDING_SUBMITTED',
      resourceType: 'SETTLEMENT',
      resourceId: req.params.id,
      metadata: { txHash },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validation error';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:id/onchain-resolution', actionRateLimit, async (req: Request, res: Response) => {
  try {
    const result = await getAgreementDetailForParticipant(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const authAddress = getAuthAddress(req);
    const { milestoneId, txHash, direction } = onchainResolutionSchema.parse(req.body);
    const agreement = result.agreement;
    const isClient = agreement.clientAddress === authAddress;
    const isArbitrator = agreement.arbitratorAddress === authAddress;

    if (agreement.escrowModel !== 'ONCHAIN_LOCK') {
      return res.status(400).json({ success: false, error: 'This agreement does not use the on-chain lock settlement path' });
    }

    if (direction === 'PAYOUT' && !isClient && !isArbitrator) {
      return res.status(403).json({ success: false, error: 'Only the client or appointed arbitrator can submit an on-chain payout resolution' });
    }

    if (direction === 'REFUND' && !isArbitrator && agreement.status !== 'DRAFT' && agreement.status !== 'FUNDED' && agreement.status !== 'PROOF_SUBMITTED' && agreement.status !== 'UNDER_REVIEW' && agreement.status !== 'DISPUTED') {
      return res.status(403).json({ success: false, error: 'Only the arbitrator can submit an on-chain refund resolution unless the refund is handled by timeout.' });
    }

    const updated = await agreementService.recordOnchainResolutionIntent({
      agreementId: req.params.id,
      milestoneId,
      txHash,
      direction,
    });
    await createAuditLog({
      agreementId: req.params.id,
      actorAddress: authAddress,
      action: direction === 'PAYOUT' ? 'ONCHAIN_PAYOUT_SUBMITTED' : 'ONCHAIN_REFUND_SUBMITTED',
      resourceType: 'SETTLEMENT',
      resourceId: req.params.id,
      metadata: { txHash, milestoneId },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to submit on-chain resolution';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:id/submit-proof', actionRateLimit, async (req: Request, res: Response) => {
  try {
    const result = await getAgreementParticipantRecord(req);
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
    await createAuditLog({
      agreementId: req.params.id,
      actorAddress: authAddress,
      action: 'PROOF_SUBMITTED',
      resourceType: 'AGREEMENT',
      resourceId: req.params.id,
      metadata: {
        milestoneId: data.milestoneId,
        proofType: data.proofType,
      },
    });
    triggerAgentCycleSoon('proof submission');
    res.json({ success: true, data: response });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validation error';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:id/open-dispute', actionRateLimit, async (req: Request, res: Response) => {
  try {
    const result = await getAgreementParticipantRecord(req);
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
    await createAuditLog({
      agreementId: req.params.id,
      actorAddress: authAddress,
      action: 'DISPUTE_OPENED',
      resourceType: 'DISPUTE',
      resourceId: response.dispute.id,
      metadata: {
        milestoneId: data.milestoneId,
      },
    });
    res.json({ success: true, data: response });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validation error';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:id/dispute/evidence', actionRateLimit, async (req: Request, res: Response) => {
  try {
    const result = await getAgreementParticipantRecord(req);
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
    await createAuditLog({
      agreementId: req.params.id,
      actorAddress: authAddress,
      action: 'DISPUTE_EVIDENCE_ADDED',
      resourceType: 'DISPUTE',
      resourceId: data.disputeId,
      metadata: {
        evidenceLength: data.content.length,
      },
    });
    triggerAgentCycleSoon('dispute evidence');
    res.json({ success: true, data: response });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validation error';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:id/dispute/refund-consent', actionRateLimit, async (req: Request, res: Response) => {
  try {
    const result = await getAgreementParticipantRecord(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const authAddress = getAuthAddress(req);
    const data = mutualRefundConsentSchema.parse(req.body);
    if (data.actorAddress !== authAddress) {
      return res.status(403).json({ success: false, error: 'Authenticated wallet must match the refund approver' });
    }

    const response = await agreementService.recordMutualRefundConsent(req.params.id, data.actorAddress);
    res.json({ success: true, data: response });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validation error';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:id/review-action', actionRateLimit, async (req: Request, res: Response) => {
  try {
    const result = await getAgreementParticipantRecord(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const authAddress = getAuthAddress(req);
    const isClient = result.agreement.clientAddress === authAddress;

    if (!isClient) {
      return res.status(403).json({ success: false, error: 'Only the client can approve payout from the review panel' });
    }

    const { action, reviewerAddress } = reviewActionSchema.parse(req.body);
    if (reviewerAddress !== authAddress) {
      return res.status(403).json({ success: false, error: 'Authenticated wallet must match the reviewer' });
    }

    if (action === 'APPROVE') {
      const updated = await agreementService.approveCurrentMilestone(req.params.id);
      await createAuditLog({
        agreementId: req.params.id,
        actorAddress: authAddress,
        action: 'MILESTONE_APPROVED',
        resourceType: 'AGREEMENT',
        resourceId: req.params.id,
      });
      triggerAgentCycleSoon('milestone approval');
      return res.json({ success: true, data: updated });
    }

    if (action === 'REJECT') {
      return res.status(409).json({
        success: false,
        error: 'Direct refunds are disabled. Open a dispute first, then both client and worker must approve the refund.',
      });
    }

    res.json({ success: true, data: { message: 'Escalated for manual review' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validation error';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:id/reconcile', actionRateLimit, async (req: Request, res: Response) => {
  try {
    const result = await getAgreementParticipantRecord(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const authAddress = getAuthAddress(req);
    const updated = await agreementService.reconcileAgreementSettlement(req.params.id);
    await createAuditLog({
      agreementId: req.params.id,
      actorAddress: authAddress,
      action: 'SETTLEMENT_RECHECK_REQUESTED',
      resourceType: 'SETTLEMENT',
      resourceId: req.params.id,
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to reconcile agreement settlement';
    res.status(400).json({ success: false, error: msg });
  }
});

router.get('/:id/logs', async (req: Request, res: Response) => {
  try {
    const result = await getAgreementParticipantRecord(req);
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

router.get('/:id/audit', async (req: Request, res: Response) => {
  try {
    const result = await getAgreementParticipantRecord(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const limit = parseInt((req.query.limit as string) || '100', 10);
    const logs = await getAuditLogsForAgreement(req.params.id, limit);
    res.json({ success: true, data: logs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: msg });
  }
});

router.get('/:id/dispute', async (req: Request, res: Response) => {
  try {
    const result = await getAgreementParticipantRecord(req);
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
    const result = await getAgreementDetailForParticipant(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const agreement = result.agreement;
    const dispute = agreement.disputes.find((item: any) => !item.resolvedAt);
    if (!dispute) {
      return res.status(404).json({ success: false, error: 'No open dispute found' });
    }

    const readiness = evaluateRecommendationReadiness({
      dispute,
      agreement,
    });

    if (!readiness.ready) {
      return res.status(409).json({
        success: false,
        error: `AI recommendation is not available yet. It unlocks after the other participant replies or after ${readiness.responseDeadlineAt.toISOString()}.`,
      });
    }

    const milestone = agreement.milestones?.find((item: any) => item.id === dispute.milestoneId);
    const proof = milestone && 'proofs' in milestone
      ? milestone.proofs[0]
      : undefined;

    const recommendation = await generateRecommendation(req.params.id, {
      agreementTitle: agreement.title,
      agreementAmount: milestone?.amount || agreement.amount,
      proofContent: proof?.content || null,
      proofType: proof?.proofType || null,
      disputeReason: dispute.reason,
      evidenceNotes: dispute.evidenceNotes,
      evidenceTimeline: (dispute.evidenceEntries || []).map((entry: any) => ({
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
