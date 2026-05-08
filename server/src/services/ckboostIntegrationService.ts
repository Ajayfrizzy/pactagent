import { createHmac, randomUUID } from 'crypto';
import { config } from '../config';
import { prisma } from '../db';
import { createAuditLog } from './auditLogService';
import { createLog } from './logService';
import { enqueueJob } from './jobQueueService';

type CkboostProfileInput = {
  profileId?: string;
  contributorExternalId?: string;
  walletAddress?: string;
  handle?: string;
  displayName?: string;
  profileUrl?: string;
  campaignParticipationCount?: number;
  approvedSubmissionCount?: number;
  rejectedSubmissionCount?: number;
  approvalRate?: number;
  leaderboardRank?: number;
  totalPoints?: number;
  totalTipsReceived?: string;
  campaignHistory?: string[];
  stats?: Record<string, unknown>;
};

type CkboostImportInput = {
  campaign: {
    id: string;
    title: string;
    url: string;
    description?: string;
    sponsorName?: string;
    governanceThreadUrl?: string;
    questBundleTitle?: string;
    proofExternalId?: string;
    approvedProofSummary?: string;
    approvedProofUrl?: string;
  };
  sponsor?: {
    walletAddress?: string;
    displayName?: string;
  };
  contributor: CkboostProfileInput & {
    walletAddress: string;
  };
  agreement: {
    title: string;
    description: string;
    clientAddress: string;
    createdByAddress?: string;
    deadlineAt: string;
    disputeWindowSecs: number;
    proofType: string;
    payoutNetwork: string;
    escrowModel?: string;
    workerFiberPubkey?: string;
    milestones: Array<{
      title: string;
      description: string;
      amount: string;
    }>;
  };
};

function clampApprovalRate(value?: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value as number));
}

function parseSourceMetadata(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isCkboostSource(source: {
  sourceLabel?: string | null;
  externalMetadataJson?: string | null;
} | null | undefined) {
  if (!source) {
    return false;
  }

  const metadata = parseSourceMetadata(source.externalMetadataJson);
  if (metadata?.provider === 'CKBOOST') {
    return true;
  }

  return (source.sourceLabel || '').trim().toLowerCase() === 'ckboost';
}

export function buildCkboostSourceMetadata(input: CkboostImportInput) {
  return {
    provider: 'CKBOOST',
    campaignId: input.campaign.id,
    sponsorWalletAddress: input.sponsor?.walletAddress || null,
    sponsorDisplayName: input.sponsor?.displayName || input.campaign.sponsorName || null,
    contributorExternalId: input.contributor.contributorExternalId || null,
    profileId: input.contributor.profileId || null,
    profileUrl: input.contributor.profileUrl || null,
    campaignUrl: input.campaign.url,
    sponsorName: input.campaign.sponsorName || null,
    questBundleTitle: input.campaign.questBundleTitle || null,
    proofExternalId: input.campaign.proofExternalId || null,
    approvedProofSummary: input.campaign.approvedProofSummary || null,
    approvedProofUrl: input.campaign.approvedProofUrl || null,
  };
}

export async function upsertCkboostProfileSnapshot(agreementId: string, profile: CkboostProfileInput) {
  const snapshot = await prisma.ckboostProfileSnapshot.upsert({
    where: { agreementId },
    create: {
      agreementId,
      ckboostProfileId: profile.profileId || null,
      contributorExternalId: profile.contributorExternalId || null,
      walletAddress: profile.walletAddress || null,
      handle: profile.handle || null,
      displayName: profile.displayName || null,
      profileUrl: profile.profileUrl || null,
      campaignParticipationCount: profile.campaignParticipationCount || 0,
      approvedSubmissionCount: profile.approvedSubmissionCount || 0,
      rejectedSubmissionCount: profile.rejectedSubmissionCount || 0,
      approvalRate: clampApprovalRate(profile.approvalRate),
      leaderboardRank: profile.leaderboardRank || null,
      totalPoints: profile.totalPoints || 0,
      totalTipsReceived: profile.totalTipsReceived || null,
      campaignHistoryJson: profile.campaignHistory ? JSON.stringify(profile.campaignHistory) : null,
      statsJson: profile.stats ? JSON.stringify(profile.stats) : null,
      lastSyncedAt: new Date(),
    },
    update: {
      ckboostProfileId: profile.profileId || null,
      contributorExternalId: profile.contributorExternalId || null,
      walletAddress: profile.walletAddress || null,
      handle: profile.handle || null,
      displayName: profile.displayName || null,
      profileUrl: profile.profileUrl || null,
      campaignParticipationCount: profile.campaignParticipationCount || 0,
      approvedSubmissionCount: profile.approvedSubmissionCount || 0,
      rejectedSubmissionCount: profile.rejectedSubmissionCount || 0,
      approvalRate: clampApprovalRate(profile.approvalRate),
      leaderboardRank: profile.leaderboardRank || null,
      totalPoints: profile.totalPoints || 0,
      totalTipsReceived: profile.totalTipsReceived || null,
      campaignHistoryJson: profile.campaignHistory ? JSON.stringify(profile.campaignHistory) : null,
      statsJson: profile.stats ? JSON.stringify(profile.stats) : null,
      lastSyncedAt: new Date(),
    },
  });

  return snapshot;
}

export async function recordCkboostEvent(params: {
  agreementId?: string | null;
  externalEventId?: string | null;
  eventType: string;
  sourceExternalId?: string | null;
  contributorExternalId?: string | null;
  payload?: Record<string, unknown> | null;
  occurredAt?: string | Date;
}) {
  return prisma.ckboostEvent.create({
    data: {
      id: randomUUID(),
      agreementId: params.agreementId ?? null,
      externalEventId: params.externalEventId ?? null,
      eventType: params.eventType,
      payloadJson: params.payload ? JSON.stringify(params.payload) : null,
      sourceExternalId: params.sourceExternalId ?? null,
      contributorExternalId: params.contributorExternalId ?? null,
      occurredAt:
        params.occurredAt instanceof Date
          ? params.occurredAt
          : params.occurredAt
            ? new Date(params.occurredAt)
            : new Date(),
    },
  });
}

export async function findAgreementForCkboostSource(params: {
  agreementId?: string;
  campaignId?: string;
}) {
  if (params.agreementId) {
    return prisma.agreement.findUnique({
      where: { id: params.agreementId },
      include: {
        source: true,
        milestones: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
  }

  if (params.campaignId) {
    return prisma.agreement.findFirst({
      where: {
        source: {
          sourceReferenceId: params.campaignId,
        },
      },
      include: {
        source: true,
        milestones: {
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  return null;
}

export function buildCkboostImportAgreement(input: CkboostImportInput) {
  const sourceMetadata = buildCkboostSourceMetadata(input);
  const approvedProofContext = [
    input.campaign.approvedProofSummary ? `Approved proof summary: ${input.campaign.approvedProofSummary}` : '',
    input.campaign.approvedProofUrl ? `Approved proof URL: ${input.campaign.approvedProofUrl}` : '',
    input.campaign.questBundleTitle ? `Quest bundle: ${input.campaign.questBundleTitle}` : '',
    input.sponsor?.walletAddress ? `Sponsor wallet: ${input.sponsor.walletAddress}` : '',
  ].filter(Boolean).join('\n');

  return {
    title: input.agreement.title,
    description: approvedProofContext
      ? `${input.agreement.description}\n\n${approvedProofContext}`
      : input.agreement.description,
    clientAddress: input.agreement.clientAddress,
    workerAddress: input.contributor.walletAddress,
    workerFiberPubkey: input.agreement.workerFiberPubkey,
    deadlineAt: input.agreement.deadlineAt,
    disputeWindowSecs: input.agreement.disputeWindowSecs,
    proofType: input.agreement.proofType,
    reviewerMode: 'MANUAL',
    releaseMode: 'PARTIAL',
    payoutNetwork: input.agreement.payoutNetwork,
    escrowModel: input.agreement.escrowModel,
    milestones: input.agreement.milestones,
    sourceMetadata: {
      sourceType: 'BOUNTY',
      sourceLabel: 'CKBoost',
      externalUrl: input.campaign.url,
      forumThreadUrl: input.campaign.governanceThreadUrl,
      sourceReferenceId: input.campaign.id,
      externalMetadataJson: JSON.stringify(sourceMetadata),
      sponsorName: input.sponsor?.displayName || input.campaign.sponsorName,
      bountyTitle: input.campaign.title,
      bountyDescription: input.campaign.description,
      governanceNotes: approvedProofContext || undefined,
      createdByAddress: input.agreement.createdByAddress || input.agreement.clientAddress,
    },
  };
}

function getRetryDelayMs(attempts: number) {
  return Math.min(60_000, Math.max(5_000, attempts * 5_000));
}

export async function importCkboostAgreementRecord(params: {
  input: CkboostImportInput;
  actorAddress?: string | null;
  createAgreement: (input: ReturnType<typeof buildCkboostImportAgreement>) => Promise<{ id: string }>;
}) {
  const agreement = await params.createAgreement(buildCkboostImportAgreement(params.input));
  await upsertCkboostProfileSnapshot(agreement.id, params.input.contributor);
  await recordCkboostEvent({
    agreementId: agreement.id,
    eventType: 'CKBOOST_IMPORTED',
    sourceExternalId: params.input.campaign.id,
    contributorExternalId: params.input.contributor.contributorExternalId,
    payload: {
      campaignTitle: params.input.campaign.title,
      campaignUrl: params.input.campaign.url,
      contributorHandle: params.input.contributor.handle,
      sponsorName: params.input.campaign.sponsorName,
      importedVia: 'manual_or_webhook',
    },
  });
  await createAuditLog({
    agreementId: agreement.id,
    actorAddress: params.actorAddress || null,
    actorType: params.actorAddress ? 'USER' : 'SYSTEM',
    action: 'CKBOOST_IMPORTED',
    resourceType: 'AGREEMENT',
    resourceId: agreement.id,
    metadata: {
      campaignId: params.input.campaign.id,
      campaignTitle: params.input.campaign.title,
      contributorExternalId: params.input.contributor.contributorExternalId || null,
      contributorHandle: params.input.contributor.handle || null,
    },
  });

  return agreement;
}

export function normalizeCampaignHistory(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export function normalizeProfileInput(value: unknown): CkboostProfileInput | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const input = value as Record<string, unknown>;
  return {
    profileId: typeof input.profileId === 'string' ? input.profileId : undefined,
    contributorExternalId: typeof input.contributorExternalId === 'string' ? input.contributorExternalId : undefined,
    walletAddress: typeof input.walletAddress === 'string' ? input.walletAddress : undefined,
    handle: typeof input.handle === 'string' ? input.handle : undefined,
    displayName: typeof input.displayName === 'string' ? input.displayName : undefined,
    profileUrl: typeof input.profileUrl === 'string' ? input.profileUrl : undefined,
    campaignParticipationCount: typeof input.campaignParticipationCount === 'number' ? input.campaignParticipationCount : undefined,
    approvedSubmissionCount: typeof input.approvedSubmissionCount === 'number' ? input.approvedSubmissionCount : undefined,
    rejectedSubmissionCount: typeof input.rejectedSubmissionCount === 'number' ? input.rejectedSubmissionCount : undefined,
    approvalRate: typeof input.approvalRate === 'number' ? input.approvalRate : undefined,
    leaderboardRank: typeof input.leaderboardRank === 'number' ? input.leaderboardRank : undefined,
    totalPoints: typeof input.totalPoints === 'number' ? input.totalPoints : undefined,
    totalTipsReceived: typeof input.totalTipsReceived === 'string' ? input.totalTipsReceived : undefined,
    campaignHistory: normalizeCampaignHistory(input.campaignHistory),
    stats: input.stats && typeof input.stats === 'object' ? input.stats as Record<string, unknown> : undefined,
  };
}

export async function syncCkboostAgreementProfile(agreementId: string) {
  const agreement = await prisma.agreement.findUnique({
    where: { id: agreementId },
    include: {
      source: true,
      ckboostProfileSnapshot: true,
    },
  });

  if (!agreement?.source || !isCkboostSource(agreement.source)) {
    return null;
  }

  const latestEvent = await prisma.ckboostEvent.findFirst({
    where: {
      agreementId,
      payloadJson: {
        not: null,
      },
    },
    orderBy: {
      occurredAt: 'desc',
    },
  });

  if (!latestEvent?.payloadJson) {
    return agreement.ckboostProfileSnapshot;
  }

  let payload: Record<string, unknown> | null = null;
  try {
    payload = JSON.parse(latestEvent.payloadJson) as Record<string, unknown>;
  } catch {
    payload = null;
  }

  const profile = normalizeProfileInput(payload?.profile || payload?.contributorProfile || payload?.contributor);
  if (!profile) {
    return agreement.ckboostProfileSnapshot;
  }

  const snapshot = await upsertCkboostProfileSnapshot(agreementId, {
    ...profile,
    contributorExternalId:
      profile.contributorExternalId
      || agreement.ckboostProfileSnapshot?.contributorExternalId
      || undefined,
  });

  await createLog({
    agreementId,
    level: 'INFO',
    eventType: 'CKBOOST_PROFILE_SYNCED',
    message: 'CKBoost profile snapshot refreshed from the latest event payload.',
    metadata: {
      agreementId,
      ckboostProfileId: snapshot.ckboostProfileId,
      contributorExternalId: snapshot.contributorExternalId,
      walletAddress: snapshot.walletAddress,
    },
  });

  return snapshot;
}

export async function listCkboostSyncCandidates(limit = 25) {
  const agreements = await prisma.agreement.findMany({
    where: {
      source: {
        is: {
          sourceLabel: 'CKBoost',
        },
      },
    },
    include: {
      source: true,
      ckboostProfileSnapshot: true,
    },
    orderBy: {
      updatedAt: 'asc',
    },
    take: limit,
  });

  return agreements.filter((agreement) => isCkboostSource(agreement.source));
}

function buildCkboostSignature(payload: string) {
  if (!config.ckboostWebhookSecret) {
    return null;
  }

  return createHmac('sha256', config.ckboostWebhookSecret).update(payload).digest('hex');
}

export async function queueCkboostLifecycleEvent(params: {
  agreementId: string;
  internalEventType: 'proof_submitted' | 'milestone_approved' | 'milestone_paid';
  occurredAt: string;
  metadata?: Record<string, unknown>;
}) {
  if (!config.ckboostSyncEnabled || !config.ckboostWebhookUrl) {
    return null;
  }

  const agreement = await prisma.agreement.findUnique({
    where: { id: params.agreementId },
    include: {
      source: true,
      ckboostProfileSnapshot: true,
    },
  });

  if (!agreement?.source || !isCkboostSource(agreement.source)) {
    return null;
  }

  const sourceMetadata = parseSourceMetadata(agreement.source.externalMetadataJson);
  const payload = JSON.stringify({
    eventId: randomUUID(),
    eventType: params.internalEventType,
    occurredAt: params.occurredAt,
    agreement: {
      id: agreement.id,
      title: agreement.title,
      status: agreement.status,
      payoutNetwork: agreement.payoutNetwork,
      sourceReferenceId: agreement.source.sourceReferenceId,
      campaignUrl: agreement.source.externalUrl,
      sponsorName:
        (sourceMetadata?.sponsorName as string | undefined)
        || agreement.source.sponsorName
        || null,
    },
    ckboost: {
      provider: 'CKBOOST',
      campaignId: agreement.source.sourceReferenceId,
      contributorExternalId:
        (sourceMetadata?.contributorExternalId as string | undefined)
        || agreement.ckboostProfileSnapshot?.contributorExternalId
        || null,
      profileId:
        (sourceMetadata?.profileId as string | undefined)
        || agreement.ckboostProfileSnapshot?.ckboostProfileId
        || null,
      profileUrl:
        (sourceMetadata?.profileUrl as string | undefined)
        || agreement.ckboostProfileSnapshot?.profileUrl
        || null,
    },
    metadata: params.metadata || {},
  });

  const delivery = await prisma.ckboostNotificationDelivery.create({
    data: {
      id: randomUUID(),
      agreementId: params.agreementId,
      eventType: params.internalEventType,
      payloadJson: payload,
      status: 'PENDING',
      attempts: 0,
      nextRetryAt: new Date(),
    },
  });

  await enqueueJob({
    agreementId: params.agreementId,
    kind: 'DELIVER_CKBOOST_NOTIFICATION',
    payload: {
      agreementId: params.agreementId,
      ckboostNotificationId: delivery.id,
    },
  });

  return delivery;
}

export async function deliverCkboostNotificationDelivery(notificationId: string) {
  const delivery = await prisma.ckboostNotificationDelivery.findUnique({
    where: { id: notificationId },
    include: {
      agreement: {
        include: {
          source: true,
        },
      },
    },
  });

  if (!delivery) {
    throw new Error(`CKBoost notification delivery ${notificationId} not found.`);
  }

  if (!config.ckboostSyncEnabled || !config.ckboostWebhookUrl) {
    return prisma.ckboostNotificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'FAILED',
        attempts: delivery.attempts + 1,
        lastError: 'CKBoost outbound sync is not configured.',
      },
    });
  }

  const signature = buildCkboostSignature(delivery.payloadJson);
  try {
    const response = await fetch(config.ckboostWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(signature ? { 'x-ckboost-signature': signature } : {}),
      },
      body: delivery.payloadJson,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `CKBoost notification failed with status ${response.status}`);
    }

    return prisma.ckboostNotificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'DELIVERED',
        statusCode: response.status,
        attempts: delivery.attempts + 1,
        lastError: null,
        nextRetryAt: null,
        deliveredAt: new Date(),
      },
    });
  } catch (error) {
    const attempts = delivery.attempts + 1;
    const shouldRetry = attempts < config.webhookMaxAttempts;
    const nextRetryAt = shouldRetry ? new Date(Date.now() + getRetryDelayMs(attempts)) : null;
    const message = error instanceof Error ? error.message : 'CKBoost delivery failed';

    const updated = await prisma.ckboostNotificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: shouldRetry ? 'RETRY' : 'FAILED',
        attempts,
        statusCode: null,
        lastError: message,
        nextRetryAt,
      },
    });

    await createLog({
      agreementId: delivery.agreementId,
      level: shouldRetry ? 'WARN' : 'ERROR',
      eventType: shouldRetry ? 'CKBOOST_NOTIFICATION_RETRY' : 'CKBOOST_NOTIFICATION_FAILED',
      message: shouldRetry
        ? 'CKBoost lifecycle notification failed and will be retried.'
        : 'CKBoost lifecycle notification failed permanently.',
      metadata: {
        notificationId: delivery.id,
        eventType: delivery.eventType,
        attempts,
        nextRetryAt: nextRetryAt?.toISOString() || null,
        error: message,
      },
    });

    if (shouldRetry) {
      await enqueueJob({
        agreementId: delivery.agreementId,
        kind: 'DELIVER_CKBOOST_NOTIFICATION',
        payload: {
          agreementId: delivery.agreementId,
          ckboostNotificationId: delivery.id,
        },
        availableAt: nextRetryAt || new Date(),
      });
    }

    return updated;
  }
}

export async function notifyCkboostLifecycleEvent(params: {
  agreementId: string;
  internalEventType: 'proof_submitted' | 'milestone_approved' | 'milestone_paid';
  occurredAt: string;
  metadata?: Record<string, unknown>;
}) {
  const delivery = await queueCkboostLifecycleEvent(params);
  return Boolean(delivery);
}
