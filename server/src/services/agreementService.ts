import { createHash } from 'crypto';
import { v4 as uuid } from 'uuid';
import { prisma } from '../db';
import { broadcast } from '../ws';
import { sendTreasuryTransfer } from './ckbService';
import { createLog } from './logService';

const AGREEMENT_VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['FUNDED', 'EXPIRED'],
  FUNDED: ['PROOF_SUBMITTED', 'DISPUTED', 'EXPIRED', 'REFUNDED'],
  PROOF_SUBMITTED: ['UNDER_REVIEW', 'DISPUTED', 'EXPIRED'],
  UNDER_REVIEW: ['APPROVED', 'DISPUTED', 'EXPIRED', 'REFUNDED'],
  APPROVED: ['FUNDED', 'PAID'],
  PAID: [],
  DISPUTED: ['APPROVED', 'REFUNDED'],
  REFUNDED: [],
  EXPIRED: ['REFUNDED'],
};

const MILESTONE_VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['ACTIVE'],
  ACTIVE: ['PROOF_SUBMITTED', 'DISPUTED', 'EXPIRED', 'REFUNDED'],
  PROOF_SUBMITTED: ['UNDER_REVIEW', 'DISPUTED', 'EXPIRED'],
  UNDER_REVIEW: ['APPROVED', 'DISPUTED', 'EXPIRED', 'REFUNDED'],
  APPROVED: ['PAID'],
  PAID: [],
  DISPUTED: ['APPROVED', 'REFUNDED'],
  REFUNDED: [],
  EXPIRED: [],
};

const TERMINAL_MILESTONE_STATUSES = new Set(['PAID', 'REFUNDED', 'EXPIRED']);

const agreementListInclude = {
  milestones: {
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      sortOrder: true,
      status: true,
    },
  },
} as const;

const agreementDetailInclude = {
  milestones: {
    orderBy: { sortOrder: 'asc' },
    include: {
      proofs: { orderBy: { submittedAt: 'desc' } },
      disputes: {
        orderBy: { createdAt: 'desc' },
      },
    },
  },
  disputes: {
    orderBy: { createdAt: 'desc' },
    include: {
      evidenceEntries: { orderBy: { createdAt: 'asc' } },
    },
  },
} as const;

function canTransitionAgreement(from: string, to: string): boolean {
  return AGREEMENT_VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

function canTransitionMilestone(from: string, to: string): boolean {
  return MILESTONE_VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

function milestoneFallbackStatus(agreementStatus: string): string {
  switch (agreementStatus) {
    case 'DRAFT':
      return 'PENDING';
    case 'FUNDED':
      return 'ACTIVE';
    case 'PROOF_SUBMITTED':
      return 'PROOF_SUBMITTED';
    case 'UNDER_REVIEW':
      return 'UNDER_REVIEW';
    case 'APPROVED':
      return 'APPROVED';
    case 'PAID':
      return 'PAID';
    case 'DISPUTED':
      return 'DISPUTED';
    case 'REFUNDED':
      return 'REFUNDED';
    case 'EXPIRED':
      return 'EXPIRED';
    default:
      return 'PENDING';
  }
}

function serializeAgreementForBroadcast(agreement: {
  id: string;
  title: string;
  description: string;
  clientAddress: string;
  workerAddress: string;
  workerFiberPubkey: string | null;
  amount: string;
  deadlineAt: Date;
  disputeWindowSecs: number;
  proofType: string;
  reviewerMode: string;
  releaseMode: string;
  payoutNetwork: string;
  ckbTxHashCreate: string | null;
  ckbTxHashFund: string | null;
  ckbTxHashRelease: string | null;
  fiberPaymentReference: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...agreement,
    deadlineAt: agreement.deadlineAt.toISOString(),
    createdAt: agreement.createdAt.toISOString(),
    updatedAt: agreement.updatedAt.toISOString(),
  };
}

export async function broadcastAgreementUpdateById(agreementId: string) {
  const agreement = await prisma.agreement.findUnique({
    where: { id: agreementId },
  });

  if (!agreement) {
    return null;
  }

  broadcast({
    type: 'AGREEMENT_UPDATE',
    payload: serializeAgreementForBroadcast(agreement),
  });

  return agreement;
}

async function fetchAgreementOrThrow(agreementId: string) {
  const agreement = await prisma.agreement.findUnique({
    where: { id: agreementId },
    include: agreementDetailInclude,
  });

  if (!agreement) {
    throw new Error(`Agreement ${agreementId} not found`);
  }

  return agreement;
}

async function ensureAgreementMilestones<T extends { id: string; title: string; description: string; amount: string; status: string; milestones: any[] }>(
  agreement: T
): Promise<T | Awaited<ReturnType<typeof fetchAgreementOrThrow>>> {
  if (agreement.milestones.length > 0) {
    return agreement;
  }

  await prisma.milestone.create({
    data: {
      id: uuid(),
      agreementId: agreement.id,
      title: 'Milestone 1',
      description: agreement.description || agreement.title,
      amount: agreement.amount,
      sortOrder: 1,
      status: milestoneFallbackStatus(agreement.status),
    },
  });

  return fetchAgreementOrThrow(agreement.id);
}

function getCurrentMilestoneFromAgreement(agreement: { milestones: any[] }) {
  const activeStatuses = ['ACTIVE', 'PROOF_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'DISPUTED'];
  return (
    agreement.milestones.find((milestone) => activeStatuses.includes(milestone.status)) ??
    agreement.milestones.find((milestone) => milestone.status === 'PENDING') ??
    null
  );
}

async function resolveOpenMilestoneDisputes(milestoneId: string) {
  await prisma.dispute.updateMany({
    where: { milestoneId, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
}

export async function recordSettlementReference(
  agreementId: string,
  data: { ckbTxHashRelease?: string | null; fiberPaymentReference?: string | null }
) {
  const updated = await prisma.agreement.update({
    where: { id: agreementId },
    data: {
      ...(data.ckbTxHashRelease !== undefined ? { ckbTxHashRelease: data.ckbTxHashRelease } : {}),
      ...(data.fiberPaymentReference !== undefined ? { fiberPaymentReference: data.fiberPaymentReference } : {}),
    },
  });

  broadcast({
    type: 'AGREEMENT_UPDATE',
    payload: serializeAgreementForBroadcast(updated),
  });

  return updated;
}

export async function transitionStatus(agreementId: string, newStatus: string) {
  const agreement = await prisma.agreement.findUnique({ where: { id: agreementId } });
  if (!agreement) {
    throw new Error(`Agreement ${agreementId} not found`);
  }

  if (agreement.status === newStatus) {
    return agreement;
  }

  if (!canTransitionAgreement(agreement.status, newStatus)) {
    throw new Error(`Invalid transition: ${agreement.status} -> ${newStatus}`);
  }

  const updated = await prisma.agreement.update({
    where: { id: agreementId },
    data: { status: newStatus },
  });

  broadcast({
    type: 'AGREEMENT_UPDATE',
    payload: serializeAgreementForBroadcast(updated),
  });

  return updated;
}

export async function transitionMilestoneStatus(milestoneId: string, newStatus: string) {
  const milestone = await prisma.milestone.findUnique({ where: { id: milestoneId } });
  if (!milestone) {
    throw new Error(`Milestone ${milestoneId} not found`);
  }

  if (milestone.status === newStatus) {
    return milestone;
  }

  if (!canTransitionMilestone(milestone.status, newStatus)) {
    throw new Error(`Invalid milestone transition: ${milestone.status} -> ${newStatus}`);
  }

  return prisma.milestone.update({
    where: { id: milestoneId },
    data: { status: newStatus },
  });
}

export async function activateNextMilestone(agreementId: string) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(agreementId));
  const currentMilestone = agreement.milestones.find((milestone) =>
    ['ACTIVE', 'PROOF_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'DISPUTED'].includes(milestone.status)
  );
  if (currentMilestone) {
    return currentMilestone;
  }

  const nextMilestone = agreement.milestones.find((milestone) => milestone.status === 'PENDING');
  if (!nextMilestone) {
    return null;
  }

  const activated = await transitionMilestoneStatus(nextMilestone.id, 'ACTIVE');

  await createLog({
    agreementId,
    level: 'INFO',
    eventType: 'MILESTONE_ACTIVATED',
    message: `Milestone ${activated.sortOrder} is now active: ${activated.title}`,
    metadata: {
      milestoneId: activated.id,
      milestoneTitle: activated.title,
      milestoneAmount: activated.amount,
      sortOrder: activated.sortOrder,
    },
  });

  return activated;
}

export async function createAgreement(data: {
  title: string;
  description: string;
  clientAddress: string;
  workerAddress: string;
  workerFiberPubkey?: string;
  deadlineAt: string;
  disputeWindowSecs: number;
  proofType: string;
  reviewerMode: string;
  releaseMode: string;
  payoutNetwork: string;
  milestones: Array<{
    title: string;
    description: string;
    amount: string;
  }>;
}) {
  if (!data.milestones.length) {
    throw new Error('At least one milestone is required');
  }

  const totalAmount = data.milestones.reduce((sum, milestone) => sum + BigInt(milestone.amount), BigInt(0)).toString();

  const agreement = await prisma.agreement.create({
    data: {
      id: uuid(),
      title: data.title,
      description: data.description,
      clientAddress: data.clientAddress,
      workerAddress: data.workerAddress,
      workerFiberPubkey: data.workerFiberPubkey || null,
      amount: totalAmount,
      deadlineAt: new Date(data.deadlineAt),
      disputeWindowSecs: data.disputeWindowSecs,
      proofType: data.proofType,
      reviewerMode: data.reviewerMode,
      releaseMode: data.releaseMode,
      payoutNetwork: data.payoutNetwork,
      status: 'DRAFT',
      milestones: {
        create: data.milestones.map((milestone, index) => ({
          id: uuid(),
          title: milestone.title,
          description: milestone.description,
          amount: milestone.amount,
          sortOrder: index + 1,
          status: 'PENDING',
        })),
      },
    },
    include: {
      milestones: {
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  await createLog({
    agreementId: agreement.id,
    level: 'INFO',
    eventType: 'AGREEMENT_CREATED',
    message: `Agreement "${agreement.title}" created by ${agreement.clientAddress}`,
    metadata: {
      title: agreement.title,
      amount: agreement.amount,
      workerAddress: agreement.workerAddress,
      workerFiberPubkey: agreement.workerFiberPubkey,
      milestoneCount: agreement.milestones.length,
    },
  });

  return agreement;
}

export async function fundAgreement(agreementId: string, txHash: string) {
  await prisma.agreement.update({
    where: { id: agreementId },
    data: { ckbTxHashFund: txHash },
  });

  await createLog({
    agreementId,
    level: 'INFO',
    eventType: 'FUNDING_PENDING',
    message: `Funding transaction submitted: ${txHash}`,
    metadata: { txHash },
  });

  await transitionStatus(agreementId, 'FUNDED');
  const activeMilestone = await activateNextMilestone(agreementId);

  await createLog({
    agreementId,
    level: 'SUCCESS',
    eventType: 'FUNDING_CONFIRMED',
    message: 'Agreement funded successfully on CKB',
    metadata: {
      txHash,
      status: 'FUNDED',
      activeMilestoneId: activeMilestone?.id ?? null,
      activeMilestoneTitle: activeMilestone?.title ?? null,
    },
  });

  return getAgreementById(agreementId);
}

export async function submitProof(
  agreementId: string,
  milestoneId: string,
  proofType: string,
  content: string,
  contentHash?: string
) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(agreementId));
  const milestone = agreement.milestones.find((item) => item.id === milestoneId);

  if (!milestone) {
    throw new Error('Milestone not found');
  }

  if (milestone.status !== 'ACTIVE') {
    throw new Error('Proof can only be submitted for the active milestone');
  }

  const hash = contentHash || createHash('sha256').update(content).digest('hex');

  const proof = await prisma.proof.create({
    data: {
      id: uuid(),
      agreementId,
      milestoneId,
      proofType,
      content,
      contentHash: hash,
    },
  });

  await transitionMilestoneStatus(milestoneId, 'PROOF_SUBMITTED');
  await transitionStatus(agreementId, 'PROOF_SUBMITTED');

  await createLog({
    agreementId,
    level: 'INFO',
    eventType: 'PROOF_SUBMITTED',
    message: `Proof submitted for milestone ${milestone.sortOrder}: ${milestone.title}`,
    metadata: {
      milestoneId,
      milestoneTitle: milestone.title,
      proofId: proof.id,
      proofType,
      contentHash: hash,
    },
  });

  return {
    proof,
    agreement: await getAgreementById(agreementId),
  };
}

export async function openDispute(
  agreementId: string,
  milestoneId: string,
  openedBy: string,
  reason: string,
  evidenceNotes?: string
) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(agreementId));
  const milestone = agreement.milestones.find((item) => item.id === milestoneId);

  if (!milestone) {
    throw new Error('Milestone not found');
  }

  const dispute = await prisma.dispute.create({
    data: {
      id: uuid(),
      agreementId,
      milestoneId,
      openedBy,
      reason,
      evidenceNotes: evidenceNotes || null,
    },
  });

  await transitionMilestoneStatus(milestoneId, 'DISPUTED');
  await transitionStatus(agreementId, 'DISPUTED');

  await createLog({
    agreementId,
    level: 'WARN',
    eventType: 'DISPUTE_OPENED',
    message: `Dispute opened on milestone ${milestone.sortOrder} by ${openedBy}: ${reason}`,
    metadata: {
      disputeId: dispute.id,
      milestoneId,
      milestoneTitle: milestone.title,
      openedBy,
      reason,
    },
  });

  return {
    dispute,
    agreement: await getAgreementById(agreementId),
  };
}

export async function addDisputeEvidence(
  agreementId: string,
  disputeId: string,
  submittedBy: string,
  content: string
) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(agreementId));
  const dispute = agreement.disputes.find((item) => item.id === disputeId);

  if (!dispute) {
    throw new Error('Dispute not found');
  }

  if (dispute.resolvedAt) {
    throw new Error('Cannot add evidence to a resolved dispute');
  }

  const evidence = await prisma.disputeEvidence.create({
    data: {
      id: uuid(),
      disputeId,
      submittedBy,
      content,
    },
  });

  await prisma.dispute.update({
    where: { id: disputeId },
    data: {
      aiSummary: null,
      aiRecommendation: null,
      aiConfidence: null,
      aiRationale: null,
    },
  });

  await createLog({
    agreementId,
    level: 'INFO',
    eventType: 'DISPUTE_OPENED',
    message: `Additional dispute context submitted by ${submittedBy}`,
    metadata: {
      disputeId,
      evidenceId: evidence.id,
      submittedBy,
    },
  });

  await broadcastAgreementUpdateById(agreementId);

  return {
    evidence,
    agreement: await getAgreementById(agreementId),
  };
}

export async function approveCurrentMilestone(agreementId: string) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(agreementId));
  const milestone = getCurrentMilestoneFromAgreement(agreement);

  if (!milestone) {
    throw new Error('No active milestone available to approve');
  }

  if (!['UNDER_REVIEW', 'DISPUTED'].includes(milestone.status)) {
    throw new Error('Current milestone is not ready for approval');
  }

  await resolveOpenMilestoneDisputes(milestone.id);
  await transitionMilestoneStatus(milestone.id, 'APPROVED');
  await transitionStatus(agreementId, 'APPROVED');

  return getAgreementById(agreementId);
}

export async function refundCurrentMilestone(agreementId: string) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(agreementId));
  const milestone = getCurrentMilestoneFromAgreement(agreement);

  if (!milestone) {
    throw new Error('No active milestone available to refund');
  }

  if (!['ACTIVE', 'UNDER_REVIEW', 'DISPUTED', 'PROOF_SUBMITTED'].includes(milestone.status)) {
    throw new Error('Current milestone cannot be refunded');
  }

  await resolveOpenMilestoneDisputes(milestone.id);
  await transitionMilestoneStatus(milestone.id, 'REFUNDED');
  const refundTxHash = await sendTreasuryTransfer(agreement.clientAddress, milestone.amount);
  await recordSettlementReference(agreementId, { ckbTxHashRelease: refundTxHash, fiberPaymentReference: null });

  if (agreement.status !== 'REFUNDED') {
    await transitionStatus(agreementId, 'REFUNDED');
  }

  await createLog({
    agreementId,
    level: 'SUCCESS',
    eventType: 'REFUND_SENT',
    message: `Refund sent for milestone ${milestone.sortOrder}: ${milestone.title}`,
    metadata: {
      milestoneId: milestone.id,
      milestoneTitle: milestone.title,
      txHash: refundTxHash,
      amount: milestone.amount,
    },
  });

  return getAgreementById(agreementId);
}

export async function completeApprovedMilestone(agreementId: string) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(agreementId));
  const milestone = agreement.milestones.find((item) => item.status === 'APPROVED');

  if (!milestone) {
    if (['FUNDED', 'PAID'].includes(agreement.status)) {
      return agreement;
    }

    throw new Error('No approved milestone available for settlement');
  }

  await transitionMilestoneStatus(milestone.id, 'PAID');

  const remainingMilestones = agreement.milestones.filter((item) => item.sortOrder > milestone.sortOrder);
  const nextPendingMilestone = remainingMilestones.find((item) => item.status === 'PENDING');

  if (nextPendingMilestone) {
    await transitionStatus(agreementId, 'FUNDED');
    await transitionMilestoneStatus(nextPendingMilestone.id, 'ACTIVE');

    await createLog({
      agreementId,
      level: 'INFO',
      eventType: 'MILESTONE_ACTIVATED',
      message: `Milestone ${nextPendingMilestone.sortOrder} is now active: ${nextPendingMilestone.title}`,
      metadata: {
        milestoneId: nextPendingMilestone.id,
        milestoneTitle: nextPendingMilestone.title,
        milestoneAmount: nextPendingMilestone.amount,
        sortOrder: nextPendingMilestone.sortOrder,
      },
    });
  } else {
    await transitionStatus(agreementId, 'PAID');
  }

  return getAgreementById(agreementId);
}

export async function getAgreements(address?: string) {
  const agreements = await prisma.agreement.findMany({
    where: address
      ? {
          OR: [{ clientAddress: address }, { workerAddress: address }],
        }
      : undefined,
    orderBy: { createdAt: 'desc' },
    include: agreementListInclude,
  });

  return Promise.all(agreements.map((agreement) => ensureAgreementMilestones(agreement)));
}

export async function getAgreementById(id: string) {
  const agreement = await prisma.agreement.findUnique({
    where: { id },
    include: agreementDetailInclude,
  });

  if (!agreement) {
    return null;
  }

  return ensureAgreementMilestones(agreement);
}

export async function getAgreementParticipantById(id: string) {
  return prisma.agreement.findUnique({
    where: { id },
    select: {
      id: true,
      clientAddress: true,
      workerAddress: true,
    },
  });
}
