import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { requireAdmin } from '../middleware/admin';
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
import { normalizeWalletAddress } from '../services/authService';
import {
  buildInfoRequestComment,
  buildInfoResponseComment,
  createStructuredInfoRequest,
  findInfoRequestRecord,
  generateFollowUpDraftWithAI,
  getInfoRequestRecordsForAgreement,
  respondToStructuredInfoRequest,
} from '../services/followUpService';
import {
  markProofNeedsMoreInfo,
  reviewSubmittedProof,
  startProofReview,
} from '../services/reportReviewService';
import {
  markSourceSyncReviewed,
  publishSourceSyncUpdate,
  saveSourceSyncDraft,
  syncAgreementSource,
} from '../services/sourceSyncService';
import { resolveNervosGrantAutofill } from '../services/nervosGrantResolverService';
import {
  enqueueAgreementJob,
  listAgreementJobs,
  replayJob,
} from '../services/jobQueueService';
import { getLogs } from '../services/logService';
import type { ArtifactKind, DisputeResolutionChoice } from '../services/richPayloadService';
import { runAgentCycle } from '../worker/agentLoop';

const router = Router();
const actionRateLimit = createRateLimit({
  namespace: 'agreement-action',
  windowMs: config.actionRateLimitWindowMs,
  max: config.actionRateLimitMax,
});

const MAX_ARTIFACT_SIZE_BYTES = 1024 * 1024;
const MAX_ARTIFACT_SIZE_LABEL = '1 MB';

function isSponsorControlledImportedAgreement(agreement: {
  source?: {
    sourceType?: string | null;
  } | null;
}) {
  return agreement.source?.sourceType === 'BOUNTY' || agreement.source?.sourceType === 'DAO';
}

type AgreementParticipantRecord = NonNullable<
  Awaited<ReturnType<typeof agreementService.getAgreementParticipantById>>
>;
type AgreementDetailRecord = NonNullable<
  Awaited<ReturnType<typeof agreementService.getAgreementById>>
>;
type AgreementAccessError = 'Agreement not found' | 'You are not a participant in this agreement';
type AgreementAccessResult<T> = { agreement: T } | { error: AgreementAccessError };

async function hasCreatorAccess(agreementId: string, authAddress: string) {
  const source = await prisma.agreementSource.findUnique({
    where: { agreementId },
    select: { createdByAddress: true },
  });

  return source?.createdByAddress === authAddress;
}

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
  payoutNetwork: z.literal('CKB').default('CKB'),
  escrowModel: z.enum(['TREASURY_BRIDGE', 'ONCHAIN_LOCK']).default('TREASURY_BRIDGE'),
  milestones: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        description: z.string().min(1).max(1000),
        amount: z.string().min(1),
        targetUsd: z.number().positive().optional(),
      })
    )
    .min(1),
});

const importBountySchema = z.object({
  sourceType: z.enum(['DAO', 'BOUNTY']),
  sourceLabel: z.string().min(1).max(120),
  externalUrl: z.string().url(),
  forumThreadUrl: z.string().url().optional(),
  sourceReferenceId: z.string().max(120).optional(),
  sponsorName: z.string().max(120).optional(),
  bountyTitle: z.string().min(1).max(200),
  bountyDescription: z.string().max(4000).optional(),
  governanceNotes: z.string().max(2000).optional(),
  externalMetadataJson: z.string().max(50000).optional(),
  agreement: createAgreementSchema,
});

const bountyAutofillSchema = z.object({
  sourceUrl: z.string().url(),
});

const fundSchema = z.object({
  txHash: z.string().min(1),
  amount: z.string().min(1).optional(),
  milestoneOutputs: z.array(
    z.object({
      milestoneId: z.string().min(1),
      outputIndex: z.number().int().min(0),
      escrowCellData: z.string().min(1),
      refundTimeoutBlock: z.string().min(1),
    })
  ).optional(),
  commencementOutputIndex: z.number().int().min(0).optional(),
});

const positiveIntegerString = z.string().regex(/^[1-9]\d*$/, 'Amount must be a positive integer string.');

const topUpReserveSchema = z.object({
  txHash: z.string().min(1),
  amount: positiveIntegerString,
});

const submitProofSchema = z.object({
  milestoneId: z.string().min(1),
  proofType: z.enum(['URL', 'TEXT', 'FILE_HASH']),
  content: z.string().default(''),
  contentHash: z.string().optional(),
  summary: z.string().optional(),
  artifacts: z.array(z.object({
    id: z.string().optional(),
    kind: z.enum(['TEXT', 'URL', 'FILE', 'IMAGE']),
    label: z.string().optional(),
    mimeType: z.string().optional(),
    content: z.string().min(1),
    sizeBytes: z.number().int().nonnegative().optional(),
  })).optional(),
}).refine(
  (data) => Boolean(data.content.trim() || data.summary?.trim() || data.artifacts?.length),
  'Proof requires text, summary, or at least one artifact.'
);

const proofCheckSchema = z.object({
  milestoneId: z.string().min(1),
  async: z.boolean().optional(),
});

const openDisputeSchema = z.object({
  milestoneId: z.string().min(1),
  openedBy: z.string().min(1),
  reason: z.string().min(1),
  evidenceNotes: z.string().optional(),
  desiredResolution: z.enum(['PAYOUT', 'REFUND', 'SPLIT']).optional(),
  splitWorkerAmount: z.string().optional(),
  artifacts: z.array(z.object({
    id: z.string().optional(),
    kind: z.enum(['TEXT', 'URL', 'FILE', 'IMAGE']),
    label: z.string().optional(),
    mimeType: z.string().optional(),
    content: z.string().min(1),
    sizeBytes: z.number().int().nonnegative().optional(),
  })).optional(),
});

const addDisputeEvidenceSchema = z.object({
  disputeId: z.string().min(1),
  submittedBy: z.string().min(1),
  content: z.string().default(''),
  desiredResolution: z.enum(['PAYOUT', 'REFUND', 'SPLIT']).optional(),
  splitWorkerAmount: z.string().optional(),
  artifacts: z.array(z.object({
    id: z.string().optional(),
    kind: z.enum(['TEXT', 'URL', 'FILE', 'IMAGE']),
    label: z.string().optional(),
    mimeType: z.string().optional(),
    content: z.string().min(1),
    sizeBytes: z.number().int().nonnegative().optional(),
  })).optional(),
}).refine(
  (data) => Boolean(data.content.trim() || data.artifacts?.length),
  'Dispute evidence requires text or at least one artifact.'
);

const mutualRefundConsentSchema = z.object({
  actorAddress: z.string().min(1),
});

const splitSettlementSchema = z.object({
  actorAddress: z.string().min(1),
  workerAmount: z.string().min(1),
});

const reviewActionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'ESCALATE']),
  reviewerAddress: z.string().min(1),
  confirmation: z.object({
    confirmed: z.literal(true),
    summary: z.string().min(3).max(1000),
    aiSuggestionAcknowledged: z.boolean().optional(),
    proofCheckAcknowledged: z.boolean().optional(),
  }).optional(),
});

const infoRequestDraftSchema = z.object({
  milestoneId: z.string().min(1),
});

const infoRequestCreateSchema = z.object({
  milestoneId: z.string().min(1),
  requesterAddress: z.string().min(1),
  questions: z.array(z.string().min(1).max(400)).min(1),
  note: z.string().max(2000).optional(),
});

const infoRequestResponseSchema = z.object({
  milestoneId: z.string().min(1),
  requestId: z.string().min(1),
  responderAddress: z.string().min(1),
  content: z.string().min(1).max(4000),
});

const sourceSyncSchema = z.object({
  forumThreadUrl: z.string().url().optional(),
  manualSummary: z.string().max(4000).optional(),
});

const sourceSyncPublishSchema = z.object({
  action: z.enum(['DRAFT', 'PUBLISH', 'REVIEW']),
  content: z.string().max(4000).optional(),
  reviewerApproved: z.boolean().optional(),
});

function artifactExceedsLimit(artifact: {
  sizeBytes?: number;
  content: string;
}) {
  if (typeof artifact.sizeBytes === 'number') {
    return artifact.sizeBytes > MAX_ARTIFACT_SIZE_BYTES;
  }

  return artifact.content.length > MAX_ARTIFACT_SIZE_BYTES * 2;
}

function findOversizedArtifact(
  artifacts:
    | Array<{
        kind: ArtifactKind;
        content: string;
        sizeBytes?: number;
      }>
    | undefined
) {
  return artifacts?.find((artifact) => artifactExceedsLimit(artifact)) || null;
}

function getOversizedArtifactMessage(kind: ArtifactKind) {
  return `${kind === 'IMAGE' ? 'Image' : 'Attachment'} uploads must be ${MAX_ARTIFACT_SIZE_LABEL} or smaller.`;
}

const updateDraftSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  workerAddress: z.string().min(1),
  deadlineAt: z.string().datetime(),
  disputeWindowSecs: z.number().int().min(3600),
  proofType: z.enum(['URL', 'TEXT', 'FILE_HASH']),
  reviewerMode: z.enum(['AUTO', 'HYBRID', 'MANUAL']),
  releaseMode: z.enum(['FULL', 'PARTIAL']),
  payoutNetwork: z.literal('CKB'),
  milestones: z.array(z.object({
    id: z.string().optional(),
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(1000),
    amount: z.string().min(1),
  })).min(1),
});

const createCommentSchema = z.object({
  authorAddress: z.string().min(1),
  content: z.string().min(1).max(4000),
});

const createAmendmentSchema = z.object({
  proposedBy: z.string().min(1),
  reason: z.string().max(2000).optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  deadlineAt: z.string().datetime().optional(),
  disputeWindowSecs: z.number().int().min(3600).optional(),
  releaseMode: z.enum(['FULL', 'PARTIAL']).optional(),
  payoutNetwork: z.literal('CKB').optional(),
  milestones: z.array(z.object({
    id: z.string().min(1),
    title: z.string().max(120).optional(),
    description: z.string().max(1000).optional(),
    sortOrder: z.number().int().min(1).optional(),
  })).optional(),
});

const respondAmendmentSchema = z.object({
  actorAddress: z.string().min(1),
  accept: z.boolean(),
  responseNote: z.string().max(2000).optional(),
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

  return normalizeWalletAddress(req.auth.address);
}

function triggerAgentCycleSoon(reason: string) {
  void runAgentCycle().catch((err) => {
    console.error(`[AGENT] Immediate cycle failed after ${reason}:`, err);
  });
}

async function queueAgreementJob(agreementId: string, reason: string, kind: 'AGREEMENT_CONTINUE' | 'VERIFY_FUNDING' | 'RECONCILE_SETTLEMENT' | 'DISPUTE_RECOMMENDATION' = 'AGREEMENT_CONTINUE') {
  await enqueueAgreementJob({
    agreementId,
    kind,
    dedupeSuffix: reason,
  });
  triggerAgentCycleSoon(reason);
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
    !(await hasCreatorAccess(agreement.id, authAddress))
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

    if (normalizeWalletAddress(data.clientAddress) !== authAddress) {
      return res.status(403).json({ success: false, error: 'Authenticated wallet must match the client address' });
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
    await queueAgreementJob(agreement.id, 'agreement created');
    res.json({ success: true, data: agreement });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validation error';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/import-bounty', actionRateLimit, async (req: Request, res: Response) => {
  try {
    const authAddress = getAuthAddress(req);
    const data = importBountySchema.parse(req.body);

    if (normalizeWalletAddress(data.agreement.clientAddress) !== authAddress) {
      return res.status(403).json({ success: false, error: 'Authenticated wallet must match the client address' });
    }

    const agreement = await agreementService.createAgreement({
      ...data.agreement,
      reviewerMode: 'MANUAL',
      releaseMode: 'PARTIAL',
      escrowModel: 'TREASURY_BRIDGE',
      sourceMetadata: {
        sourceType: data.sourceType,
        sourceLabel: data.sourceLabel,
        externalUrl: data.externalUrl,
        forumThreadUrl: data.forumThreadUrl,
        sourceReferenceId: data.sourceReferenceId,
        externalMetadataJson: data.externalMetadataJson,
        sponsorName: data.sponsorName,
        bountyTitle: data.bountyTitle,
        bountyDescription: data.bountyDescription,
        governanceNotes: data.governanceNotes,
        createdByAddress: authAddress,
      },
      milestones: data.agreement.milestones.map((milestone) => ({
        ...milestone,
        targetUsd: milestone.targetUsd,
      })),
    });

    await createAuditLog({
      agreementId: agreement.id,
      actorAddress: authAddress,
      action: 'AGREEMENT_IMPORTED_FROM_BOUNTY',
      resourceType: 'AGREEMENT',
      resourceId: agreement.id,
      metadata: {
        sourceType: data.sourceType,
        sourceLabel: data.sourceLabel,
        externalUrl: data.externalUrl,
      },
    });
    await queueAgreementJob(agreement.id, 'bounty imported');
    res.json({ success: true, data: agreement });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validation error';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/import-bounty/autofill', requireAuth, actionRateLimit, async (req: Request, res: Response) => {
  try {
    getAuthAddress(req);
    const data = bountyAutofillSchema.parse(req.body);
    const result = await resolveNervosGrantAutofill(data.sourceUrl);
    res.json({ success: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to resolve grant source';
    res.status(400).json({ success: false, error: msg });
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const authAddress = getAuthAddress(req);
    const requestedAddress = req.query.address as string | undefined;

    if (requestedAddress && normalizeWalletAddress(requestedAddress) !== authAddress) {
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

router.patch('/:id/draft', actionRateLimit, async (req: Request, res: Response) => {
  try {
    const result = await getAgreementParticipantRecord(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const authAddress = getAuthAddress(req);
    if (result.agreement.clientAddress !== authAddress) {
      return res.status(403).json({ success: false, error: 'Only the client can edit a draft agreement' });
    }

    const data = updateDraftSchema.parse(req.body);
    const updated = await agreementService.updateDraftAgreement(req.params.id, data);
    await createAuditLog({
      agreementId: req.params.id,
      actorAddress: authAddress,
      action: 'AGREEMENT_DRAFT_UPDATED',
      resourceType: 'AGREEMENT',
      resourceId: req.params.id,
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to update draft agreement';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:id/cancel', actionRateLimit, async (req: Request, res: Response) => {
  try {
    const result = await getAgreementParticipantRecord(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const authAddress = getAuthAddress(req);
    if (result.agreement.clientAddress !== authAddress) {
      return res.status(403).json({ success: false, error: 'Only the client can cancel a draft agreement' });
    }

    const updated = await agreementService.cancelDraftAgreement(req.params.id);
    await createAuditLog({
      agreementId: req.params.id,
      actorAddress: authAddress,
      action: 'AGREEMENT_CANCELLED',
      resourceType: 'AGREEMENT',
      resourceId: req.params.id,
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to cancel agreement';
    res.status(400).json({ success: false, error: msg });
  }
});

router.get('/:id/comments', async (req: Request, res: Response) => {
  try {
    const result = await getAgreementDetailForParticipant(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    res.json({ success: true, data: result.agreement.comments || [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: msg });
  }
});

router.post('/:id/comments', actionRateLimit, async (req: Request, res: Response) => {
  try {
    const result = await getAgreementParticipantRecord(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const authAddress = getAuthAddress(req);
    const data = createCommentSchema.parse(req.body);
    if (normalizeWalletAddress(data.authorAddress) !== authAddress) {
      return res.status(403).json({ success: false, error: 'Authenticated wallet must match the comment author' });
    }

    const response = await agreementService.createAgreementComment(req.params.id, data.authorAddress, data.content);
    await createAuditLog({
      agreementId: req.params.id,
      actorAddress: authAddress,
      action: 'AGREEMENT_COMMENT_ADDED',
      resourceType: 'AGREEMENT',
      resourceId: req.params.id,
    });
    res.json({ success: true, data: response });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to add agreement comment';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:id/amendments', actionRateLimit, async (req: Request, res: Response) => {
  try {
    const result = await getAgreementParticipantRecord(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const authAddress = getAuthAddress(req);
    const data = createAmendmentSchema.parse(req.body);
    if (normalizeWalletAddress(data.proposedBy) !== authAddress) {
      return res.status(403).json({ success: false, error: 'Authenticated wallet must match the amendment proposer' });
    }

    const response = await agreementService.proposeAgreementAmendment(req.params.id, data.proposedBy, data);
    await createAuditLog({
      agreementId: req.params.id,
      actorAddress: authAddress,
      action: 'AGREEMENT_AMENDMENT_PROPOSED',
      resourceType: 'AGREEMENT',
      resourceId: req.params.id,
    });
    res.json({ success: true, data: response });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to propose agreement amendment';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:id/amendments/:amendmentId/respond', actionRateLimit, async (req: Request, res: Response) => {
  try {
    const result = await getAgreementParticipantRecord(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const authAddress = getAuthAddress(req);
    const data = respondAmendmentSchema.parse(req.body);
    if (normalizeWalletAddress(data.actorAddress) !== authAddress) {
      return res.status(403).json({ success: false, error: 'Authenticated wallet must match the amendment responder' });
    }

    const updated = await agreementService.respondToAgreementAmendment(
      req.params.id,
      req.params.amendmentId,
      data.actorAddress,
      data,
    );
    await createAuditLog({
      agreementId: req.params.id,
      actorAddress: authAddress,
      action: data.accept ? 'AGREEMENT_AMENDMENT_ACCEPTED' : 'AGREEMENT_AMENDMENT_REJECTED',
      resourceType: 'AGREEMENT',
      resourceId: req.params.amendmentId,
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to respond to agreement amendment';
    res.status(400).json({ success: false, error: msg });
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

    const { txHash, amount, milestoneOutputs, commencementOutputIndex } = fundSchema.parse(req.body);
    const agreement = result.agreement.id && (await agreementService.getAgreementById(req.params.id));
    const updated = agreement?.escrowModel === 'ONCHAIN_LOCK'
      ? await agreementService.registerOnchainFundingIntent(req.params.id, txHash, milestoneOutputs || [], commencementOutputIndex)
      : await agreementService.fundAgreement(req.params.id, txHash, amount);
    await createAuditLog({
      agreementId: req.params.id,
      actorAddress: authAddress,
      action: 'AGREEMENT_FUNDING_SUBMITTED',
      resourceType: 'SETTLEMENT',
      resourceId: req.params.id,
      metadata: { txHash },
    });
    await queueAgreementJob(req.params.id, 'funding submitted', 'VERIFY_FUNDING');
    res.json({ success: true, data: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validation error';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:id/reserve/top-up', actionRateLimit, async (req: Request, res: Response) => {
  try {
    const result = await getAgreementParticipantRecord(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const authAddress = getAuthAddress(req);
    if (result.agreement.clientAddress !== authAddress) {
      return res.status(403).json({ success: false, error: 'Only the client can top up this imported grant reserve' });
    }

    const { txHash, amount } = topUpReserveSchema.parse(req.body);
    const updated = await agreementService.topUpImportedGrantReserve(req.params.id, txHash, amount);

    await createAuditLog({
      agreementId: req.params.id,
      actorAddress: authAddress,
      action: 'AGREEMENT_RESERVE_TOP_UP',
      resourceType: 'SETTLEMENT',
      resourceId: req.params.id,
      metadata: { txHash, amount },
    });

    await queueAgreementJob(req.params.id, 'reserve top-up confirmed');

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
    const isWorker = agreement.workerAddress === authAddress;
    const isSponsorControlledImport = isSponsorControlledImportedAgreement(agreement);

    if (agreement.escrowModel !== 'ONCHAIN_LOCK') {
      return res.status(400).json({ success: false, error: 'This agreement does not use the on-chain lock settlement path' });
    }

    if (direction === 'PAYOUT' && !isClient) {
      return res.status(403).json({ success: false, error: 'Only the client can submit an on-chain payout resolution' });
    }

    if (direction === 'REFUND' && !isWorker && !isClient) {
      return res.status(403).json({ success: false, error: 'Only the worker or client timeout path can submit an on-chain refund resolution.' });
    }

    if (direction === 'REFUND' && isSponsorControlledImport) {
      return res.status(409).json({ success: false, error: 'Imported grant milestones do not support worker refund settlement.' });
    }

    if (direction === 'PAYOUT') {
      const currentMilestone = agreement.milestones?.find((item: any) => item.id === milestoneId) || null;
      const openDispute = currentMilestone?.disputes?.find((item: any) => !item.resolvedAt) || null;
      const blockingSettlementProposal = agreementService.getBlockingDisputeSettlementProposal({
        dispute: openDispute,
      });

      if (blockingSettlementProposal) {
        return res.status(409).json({
          success: false,
          error: blockingSettlementProposal.type === 'SPLIT'
            ? 'A split settlement proposal is still open. The worker must accept it before funds move, or the dispute must be resolved before a full payout can be approved.'
            : 'A mutual refund proposal is still open. Resolve the refund proposal before approving a full payout.',
        });
      }
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
    const oversizedArtifact = findOversizedArtifact(data.artifacts as Array<{
      kind: ArtifactKind;
      content: string;
      sizeBytes?: number;
    }> | undefined);
    if (oversizedArtifact) {
      return res.status(400).json({
        success: false,
        error: getOversizedArtifactMessage(oversizedArtifact.kind),
      });
    }

    const response = await agreementService.submitProof(
      req.params.id,
      data.milestoneId,
      data.proofType,
      data.content,
      data.contentHash,
      {
        summary: data.summary,
        artifacts: data.artifacts as Array<{
          id?: string;
          kind: ArtifactKind;
          label?: string;
          mimeType?: string;
          content: string;
          sizeBytes?: number;
        }> | undefined,
      }
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
    await queueAgreementJob(req.params.id, 'proof submission');
    res.json({ success: true, data: response });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validation error';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:id/proof/check', actionRateLimit, async (req: Request, res: Response) => {
  try {
    const result = await getAgreementParticipantRecord(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const authAddress = getAuthAddress(req);
    const data = proofCheckSchema.parse(req.body);
    if (data.async) {
      const started = await startProofReview({
        agreementId: req.params.id,
        milestoneId: data.milestoneId,
        triggeredByAddress: authAddress,
        triggeredByType: 'USER',
      });

      await createAuditLog({
        agreementId: req.params.id,
        actorAddress: authAddress,
        action: 'PROOF_CHECK_STARTED',
        resourceType: 'PROOF',
        resourceId: started.proofId,
        metadata: started,
      });

      await queueAgreementJob(req.params.id, `proof-check:${data.milestoneId}`);
      return res.json({
        success: true,
        data: {
          queued: true,
          proofCheck: started,
        },
      });
    }

    const review = await reviewSubmittedProof(req.params.id, data.milestoneId, {
      triggeredByAddress: authAddress,
      triggeredByType: 'USER',
    });

    res.json({ success: true, data: review });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to check submitted proof';
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
    if (normalizeWalletAddress(data.openedBy) !== authAddress) {
      return res.status(403).json({ success: false, error: 'Authenticated wallet must match the dispute opener' });
    }

    if (isSponsorControlledImportedAgreement(result.agreement)) {
      return res.status(409).json({
        success: false,
        error: 'Imported grant milestones do not use disputes. Use reviewer follow-up messages instead.',
      });
    }

    const allowedResolutionChoices = agreementService.getAllowedDisputeResolutionChoices({
      actorAddress: data.openedBy,
      clientAddress: result.agreement.clientAddress,
      workerAddress: result.agreement.workerAddress,
    });
    if (!allowedResolutionChoices.length) {
      return res.status(403).json({
        success: false,
        error: 'Only the client or worker can open a milestone dispute.',
      });
    }

    if (
      data.desiredResolution
      && !(allowedResolutionChoices as readonly string[]).includes(data.desiredResolution)
    ) {
      return res.status(400).json({
        success: false,
        error:
          data.desiredResolution === 'PAYOUT'
            ? 'Clients should approve payout from the review panel, not request payout inside a dispute.'
            : 'This dispute resolution option is not available for your agreement role.',
      });
    }

    const oversizedArtifact = findOversizedArtifact(data.artifacts as Array<{
      kind: ArtifactKind;
      content: string;
      sizeBytes?: number;
    }> | undefined);
    if (oversizedArtifact) {
      return res.status(400).json({
        success: false,
        error: getOversizedArtifactMessage(oversizedArtifact.kind),
      });
    }

    const response = await agreementService.openDispute(
      req.params.id,
      data.milestoneId,
      data.openedBy,
      data.reason,
      data.evidenceNotes,
      {
        desiredResolution: data.desiredResolution as DisputeResolutionChoice | undefined,
        splitWorkerAmount: data.splitWorkerAmount,
        artifacts: data.artifacts as Array<{
          id?: string;
          kind: ArtifactKind;
          label?: string;
          mimeType?: string;
          content: string;
          sizeBytes?: number;
        }> | undefined,
      }
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
    await queueAgreementJob(req.params.id, 'dispute opened');
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
    if (normalizeWalletAddress(data.submittedBy) !== authAddress) {
      return res.status(403).json({ success: false, error: 'Authenticated wallet must match the evidence submitter' });
    }

    if (isSponsorControlledImportedAgreement(result.agreement)) {
      return res.status(409).json({
        success: false,
        error: 'Imported grant milestones do not use the dispute evidence workspace.',
      });
    }

    const oversizedArtifact = findOversizedArtifact(data.artifacts as Array<{
      kind: ArtifactKind;
      content: string;
      sizeBytes?: number;
    }> | undefined);
    if (oversizedArtifact) {
      return res.status(400).json({
        success: false,
        error: getOversizedArtifactMessage(oversizedArtifact.kind),
      });
    }

    const response = await agreementService.addDisputeEvidence(
      req.params.id,
      data.disputeId,
      data.submittedBy,
      data.content,
      {
        desiredResolution: data.desiredResolution as DisputeResolutionChoice | undefined,
        splitWorkerAmount: data.splitWorkerAmount,
        artifacts: data.artifacts as Array<{
          id?: string;
          kind: ArtifactKind;
          label?: string;
          mimeType?: string;
          content: string;
          sizeBytes?: number;
        }> | undefined,
      }
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
    await queueAgreementJob(req.params.id, 'dispute evidence');
    res.json({ success: true, data: response });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validation error';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:id/dispute/split-offer', actionRateLimit, async (req: Request, res: Response) => {
  try {
    const result = await getAgreementParticipantRecord(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const authAddress = getAuthAddress(req);
    const data = splitSettlementSchema.parse(req.body);
    if (normalizeWalletAddress(data.actorAddress) !== authAddress) {
      return res.status(403).json({ success: false, error: 'Authenticated wallet must match the split settlement actor' });
    }

    if (isSponsorControlledImportedAgreement(result.agreement)) {
      return res.status(409).json({
        success: false,
        error: 'Imported grant milestones do not support split settlement disputes.',
      });
    }

    const response = await agreementService.recordSplitSettlementConsent(
      req.params.id,
      data.actorAddress,
      data.workerAmount
    );
    await queueAgreementJob(req.params.id, 'split settlement consent');
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
    if (normalizeWalletAddress(data.actorAddress) !== authAddress) {
      return res.status(403).json({ success: false, error: 'Authenticated wallet must match the refund approver' });
    }

    if (isSponsorControlledImportedAgreement(result.agreement)) {
      return res.status(409).json({
        success: false,
        error: 'Imported grant milestones do not support refund settlement.',
      });
    }

    const response = await agreementService.recordMutualRefundConsent(req.params.id, data.actorAddress);
    await queueAgreementJob(req.params.id, 'refund consent');
    res.json({ success: true, data: response });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validation error';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:id/review-action', actionRateLimit, async (req: Request, res: Response) => {
  try {
    const result = await getAgreementDetailForParticipant(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const authAddress = getAuthAddress(req);
    const agreement = result.agreement;
    const isClient = agreement.clientAddress === authAddress;

    if (!isClient) {
      return res.status(403).json({ success: false, error: 'Only the client can approve payout from the review panel' });
    }

    const { action, reviewerAddress, confirmation } = reviewActionSchema.parse(req.body);
    if (normalizeWalletAddress(reviewerAddress) !== authAddress) {
      return res.status(403).json({ success: false, error: 'Authenticated wallet must match the reviewer' });
    }

    if (action === 'APPROVE') {
      const currentMilestone = agreement.milestones?.find((item: any) =>
        ['ACTIVE', 'PROOF_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'DISPUTED'].includes(item.status)
      );
      const openDispute = currentMilestone?.disputes?.find((item: any) => !item.resolvedAt) || null;
      const milestoneReviewable = currentMilestone && ['PROOF_SUBMITTED', 'UNDER_REVIEW', 'DISPUTED'].includes(currentMilestone.status);
      const blockingSettlementProposal = agreementService.getBlockingDisputeSettlementProposal({
        dispute: openDispute,
      });

      if (!confirmation?.confirmed || !confirmation.summary.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Human confirmation is required before approving payout.',
        });
      }

      if (!milestoneReviewable) {
        return res.status(409).json({
          success: false,
          error: 'Current milestone is not ready for payout approval.',
        });
      }

      if (blockingSettlementProposal) {
        return res.status(409).json({
          success: false,
          error: blockingSettlementProposal.type === 'SPLIT'
            ? 'A split settlement proposal is still open. The worker must accept it before funds move, or the dispute must be resolved before a full payout can be approved.'
            : 'A mutual refund proposal is still open. Resolve the refund proposal before approving a full payout.',
        });
      }

      if (agreement.source && agreement.reviewerMode !== 'MANUAL') {
        return res.status(409).json({
          success: false,
          error: 'Imported grants must stay in manual review mode before payout approval.',
        });
      }

      if (openDispute?.aiRecommendation && !confirmation.aiSuggestionAcknowledged) {
        return res.status(400).json({
          success: false,
          error: 'Acknowledge that the AI recommendation is advisory before approving payout.',
        });
      }

      const updated = await agreementService.approveCurrentMilestone(req.params.id);
      await createAuditLog({
        agreementId: req.params.id,
        actorAddress: authAddress,
        action: 'MILESTONE_APPROVED',
        resourceType: 'AGREEMENT',
        resourceId: req.params.id,
        metadata: {
          milestoneId: currentMilestone?.id || null,
          humanConfirmed: true,
          reviewerSummary: confirmation.summary.trim(),
          aiSuggestionAcknowledged: Boolean(confirmation.aiSuggestionAcknowledged),
          proofCheckAcknowledged: Boolean(confirmation.proofCheckAcknowledged),
        },
      });
      await queueAgreementJob(req.params.id, 'milestone approval');
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

router.post('/:id/info-request/draft', actionRateLimit, async (req: Request, res: Response) => {
  try {
    const result = await getAgreementDetailForParticipant(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const authAddress = getAuthAddress(req);
    if (result.agreement.clientAddress !== authAddress) {
      return res.status(403).json({ success: false, error: 'Only the client reviewer can draft follow-up requests' });
    }

    const { milestoneId } = infoRequestDraftSchema.parse(req.body);
    const milestone = result.agreement.milestones?.find((item: any) => item.id === milestoneId);
    if (!milestone) {
      return res.status(404).json({ success: false, error: 'Milestone not found' });
    }

    const proofCheck = await reviewSubmittedProof(req.params.id, milestoneId, {
      triggeredByAddress: authAddress,
      triggeredByType: 'USER',
    });
    const draft = await generateFollowUpDraftWithAI({
      milestoneId,
      milestoneTitle: milestone.title,
      milestoneDescription: milestone.description,
      proofCheck,
    });

    res.json({ success: true, data: draft });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to draft info request';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:id/info-request', actionRateLimit, async (req: Request, res: Response) => {
  try {
    const result = await getAgreementDetailForParticipant(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const authAddress = getAuthAddress(req);
    if (result.agreement.clientAddress !== authAddress) {
      return res.status(403).json({ success: false, error: 'Only the client reviewer can request more information' });
    }

    const data = infoRequestCreateSchema.parse(req.body);
    if (normalizeWalletAddress(data.requesterAddress) !== authAddress) {
      return res.status(403).json({ success: false, error: 'Authenticated wallet must match the info requester' });
    }

    const questions = data.questions.map((question) => question.trim()).filter(Boolean);
    if (!questions.length) {
      return res.status(400).json({ success: false, error: 'At least one follow-up question is required' });
    }

    const milestone = result.agreement.milestones?.find((item: any) => item.id === data.milestoneId);
    if (!milestone) {
      return res.status(404).json({ success: false, error: 'Milestone not found' });
    }

    const latestProof = milestone.proofs?.[0] || null;
    const infoRequest = await createStructuredInfoRequest({
      agreementId: req.params.id,
      milestoneId: data.milestoneId,
      proofId: latestProof?.id || null,
      requestedBy: authAddress,
      questions,
      note: data.note,
      commentId: null,
    });

    await markProofNeedsMoreInfo({
      agreementId: req.params.id,
      milestoneId: data.milestoneId,
      proofId: latestProof?.id || null,
      summary: 'Reviewer requested more information before this proof can move forward.',
    });

    await createAuditLog({
      agreementId: req.params.id,
      actorAddress: authAddress,
      action: 'INFO_REQUESTED',
      resourceType: 'MILESTONE',
      resourceId: data.milestoneId,
      metadata: {
        requestId: infoRequest.requestId,
        milestoneId: data.milestoneId,
        proofId: latestProof?.id || null,
        questions,
        note: data.note?.trim() || null,
        commentId: null,
      },
    });

    res.json({
      success: true,
      data: {
        requestId: infoRequest.requestId,
        agreement: await agreementService.getAgreementById(req.params.id),
        infoRequest,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to request more information';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:id/info-request/respond', actionRateLimit, async (req: Request, res: Response) => {
  try {
    const result = await getAgreementDetailForParticipant(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const authAddress = getAuthAddress(req);
    if (result.agreement.workerAddress !== authAddress) {
      return res.status(403).json({ success: false, error: 'Only the worker can send an info response' });
    }

    const data = infoRequestResponseSchema.parse(req.body);
    if (normalizeWalletAddress(data.responderAddress) !== authAddress) {
      return res.status(403).json({ success: false, error: 'Authenticated wallet must match the info responder' });
    }

    const milestone = result.agreement.milestones?.find((item: any) => item.id === data.milestoneId);
    if (!milestone) {
      return res.status(404).json({ success: false, error: 'Milestone not found' });
    }

    const infoRequest = await findInfoRequestRecord(req.params.id, data.requestId);
    if (!infoRequest || infoRequest.milestoneId !== data.milestoneId) {
      return res.status(404).json({ success: false, error: 'Info request not found for this milestone' });
    }

    if (infoRequest.resolved) {
      return res.status(409).json({ success: false, error: 'This info request has already been answered' });
    }

    const updatedInfoRequest = await respondToStructuredInfoRequest({
      agreementId: req.params.id,
      requestId: data.requestId,
      responderAddress: authAddress,
      content: data.content,
      responseCommentId: null,
    });

    await queueAgreementJob(req.params.id, `proof-recheck:${data.milestoneId}`);

    await createAuditLog({
      agreementId: req.params.id,
      actorAddress: authAddress,
      action: 'INFO_RECEIVED',
      resourceType: 'MILESTONE',
      resourceId: data.milestoneId,
      metadata: {
        requestId: data.requestId,
        milestoneId: data.milestoneId,
        responsePreview: data.content.trim().slice(0, 240),
        commentId: null,
      },
    });

    res.json({
      success: true,
      data: {
        agreement: await agreementService.getAgreementById(req.params.id),
        infoRequest: updatedInfoRequest,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to send info response';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:id/source-sync', requireAdmin, actionRateLimit, async (req: Request, res: Response) => {
  try {
    const agreement = await prisma.agreement.findUnique({
      where: { id: req.params.id },
      include: { source: true },
    });

    if (!agreement) {
      return res.status(404).json({ success: false, error: 'Agreement not found' });
    }

    if (!agreement.source) {
      return res.status(404).json({ success: false, error: 'This agreement does not have imported source metadata' });
    }

    const authAddress = getAuthAddress(req);
    const data = sourceSyncSchema.parse(req.body);
    const source = await syncAgreementSource({
      agreementId: req.params.id,
      actorAddress: authAddress,
      forumThreadUrl: data.forumThreadUrl,
      manualSummary: data.manualSummary,
    });

    await createAuditLog({
      agreementId: req.params.id,
      actorAddress: authAddress,
      action: 'SOURCE_SYNC_COMPLETED',
      resourceType: 'SOURCE',
      resourceId: agreement.source.id,
      metadata: {
        forumThreadUrl: source.forumThreadUrl,
        syncStatus: source.syncStatus,
        lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
        latestSummary: source.latestSummary,
      },
    });

    await queueAgreementJob(req.params.id, `source-sync:${source.forumThreadUrl || 'default'}`);

    res.json({ success: true, data: source });
  } catch (err) {
    const authAddress = req.auth?.address ? getAuthAddress(req) : null;
    const existingSource = await prisma.agreementSource.findUnique({
      where: { agreementId: req.params.id },
      select: { id: true },
    }).catch(() => null);

    if (existingSource) {
      await createAuditLog({
        agreementId: req.params.id,
        actorAddress: authAddress,
        action: 'SOURCE_SYNC_FAILED',
        resourceType: 'SOURCE',
        resourceId: existingSource.id,
        metadata: {
          error: err instanceof Error ? err.message : 'Unknown source sync error',
        },
      }).catch(() => undefined);
    }

    const msg = err instanceof Error ? err.message : 'Unable to sync source thread';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:id/source-sync/publish', requireAdmin, actionRateLimit, async (req: Request, res: Response) => {
  try {
    const agreement = await prisma.agreement.findUnique({
      where: { id: req.params.id },
      include: { source: true },
    });

    if (!agreement) {
      return res.status(404).json({ success: false, error: 'Agreement not found' });
    }

    if (!agreement.source) {
      return res.status(404).json({ success: false, error: 'This agreement does not have imported source metadata' });
    }

    const authAddress = getAuthAddress(req);
    const data = sourceSyncPublishSchema.parse(req.body);

    if (data.action === 'DRAFT') {
      const content = data.content?.trim();
      if (!content) {
        return res.status(400).json({ success: false, error: 'Draft content is required' });
      }

      const source = await saveSourceSyncDraft({
        agreementId: req.params.id,
        content,
      });

      await createAuditLog({
        agreementId: req.params.id,
        actorAddress: authAddress,
        action: 'SOURCE_SYNC_DRAFTED',
        resourceType: 'SOURCE',
        resourceId: agreement.source.id,
        metadata: {
          draftPreview: content.slice(0, 240),
          syncStatus: source.syncStatus,
        },
      });

      return res.json({ success: true, data: source });
    }

    if (data.action === 'PUBLISH') {
      const content = data.content?.trim();
      if (!content) {
        return res.status(400).json({ success: false, error: 'Publish content is required' });
      }

      const source = await publishSourceSyncUpdate({
        agreementId: req.params.id,
        content,
        reviewerApproved: Boolean(data.reviewerApproved),
        reviewerAddress: authAddress,
      });

      await createAuditLog({
        agreementId: req.params.id,
        actorAddress: authAddress,
        action: 'SOURCE_SYNC_PUBLISHED',
        resourceType: 'SOURCE',
        resourceId: agreement.source.id,
        metadata: {
          publishMode: 'DIRECT_POST',
          reviewerApproved: Boolean(data.reviewerApproved),
          publishedPreview: content.slice(0, 240),
          syncStatus: source.syncStatus,
          lastPublishedAt: source.lastPublishedAt?.toISOString() ?? null,
          lastPublishedUrl: source.lastPublishedUrl || null,
          lastPublishedExternalId: source.lastPublishedExternalId || null,
        },
      });

      await queueAgreementJob(req.params.id, 'source-sync:post-publish');

      return res.json({ success: true, data: source });
    }

    const source = await markSourceSyncReviewed({
      agreementId: req.params.id,
      reviewerAddress: authAddress,
    });

    await createAuditLog({
      agreementId: req.params.id,
      actorAddress: authAddress,
      action: 'SOURCE_SYNC_REVIEWED',
      resourceType: 'SOURCE',
      resourceId: agreement.source.id,
      metadata: {
        syncStatus: source.syncStatus,
        reviewedAt: source.reviewedAt?.toISOString() ?? null,
        reviewedByAddress: source.reviewedByAddress,
      },
    });

    res.json({ success: true, data: source });
  } catch (err) {
    const existingSource = await prisma.agreementSource.findUnique({
      where: { agreementId: req.params.id },
      select: { id: true },
    }).catch(() => null);

    if (existingSource) {
      await createAuditLog({
        agreementId: req.params.id,
        actorAddress: req.auth?.address ? getAuthAddress(req) : null,
        action: 'SOURCE_SYNC_FAILED',
        resourceType: 'SOURCE',
        resourceId: existingSource.id,
        metadata: {
          error: err instanceof Error ? err.message : 'Unable to update source publish state',
        },
      }).catch(() => undefined);
    }

    const msg = err instanceof Error ? err.message : 'Unable to update source publish state';
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
    await queueAgreementJob(req.params.id, 'settlement reconcile', 'RECONCILE_SETTLEMENT');
    res.json({ success: true, data: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to reconcile agreement settlement';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:id/settlement/retry', actionRateLimit, async (req: Request, res: Response) => {
  try {
    const result = await getAgreementParticipantRecord(req);
    if ('error' in result) {
      return res.status(result.error === 'Agreement not found' ? 404 : 403).json({ success: false, error: result.error });
    }

    const authAddress = getAuthAddress(req);
    const updated = await agreementService.retryFailedSettlement(req.params.id);
    await createAuditLog({
      agreementId: req.params.id,
      actorAddress: authAddress,
      action: 'SETTLEMENT_RETRY_REQUESTED',
      resourceType: 'SETTLEMENT',
      resourceId: req.params.id,
    });
    await queueAgreementJob(req.params.id, 'settlement retry', 'RECONCILE_SETTLEMENT');
    res.json({ success: true, data: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to retry agreement settlement';
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

router.get('/:id/jobs', requireAdmin, async (req: Request, res: Response) => {
  try {
    const agreement = await prisma.agreement.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!agreement) {
      return res.status(404).json({ success: false, error: 'Agreement not found' });
    }

    const limit = parseInt((req.query.limit as string) || '100', 10);
    const jobs = await listAgreementJobs(req.params.id, limit);
    res.json({ success: true, data: jobs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: msg });
  }
});

router.post('/:id/jobs/:jobId/replay', requireAdmin, actionRateLimit, async (req: Request, res: Response) => {
  try {
    const agreement = await prisma.agreement.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!agreement) {
      return res.status(404).json({ success: false, error: 'Agreement not found' });
    }

    const replayed = await replayJob(req.params.jobId);
    await createAuditLog({
      agreementId: req.params.id,
      actorAddress: req.auth?.address,
      action: 'AGENT_JOB_REPLAYED',
      resourceType: 'AGREEMENT',
      resourceId: req.params.jobId,
    });
    triggerAgentCycleSoon('job replay');
    res.json({ success: true, data: replayed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to replay job';
    res.status(400).json({ success: false, error: msg });
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
