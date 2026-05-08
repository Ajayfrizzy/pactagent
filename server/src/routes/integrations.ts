import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { requireAuth } from '../middleware/auth';
import { createRateLimit } from '../middleware/rateLimit';
import * as agreementService from '../services/agreementService';
import { normalizeWalletAddress } from '../services/authService';
import { createAuditLog } from '../services/auditLogService';
import { isValidFiberPublicKey } from '../services/fiberService';
import {
  buildCkboostImportAgreement,
  findAgreementForCkboostSource,
  importCkboostAgreementRecord,
  recordCkboostEvent,
  upsertCkboostProfileSnapshot,
} from '../services/ckboostIntegrationService';

const router = Router();
const actionRateLimit = createRateLimit({
  namespace: 'integration-action',
  windowMs: config.actionRateLimitWindowMs,
  max: config.actionRateLimitMax,
});

const milestoneSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  amount: z.string().min(1),
});

const ckboostProfileSchema = z.object({
  profileId: z.string().max(120).optional(),
  contributorExternalId: z.string().max(120).optional(),
  walletAddress: z.string().min(1).optional(),
  handle: z.string().max(120).optional(),
  displayName: z.string().max(120).optional(),
  profileUrl: z.string().url().optional(),
  campaignParticipationCount: z.number().int().min(0).optional(),
  approvedSubmissionCount: z.number().int().min(0).optional(),
  rejectedSubmissionCount: z.number().int().min(0).optional(),
  approvalRate: z.number().min(0).max(1).optional(),
  leaderboardRank: z.number().int().min(1).optional(),
  totalPoints: z.number().int().min(0).optional(),
  totalTipsReceived: z.string().optional(),
  campaignHistory: z.array(z.string().min(1).max(200)).optional(),
  stats: z.record(z.unknown()).optional(),
});

const ckboostImportSchema = z.object({
  campaign: z.object({
    id: z.string().min(1).max(120),
    title: z.string().min(1).max(200),
    url: z.string().url(),
    description: z.string().max(4000).optional(),
    sponsorName: z.string().max(120).optional(),
    governanceThreadUrl: z.string().url().optional(),
    questBundleTitle: z.string().max(200).optional(),
    proofExternalId: z.string().max(120).optional(),
    approvedProofSummary: z.string().max(2000).optional(),
    approvedProofUrl: z.string().url().optional(),
  }),
  sponsor: z.object({
    walletAddress: z.string().min(1).optional(),
    displayName: z.string().max(120).optional(),
  }).optional(),
  contributor: ckboostProfileSchema.extend({
    walletAddress: z.string().min(1),
  }),
  agreement: z.object({
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(4000),
    clientAddress: z.string().min(1),
    createdByAddress: z.string().min(1).optional(),
    deadlineAt: z.string().datetime(),
    disputeWindowSecs: z.number().int().min(3600),
    proofType: z.enum(['URL', 'TEXT', 'FILE_HASH']).default('URL'),
    payoutNetwork: z.enum(['CKB', 'FIBER']).default('CKB'),
    escrowModel: z.enum(['TREASURY_BRIDGE', 'ONCHAIN_LOCK']).default('TREASURY_BRIDGE').optional(),
    workerFiberPubkey: z.string().optional(),
    milestones: z.array(milestoneSchema).min(1),
  }),
});

const ckboostEventSchema = z.object({
  eventId: z.string().max(120).optional(),
  eventType: z.string().min(1).max(120),
  occurredAt: z.string().datetime().optional(),
  campaignId: z.string().max(120).optional(),
  agreementId: z.string().uuid().optional(),
  contributorExternalId: z.string().max(120).optional(),
  profile: ckboostProfileSchema.optional(),
  payload: z.record(z.unknown()).optional(),
  importAgreement: ckboostImportSchema.optional(),
});

function getAuthAddress(req: Request) {
  if (!req.auth?.address) {
    throw new Error('Authentication required');
  }

  return normalizeWalletAddress(req.auth.address);
}

router.post('/ckboost/import', requireAuth, actionRateLimit, async (req: Request, res: Response) => {
  try {
    const authAddress = getAuthAddress(req);
    const data = ckboostImportSchema.parse(req.body);

    const createdByAddress = data.agreement.createdByAddress
      ? normalizeWalletAddress(data.agreement.createdByAddress)
      : authAddress;

    if (createdByAddress !== authAddress) {
      return res.status(403).json({ success: false, error: 'Authenticated wallet must match the importing creator address' });
    }

    if (data.agreement.payoutNetwork === 'FIBER' && !data.agreement.workerFiberPubkey) {
      return res.status(400).json({ success: false, error: 'Fiber payouts require the contributor Fiber public key.' });
    }

    if (data.agreement.workerFiberPubkey && !isValidFiberPublicKey(data.agreement.workerFiberPubkey)) {
      return res.status(400).json({ success: false, error: 'The contributor Fiber public key format is invalid.' });
    }

    const agreement = await importCkboostAgreementRecord({
      input: data,
      actorAddress: authAddress,
      createAgreement: agreementService.createAgreement,
    });

    const fullAgreement = await agreementService.getAgreementById(agreement.id);
    res.json({ success: true, data: fullAgreement || agreement });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to import CKBoost campaign';
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/ckboost/webhook', actionRateLimit, async (req: Request, res: Response) => {
  try {
    if (config.ckboostInboundToken) {
      const token = req.header('x-ckboost-token');
      if (token !== config.ckboostInboundToken) {
        return res.status(401).json({ success: false, error: 'Invalid CKBoost webhook token' });
      }
    }

    const data = ckboostEventSchema.parse(req.body);
    let agreement = await findAgreementForCkboostSource({
      agreementId: data.agreementId,
      campaignId: data.campaignId,
    });

    if (!agreement && data.importAgreement) {
      const imported = await importCkboostAgreementRecord({
        input: data.importAgreement,
        actorAddress: '',
        createAgreement: agreementService.createAgreement,
      });

      agreement = await findAgreementForCkboostSource({
        agreementId: imported.id,
      });
    }

    if (agreement?.id && data.profile) {
      await upsertCkboostProfileSnapshot(agreement.id, {
        ...data.profile,
        contributorExternalId: data.contributorExternalId || data.profile.contributorExternalId,
      });
    }

    await recordCkboostEvent({
      agreementId: agreement?.id || null,
      externalEventId: data.eventId,
      eventType: data.eventType,
      sourceExternalId: data.campaignId || agreement?.source?.sourceReferenceId || null,
      contributorExternalId: data.contributorExternalId || data.profile?.contributorExternalId || null,
      payload: data.payload,
      occurredAt: data.occurredAt,
    });

    if (agreement?.id) {
      await createAuditLog({
        agreementId: agreement.id,
        actorAddress: null,
        actorType: 'SYSTEM',
        action: 'CKBOOST_EVENT_RECEIVED',
        resourceType: 'CKBOOST',
        resourceId: agreement.id,
        metadata: {
          eventType: data.eventType,
          eventId: data.eventId || null,
          campaignId: data.campaignId || null,
          contributorExternalId: data.contributorExternalId || null,
        },
      });
    }

    res.json({
      success: true,
      data: {
        agreementId: agreement?.id || null,
        eventType: data.eventType,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to ingest CKBoost event';
    res.status(400).json({ success: false, error: msg });
  }
});

export default router;
