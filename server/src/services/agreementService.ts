import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { broadcast } from '../ws';
import {
  findSpendingTransactionForOutPoint,
  getTreasuryAddress,
  inspectTransactionOutputsToAddress,
  sendTreasuryTransfer,
  verifyFundingTransaction,
} from './ckbService';
import {
  buildAgreementDigest,
  buildMilestoneDigest,
  buildSingleMilestoneDigest,
} from './commitmentService';
import { createAuditLog } from './auditLogService';
import { createLog } from './logService';
import {
  buildOnchainEscrowDescriptor,
  getOnchainEscrowOccupiedCapacity,
  isOnchainEscrowReady,
} from './onchainEscrowService';
import {
  parseProofBundle,
  type ArtifactInput,
  type DisputeResolutionChoice,
  computeContentHash,
  parseDisputeEvidenceBundle,
  serializeDisputeEvidenceBundle,
  serializeProofBundle,
} from './richPayloadService';
import { refreshReputationForAgreement } from './reputationService';
import { convertUsdToCkb, fetchCkbPriceQuote, parseUsdAmount } from './marketPriceService';
import { ensureLegacyApp } from './legacyTenantService';
import { MAX_SHANNONS } from '../common/amounts/integer-amount';

const uuid = randomUUID;

const AGREEMENT_VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['FUNDED', 'EXPIRED', 'CANCELLED'],
  CANCELLED: [],
  FUNDED: ['PROOF_SUBMITTED', 'DISPUTED', 'EXPIRED', 'REFUNDED'],
  PROOF_SUBMITTED: ['PROOF_SUBMITTED', 'UNDER_REVIEW', 'DISPUTED', 'EXPIRED'],
  UNDER_REVIEW: ['APPROVED', 'DISPUTED', 'EXPIRED', 'REFUNDED'],
  APPROVED: ['FUNDED', 'PAID'],
  PAID: [],
  DISPUTED: ['APPROVED', 'REFUNDED'],
  REFUNDED: [],
  EXPIRED: [ 'REFUNDED'],
};

const MILESTONE_VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['ACTIVE', 'CANCELLED'],
  CANCELLED: [],
  ACTIVE: ['PROOF_SUBMITTED', 'DISPUTED', 'EXPIRED', 'REFUNDED'],
  PROOF_SUBMITTED: ['PROOF_SUBMITTED', 'UNDER_REVIEW', 'DISPUTED', 'EXPIRED'],
  UNDER_REVIEW: ['APPROVED', 'DISPUTED', 'EXPIRED', 'REFUNDED'],
  APPROVED: ['PAID'],
  PAID: [],
  DISPUTED: ['APPROVED', 'REFUNDED'],
  REFUNDED: [],
  EXPIRED: [],
};

function formatShannonsAsCkb(value: bigint) {
  const base = BigInt(10 ** 8);
  const whole = value / base;
  const fraction = value % base;
  if (fraction === BigInt(0)) {
    return whole.toString();
  }
  return `${whole}.${fraction.toString().padStart(8, '0').replace(/0+$/, '')}`;
}

const agreementListInclude = {
  milestones: {
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      title: true,
      description: true,
      amount: true,
      sortOrder: true,
      status: true,
    },
  },
  settlements: {
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
  comments: {
    orderBy: { createdAt: 'desc' },
    take: 3,
  },
  amendments: {
    orderBy: { createdAt: 'desc' },
    take: 2,
  },
  source: true,
} as const;

const agreementDetailInclude = {
  milestones: {
    orderBy: { sortOrder: 'asc' },
    include: {
      proofs: { orderBy: { submittedAt: 'desc' } },
      disputes: {
        orderBy: { createdAt: 'desc' },
      },
      settlements: {
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
  settlements: {
    orderBy: { createdAt: 'desc' },
  },
  comments: {
    orderBy: { createdAt: 'asc' },
  },
  amendments: {
    orderBy: { createdAt: 'desc' },
  },
  source: true,
  proofChecks: {
    orderBy: { createdAt: 'desc' },
    take: 20,
  },
  infoRequests: {
    orderBy: { createdAt: 'desc' },
    take: 50,
  },
  jobs: {
    orderBy: { createdAt: 'desc' },
    take: 40,
  },
} as const;

type SettlementDirection = 'FUNDING' | 'PAYOUT' | 'REFUND';
type SettlementNetwork = 'CKB' | 'FIBER' | 'INTERNAL';
type SettlementRecordStatus = 'PENDING' | 'CONFIRMED' | 'FAILED';
const REFUND_SETTLEMENT_ACTIONS = ['REFUND_PROPOSED', 'REFUND_APPROVED'] as const;
const SPLIT_SETTLEMENT_ACTIONS = ['SPLIT_PROPOSED', 'SPLIT_APPROVED'] as const;

type RefundSettlementAction = (typeof REFUND_SETTLEMENT_ACTIONS)[number];
type SplitSettlementAction = (typeof SPLIT_SETTLEMENT_ACTIONS)[number];

type RefundConsensusState = {
  proposedBy: string | null;
  proposedAt: string | null;
  clientApprovedAt: string | null;
  workerApprovedAt: string | null;
  fullyApproved: boolean;
  awaitingAddress: string | null;
};

type SplitConsensusState = {
  proposedBy: string | null;
  proposedAt: string | null;
  clientApprovedAt: string | null;
  workerApprovedAt: string | null;
  workerAmount: string | null;
  clientRefundAmount: string | null;
  fullyApproved: boolean;
  awaitingAddress: string | null;
};

type ImportedSourceMetadataMilestone = {
  index?: number;
  title?: string | null;
  kind?: string | null;
  budgetAmountUsd?: string | null;
  budgetPercent?: string | null;
};

type ImportedSourceMetadata = {
  parser?: string | null;
  milestones?: ImportedSourceMetadataMilestone[] | null;
  upfrontPayment?: {
    percentage?: string | null;
    amountUsd?: string | null;
    label?: string | null;
    amountShannons?: string | null;
  } | null;
};

const IMPORTED_GRANT_RESERVE_BUFFER_MULTIPLIER = 1.2;

function canTransitionAgreement(from: string, to: string): boolean {
  return AGREEMENT_VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

function canTransitionMilestone(from: string, to: string): boolean {
  return MILESTONE_VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

function milestoneFallbackStatus(agreementStatus: string): string {
  switch (agreementStatus) {
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
  arbitratorAddress: string | null;
  workerFiberPubkey: string | null;
  amount: string;
  deadlineAt: Date;
  disputeWindowSecs: number;
  proofType: string;
  reviewerMode: string;
  releaseMode: string;
  payoutNetwork: string;
  escrowModel: string;
  escrowAddress: string | null;
  escrowLockCodeHash: string | null;
  escrowLockHashType: string | null;
  escrowLockArgs: string | null;
  agreementDigest: string | null;
  milestoneDigest: string | null;
  settlementStatus: string;
  fundingConfirmedAt: Date | null;
  lastSettlementError: string | null;
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
    fundingConfirmedAt: agreement.fundingConfirmedAt?.toISOString() ?? null,
    createdAt: agreement.createdAt.toISOString(),
    updatedAt: agreement.updatedAt.toISOString(),
  };
}

function toJsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, nestedValue) =>
      typeof nestedValue === 'bigint' ? nestedValue.toString() : nestedValue
    )
  ) as T;
}

function pendingSettlementStatus(direction: SettlementDirection) {
  switch (direction) {
    case 'FUNDING':
      return 'FUNDING_PENDING';
    case 'PAYOUT':
      return 'PAYOUT_PENDING';
    case 'REFUND':
      return 'REFUND_PENDING';
  }
}

function confirmedSettlementStatus(direction: SettlementDirection) {
  switch (direction) {
    case 'FUNDING':
      return 'FUNDED';
    case 'PAYOUT':
      return 'PAYOUT_CONFIRMED';
    case 'REFUND':
      return 'REFUND_CONFIRMED';
  }
}

function payoutNetworkFromSettlement(network: SettlementNetwork) {
  return network === 'FIBER' ? 'FIBER' : 'CKB';
}

function normalizeHex(value: string | null | undefined) {
  return (value || '').toLowerCase();
}

function normalizeAddress(address: string) {
  return address.trim().toLowerCase();
}

function emptyRefundConsensusState(): RefundConsensusState {
  return {
    proposedBy: null,
    proposedAt: null,
    clientApprovedAt: null,
    workerApprovedAt: null,
    fullyApproved: false,
    awaitingAddress: null,
  };
}

function emptySplitConsensusState(): SplitConsensusState {
  return {
    proposedBy: null,
    proposedAt: null,
    clientApprovedAt: null,
    workerApprovedAt: null,
    workerAmount: null,
    clientRefundAmount: null,
    fullyApproved: false,
    awaitingAddress: null,
  };
}

function safeParseMetadata(value?: string | null) {
  if (!value) {
    return {} as Record<string, unknown>;
  }

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
}

export function buildRefundConsensusState(params: {
  events: Array<{
    action: RefundSettlementAction;
    actorAddress: string | null;
    createdAt: Date | string;
  }>;
  clientAddress: string;
  workerAddress: string;
}): RefundConsensusState {
  const state = emptyRefundConsensusState();

  for (const event of params.events) {
    if (!event.actorAddress) {
      continue;
    }

    const createdAtIso = new Date(event.createdAt).toISOString();
    const isClient = event.actorAddress === params.clientAddress;
    const isWorker = event.actorAddress === params.workerAddress;

    if (!isClient && !isWorker) {
      continue;
    }

    if (event.action === 'REFUND_PROPOSED' && !state.proposedBy) {
      state.proposedBy = event.actorAddress;
      state.proposedAt = createdAtIso;
    }

    if (isClient && !state.clientApprovedAt) {
      state.clientApprovedAt = createdAtIso;
    }

    if (isWorker && !state.workerApprovedAt) {
      state.workerApprovedAt = createdAtIso;
    }
  }

  state.fullyApproved = Boolean(state.clientApprovedAt && state.workerApprovedAt);
  state.awaitingAddress = state.proposedBy
    ? !state.clientApprovedAt
      ? params.clientAddress
      : !state.workerApprovedAt
        ? params.workerAddress
        : null
    : null;

  return state;
}

export function buildSplitConsensusState(params: {
  events: Array<{
    action: SplitSettlementAction;
    actorAddress: string | null;
    createdAt: Date | string;
    metadataJson?: string | null;
  }>;
  clientAddress: string;
  workerAddress: string;
  milestoneAmount: string;
}): SplitConsensusState {
  const state = emptySplitConsensusState();

  for (const event of params.events) {
    if (!event.actorAddress) {
      continue;
    }

    const createdAtIso = new Date(event.createdAt).toISOString();
    const isClient = event.actorAddress === params.clientAddress;
    const isWorker = event.actorAddress === params.workerAddress;
    if (!isClient && !isWorker) {
      continue;
    }

    const metadata = safeParseMetadata(event.metadataJson);
    const workerAmount = typeof metadata.workerAmount === 'string' ? metadata.workerAmount : null;
    const clientRefundAmount = typeof metadata.clientRefundAmount === 'string' ? metadata.clientRefundAmount : null;

    if (event.action === 'SPLIT_PROPOSED' && !state.proposedBy) {
      state.proposedBy = event.actorAddress;
      state.proposedAt = createdAtIso;
      state.workerAmount = workerAmount;
      state.clientRefundAmount = clientRefundAmount;
    }

    if (isClient && !state.clientApprovedAt) {
      state.clientApprovedAt = createdAtIso;
    }

    if (isWorker && !state.workerApprovedAt) {
      state.workerApprovedAt = createdAtIso;
    }

    if (!state.workerAmount && workerAmount) {
      state.workerAmount = workerAmount;
    }

    if (!state.clientRefundAmount && clientRefundAmount) {
      state.clientRefundAmount = clientRefundAmount;
    }
  }

  state.fullyApproved = Boolean(state.clientApprovedAt && state.workerApprovedAt);
  state.awaitingAddress = state.proposedBy
    ? !state.clientApprovedAt
      ? params.clientAddress
      : !state.workerApprovedAt
        ? params.workerAddress
        : null
    : null;

  if (!state.clientRefundAmount && state.workerAmount) {
    state.clientRefundAmount = (BigInt(params.milestoneAmount) - BigInt(state.workerAmount)).toString();
  }

  return state;
}

async function buildRefundConsensusForDispute(
  agreementId: string,
  disputeId: string,
  clientAddress: string,
  workerAddress: string
) {
  const events = await prisma.auditLog.findMany({
    where: {
      agreementId,
      resourceType: 'DISPUTE',
      resourceId: disputeId,
      action: { in: [...REFUND_SETTLEMENT_ACTIONS] },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      action: true,
      actorAddress: true,
      createdAt: true,
    },
  });

  return buildRefundConsensusState({
    events: events as Array<{
      action: RefundSettlementAction;
      actorAddress: string | null;
      createdAt: Date;
    }>,
    clientAddress,
    workerAddress,
  });
}

async function buildSplitConsensusForDispute(
  agreementId: string,
  disputeId: string,
  clientAddress: string,
  workerAddress: string,
  milestoneAmount: string
) {
  const events = await prisma.auditLog.findMany({
    where: {
      agreementId,
      resourceType: 'DISPUTE',
      resourceId: disputeId,
      action: { in: [...SPLIT_SETTLEMENT_ACTIONS] },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      action: true,
      actorAddress: true,
      createdAt: true,
      metadataJson: true,
    },
  });

  return buildSplitConsensusState({
    events: events as Array<{
      action: SplitSettlementAction;
      actorAddress: string | null;
      createdAt: Date;
      metadataJson?: string | null;
    }>,
    clientAddress,
    workerAddress,
    milestoneAmount,
  });
}

function validateSplitWorkerAmount(workerAmount: string, milestoneAmount: string) {
  if (!/^[1-9]\d*$/.test(workerAmount)) {
    throw new Error('Split settlement worker amount must be a positive integer string.');
  }

  const workerAmountValue = BigInt(workerAmount);
  const milestoneAmountValue = BigInt(milestoneAmount);

  if (workerAmountValue <= BigInt(0) || workerAmountValue >= milestoneAmountValue) {
    throw new Error('Split settlement worker amount must be greater than zero and less than the milestone amount.');
  }

  return {
    workerAmountValue,
    milestoneAmountValue,
    clientRefundAmount: (milestoneAmountValue - workerAmountValue).toString(),
  };
}

export function getBlockingDisputeSettlementProposal(params: {
  dispute: {
    id: string;
    refundConsensus?: RefundConsensusState | null;
    splitConsensus?: SplitConsensusState | null;
  } | null | undefined;
}) {
  const refundConsensus = params.dispute?.refundConsensus || null;
  if (refundConsensus?.proposedBy && !refundConsensus.fullyApproved) {
    return {
      type: 'REFUND' as const,
      disputeId: params.dispute?.id || null,
      awaitingAddress: refundConsensus.awaitingAddress,
    };
  }

  const splitConsensus = params.dispute?.splitConsensus || null;
  if (splitConsensus?.proposedBy && !splitConsensus.fullyApproved) {
    return {
      type: 'SPLIT' as const,
      disputeId: params.dispute?.id || null,
      awaitingAddress: splitConsensus.awaitingAddress,
      workerAmount: splitConsensus.workerAmount,
      clientRefundAmount: splitConsensus.clientRefundAmount,
    };
  }

  return null;
}

export function getAllowedDisputeResolutionChoices(params: {
  actorAddress: string;
  clientAddress: string;
  workerAddress: string;
}) {
  const actorAddress = normalizeAddress(params.actorAddress);
  const clientAddress = normalizeAddress(params.clientAddress);
  const workerAddress = normalizeAddress(params.workerAddress);

  if (actorAddress === clientAddress) {
    return ['REFUND', 'SPLIT'] as const;
  }

  if (actorAddress === workerAddress) {
    return ['PAYOUT', 'SPLIT'] as const;
  }

  return [] as const;
}

async function decorateAgreementWithRefundConsensus<
  T extends {
    id: string;
    amount: string;
    clientAddress: string;
    workerAddress: string;
    disputeWindowSecs: number;
    status: string;
    settlementStatus: string;
    disputes?: Array<any>;
    milestones?: Array<any>;
  }
>(agreement: T): Promise<any> {
  if (!agreement.disputes?.length) {
    const workflow = deriveAgreementWorkflowState(agreement as any);
    return {
      ...agreement,
      workflowStage: workflow.workflowStage,
      nextParticipantAction: workflow.nextParticipantAction,
      milestones: agreement.milestones?.map((milestone: any) => ({
        ...milestone,
        revisionCount: milestone.proofs?.length || 0,
      })),
    };
  }

  const disputeIds = agreement.disputes.map((dispute) => dispute.id);
  const auditEvents = await prisma.auditLog.findMany({
    where: {
      agreementId: agreement.id,
      resourceType: 'DISPUTE',
      resourceId: { in: disputeIds },
      action: { in: [...REFUND_SETTLEMENT_ACTIONS, ...SPLIT_SETTLEMENT_ACTIONS] },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      resourceId: true,
      action: true,
      actorAddress: true,
      createdAt: true,
      metadataJson: true,
    },
  });

  const eventsByDisputeId = new Map<string, Array<{
    action: RefundSettlementAction | SplitSettlementAction;
    actorAddress: string | null;
    createdAt: Date;
    metadataJson?: string | null;
  }>>();

  for (const disputeId of disputeIds) {
    eventsByDisputeId.set(disputeId, []);
  }

  for (const event of auditEvents) {
    const existing = eventsByDisputeId.get(event.resourceId);
    if (!existing) {
      continue;
    }

    existing.push({
      action: event.action as RefundSettlementAction | SplitSettlementAction,
      actorAddress: event.actorAddress,
      createdAt: event.createdAt,
      metadataJson: event.metadataJson,
    });
  }

  const refundConsensusByDisputeId = new Map<string, RefundConsensusState>();
  const splitConsensusByDisputeId = new Map<string, SplitConsensusState>();
  for (const disputeId of disputeIds) {
    const milestone = agreement.milestones?.find((item: any) =>
      item.disputes?.some((dispute: any) => dispute.id === disputeId)
    );
    refundConsensusByDisputeId.set(
      disputeId,
      buildRefundConsensusState({
        events: (eventsByDisputeId.get(disputeId) || []).filter((event) =>
          REFUND_SETTLEMENT_ACTIONS.includes(event.action as RefundSettlementAction)
        ) as Array<{
          action: RefundSettlementAction;
          actorAddress: string | null;
          createdAt: Date;
        }>,
        clientAddress: agreement.clientAddress,
        workerAddress: agreement.workerAddress,
      })
    );
    splitConsensusByDisputeId.set(
      disputeId,
      buildSplitConsensusState({
        events: (eventsByDisputeId.get(disputeId) || []).filter((event) =>
          SPLIT_SETTLEMENT_ACTIONS.includes(event.action as SplitSettlementAction)
        ) as Array<{
          action: SplitSettlementAction;
          actorAddress: string | null;
          createdAt: Date;
          metadataJson?: string | null;
        }>,
        clientAddress: agreement.clientAddress,
        workerAddress: agreement.workerAddress,
        milestoneAmount: milestone?.amount || agreement.amount,
      })
    );
  }

  const disputes = agreement.disputes.map((dispute) => {
    const refundConsensus = dispute.resolvedAt ? null : refundConsensusByDisputeId.get(dispute.id) || emptyRefundConsensusState();
    const splitConsensus = dispute.resolvedAt ? null : splitConsensusByDisputeId.get(dispute.id) || emptySplitConsensusState();
    return {
      ...dispute,
      refundConsensus,
      splitConsensus,
      workspaceState: deriveDisputeWorkspaceState({
        dispute: {
          ...dispute,
          refundConsensus,
          splitConsensus,
        },
        agreement,
      }),
    };
  });

  const milestones = agreement.milestones?.map((milestone) => ({
    ...milestone,
    disputes: milestone.disputes?.map((dispute: any) => {
      const refundConsensus = dispute.resolvedAt ? null : refundConsensusByDisputeId.get(dispute.id) || emptyRefundConsensusState();
      const splitConsensus = dispute.resolvedAt ? null : splitConsensusByDisputeId.get(dispute.id) || emptySplitConsensusState();
      return {
        ...dispute,
        refundConsensus,
        splitConsensus,
        workspaceState: deriveDisputeWorkspaceState({
          dispute: {
            ...dispute,
            refundConsensus,
            splitConsensus,
          },
          agreement,
        }),
      };
    }),
  }));

  const workflow = deriveAgreementWorkflowState({
    ...agreement,
    disputes,
  });

  return {
    ...agreement,
    workflowStage: workflow.workflowStage,
    nextParticipantAction: workflow.nextParticipantAction,
    disputes,
    milestones,
  };
}

function deriveDisputeWorkspaceState(params: {
  dispute: {
    openedBy: string;
    createdAt: string | Date;
    resolvedAt?: string | Date | null;
    evidenceEntries?: Array<{ submittedBy: string }>;
    refundConsensus?: RefundConsensusState | null;
    splitConsensus?: SplitConsensusState | null;
    aiRecommendation?: string | null;
  };
  agreement: {
    clientAddress: string;
    workerAddress: string;
    disputeWindowSecs: number;
  };
}) {
  if (params.dispute.resolvedAt) {
    return {
      stage: 'RESOLVED',
      responseDeadlineAt: null,
      counterpartyAddress: null,
      awaitingAddress: null,
    };
  }

  const openedAt = new Date(params.dispute.createdAt);
  const responseDeadlineAt = new Date(openedAt.getTime() + (params.agreement.disputeWindowSecs * 1000));
  const counterpartyAddress =
    params.dispute.openedBy === params.agreement.clientAddress
      ? params.agreement.workerAddress
      : params.dispute.openedBy === params.agreement.workerAddress
        ? params.agreement.clientAddress
        : null;
  const hasCounterpartyReply = counterpartyAddress
    ? (params.dispute.evidenceEntries || []).some((entry) => entry.submittedBy === counterpartyAddress)
    : false;
  const refundConsensus = params.dispute.refundConsensus;
  const splitConsensus = params.dispute.splitConsensus;

  if (splitConsensus?.proposedBy && !splitConsensus.fullyApproved) {
    return {
      stage: 'NEGOTIATING_SPLIT',
      responseDeadlineAt: responseDeadlineAt.toISOString(),
      counterpartyAddress,
      awaitingAddress: splitConsensus.awaitingAddress,
    };
  }

  if (refundConsensus?.proposedBy && !refundConsensus.fullyApproved) {
    return {
      stage: 'NEGOTIATING_REFUND',
      responseDeadlineAt: responseDeadlineAt.toISOString(),
      counterpartyAddress,
      awaitingAddress: refundConsensus.awaitingAddress,
    };
  }

  if (params.dispute.aiRecommendation || hasCounterpartyReply || Date.now() >= responseDeadlineAt.getTime()) {
    return {
      stage: 'READY_FOR_REVIEW',
      responseDeadlineAt: responseDeadlineAt.toISOString(),
      counterpartyAddress,
      awaitingAddress: null,
    };
  }

  return {
    stage: 'AWAITING_RESPONSE',
    responseDeadlineAt: responseDeadlineAt.toISOString(),
    counterpartyAddress,
    awaitingAddress: counterpartyAddress,
  };
}

function deriveAgreementWorkflowState(agreement: {
  status: string;
  settlementStatus: string;
  reserveHealthStatus?: string;
  milestones?: Array<{ status: string }>;
  disputes?: Array<{ resolvedAt?: string | Date | null }>;
}) {
  const openDispute = agreement.disputes?.find((dispute) => !dispute.resolvedAt);

  if (agreement.status === 'CANCELLED') {
    return {
      workflowStage: 'CANCELLED',
      nextParticipantAction: null,
    };
  }

  if (agreement.settlementStatus === 'FAILED') {
    return {
      workflowStage: 'SETTLEMENT_ATTENTION',
      nextParticipantAction: 'Retry or reconcile settlement',
    };
  }

  if (agreement.settlementStatus === 'FUNDING_PENDING') {
    return {
      workflowStage: 'FUNDING_IN_PROGRESS',
      nextParticipantAction: 'Wait for on-chain funding confirmation',
    };
  }

  if (agreement.reserveHealthStatus === 'TOP_UP_REQUIRED') {
    return {
      workflowStage: 'SETTLEMENT_ATTENTION',
      nextParticipantAction: 'Top up the imported grant reserve before the next payout can continue',
    };
  }

  if (agreement.settlementStatus === 'PAYOUT_PENDING') {
    return {
      workflowStage: 'PAYOUT_IN_PROGRESS',
      nextParticipantAction: 'Wait for payout confirmation',
    };
  }

  if (agreement.settlementStatus === 'REFUND_PENDING') {
    return {
      workflowStage: 'REFUND_IN_PROGRESS',
      nextParticipantAction: 'Wait for refund confirmation',
    };
  }

  if (agreement.settlementStatus === 'SPLIT_PENDING') {
    return {
      workflowStage: 'SPLIT_IN_PROGRESS',
      nextParticipantAction: 'Wait for split settlement confirmation',
    };
  }

  if (openDispute) {
    return {
      workflowStage: 'DISPUTE_OPEN',
      nextParticipantAction: 'Reply in dispute workspace or resolve settlement offer',
    };
  }

  switch (agreement.status) {
    case 'DRAFT':
      return {
        workflowStage: 'DRAFT',
        nextParticipantAction: 'Client can edit, cancel, or fund the agreement',
      };
    case 'FUNDED':
      return {
        workflowStage: 'ACTIVE_MILESTONE',
        nextParticipantAction: 'Worker should submit proof for the active milestone',
      };
    case 'PROOF_SUBMITTED':
      return {
        workflowStage: 'PROOF_REVIEW',
        nextParticipantAction: 'Agent or client should review submitted proof',
      };
    case 'UNDER_REVIEW':
      return {
        workflowStage: 'UNDER_REVIEW',
        nextParticipantAction: 'Client review or automated review is pending',
      };
    case 'APPROVED':
      return {
        workflowStage: 'APPROVED_FOR_SETTLEMENT',
        nextParticipantAction: 'Settlement is ready to execute',
      };
    case 'PAID':
      return {
        workflowStage: 'COMPLETED',
        nextParticipantAction: null,
      };
    case 'REFUNDED':
      return {
        workflowStage: 'REFUNDED',
        nextParticipantAction: null,
      };
    case 'EXPIRED':
      return {
        workflowStage: 'EXPIRED',
        nextParticipantAction: null,
      };
    default:
      return {
        workflowStage: agreement.status,
        nextParticipantAction: null,
      };
  }
}

async function setAgreementSettlementState(
  agreementId: string,
  data: {
    settlementStatus?: string;
    fundingConfirmedAt?: Date | null;
    lastSettlementError?: string | null;
    ckbTxHashFund?: string | null;
    ckbTxHashRelease?: string | null;
    fiberPaymentReference?: string | null;
  }
) {
  const updated = await prisma.agreement.update({
    where: { id: agreementId },
    data,
  });

  broadcast({
    type: 'AGREEMENT_UPDATE',
    payload: toJsonSafe(serializeAgreementForBroadcast(updated)),
  });

  void refreshReputationForAgreement(agreementId).catch((error) => {
    console.error('[REPUTATION] Failed to refresh after settlement update:', error);
  });

  return updated;
}

async function createSettlementRecord(params: {
  agreementId: string;
  milestoneId?: string | null;
  direction: SettlementDirection;
  network: SettlementNetwork;
  amount: string;
  txHash?: string | null;
  paymentReference?: string | null;
  status?: SettlementRecordStatus;
  errorMessage?: string | null;
  confirmedAt?: Date | null;
  operationKey?: string | null;
}) {
  return prisma.milestoneSettlement.create({
    data: {
      id: uuid(),
      agreementId: params.agreementId,
      milestoneId: params.milestoneId ?? null,
      direction: params.direction,
      network: params.network,
      amount: params.amount,
      txHash: params.txHash ?? null,
      paymentReference: params.paymentReference ?? null,
      status: params.status ?? 'PENDING',
      errorMessage: params.errorMessage ?? null,
      confirmedAt: params.confirmedAt ?? null,
      operationKey: params.operationKey ?? null,
    },
  });
}

async function sendIdempotentSettlementTransfer(params: {
  agreementId: string;
  milestoneId?: string | null;
  direction: Exclude<SettlementDirection, 'FUNDING'>;
  amount: string;
  destinationAddress: string;
  operationSuffix?: string;
}) {
  const operationKey = [
    'CKB', params.direction, params.agreementId, params.milestoneId ?? 'agreement', params.operationSuffix ?? 'default',
  ].join(':');
  let settlement;
  try {
    settlement = await createSettlementRecord({
      agreementId: params.agreementId,
      milestoneId: params.milestoneId ?? null,
      direction: params.direction,
      network: 'CKB',
      amount: params.amount,
      status: 'PENDING',
      operationKey,
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    settlement = await prisma.milestoneSettlement.findUnique({ where: { operationKey } });
    if (!settlement) throw error;
    if (settlement.txHash) return { settlement, txHash: settlement.txHash, replayed: true };
    throw new Error(`Settlement ${operationKey} has an uncertain prior transfer and requires reconciliation before retry.`);
  }

  try {
    const txHash = await sendTreasuryTransfer(params.destinationAddress, params.amount);
    const updated = await prisma.milestoneSettlement.update({
      where: { id: settlement.id },
      data: { txHash },
    });
    return { settlement: updated, txHash, replayed: false };
  } catch (error) {
    await markSettlementRecordStatus(settlement.id, {
      status: 'FAILED',
      errorMessage: error instanceof Error ? error.message : 'Settlement transfer failed.',
      confirmedAt: null,
    });
    throw error;
  }
}

async function markSettlementRecordStatus(
  settlementId: string,
  data: {
    status: SettlementRecordStatus;
    errorMessage?: string | null;
    confirmedAt?: Date | null;
  }
) {
  return prisma.milestoneSettlement.update({
    where: { id: settlementId },
    data,
  });
}

function getCurrentMilestoneFromAgreement(agreement: any) {
  const activeStatuses = ['ACTIVE', 'PROOF_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'DISPUTED'];
  return (
    agreement.milestones.find((milestone: any) => activeStatuses.includes(milestone.status)) ??
    agreement.milestones.find((milestone: any) => milestone.status === 'PENDING') ??
    null
  );
}

function safeParseSourceMetadata<T>(value: string | null | undefined): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function normalizeLooseText(value: string | null | undefined) {
  return (value || '').trim().toLowerCase();
}

function getImportedSourceMetadata(agreement: {
  source?: {
    externalMetadataJson?: string | null;
  } | null;
}) {
  return safeParseSourceMetadata<ImportedSourceMetadata>(agreement.source?.externalMetadataJson);
}

export function getImportedCommencementDetails(agreement: {
  source?: {
    externalMetadataJson?: string | null;
  } | null;
}) {
  const metadata = getImportedSourceMetadata(agreement);
  if (metadata?.parser !== 'NERVOS_GRANT_THREAD_V1') {
    return null;
  }

  const commencementEntry = Array.isArray(metadata.milestones)
    ? metadata.milestones.find((milestone) => milestone?.kind === 'COMMENCEMENT')
    : null;
  const upfrontPayment = metadata.upfrontPayment || null;

  if (!commencementEntry && !upfrontPayment) {
    return null;
  }

  return {
    title: commencementEntry?.title || 'Grant Commencement',
    amountUsd: commencementEntry?.budgetAmountUsd || upfrontPayment?.amountUsd || null,
    percentage: commencementEntry?.budgetPercent || upfrontPayment?.percentage || null,
    label: upfrontPayment?.label || null,
    amountShannons: upfrontPayment?.amountShannons || null,
  };
}

export function isSponsorControlledImportedAgreement(agreement: {
  source?: {
    sourceType?: string | null;
  } | null;
}) {
  return agreement.source?.sourceType === 'BOUNTY' || agreement.source?.sourceType === 'DAO';
}

function isUsdEquivalentImportedGrant(agreement: {
  pricingMode?: string | null;
  source?: {
    sourceType?: string | null;
  } | null;
}) {
  return agreement.pricingMode === 'USD_EQUIVALENT' && isSponsorControlledImportedAgreement(agreement);
}

function roundCkbAmountInput(value: Prisma.Decimal.Value) {
  return new Prisma.Decimal(value).toDecimalPlaces(8, Prisma.Decimal.ROUND_CEIL).toFixed(8).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

export function convertUsdToShannonsOrThrow(usdAmount: Prisma.Decimal.Value, priceUsd: Prisma.Decimal.Value) {
  const ckbAmount = convertUsdToCkb(usdAmount, priceUsd);
  if (!ckbAmount) {
    throw new Error('Unable to convert the USD-equivalent amount into CKB with the current quote.');
  }

  const shannons = BigInt(ckbAmount.mul('100000000').ceil().toFixed(0));
  if (shannons > MAX_SHANNONS) {
    throw new Error('Converted amount exceeds the maximum supported shannon amount.');
  }
  return shannons;
}

function getImportedMilestoneTargetUsdFromMetadata(
  metadata: ImportedSourceMetadata | null,
  sortOrder: number,
) {
  if (!metadata?.milestones?.length) {
    return null;
  }

  const matchingMilestone = metadata.milestones.find((milestone) => {
    if (milestone?.kind === 'COMMENCEMENT') {
      return false;
    }

    if (typeof milestone?.index === 'number') {
      return milestone.index === sortOrder;
    }

    return false;
  });

  return parseUsdAmount(matchingMilestone?.budgetAmountUsd || null);
}

async function getFreshRequiredPayoutFromUsdTarget(targetUsd: number) {
  const quote = await fetchCkbPriceQuote(true);
  const amountShannons = convertUsdToShannonsOrThrow(targetUsd, quote.priceUsd);
  return {
    quote,
    amountShannons,
  };
}

function getNextUsdEquivalentPayoutMilestone(agreement: {
  milestones?: Array<{
    status: string;
    targetUsd?: unknown;
    sortOrder?: number | null;
  }>;
}) {
  const payableStatuses = ['APPROVED', 'UNDER_REVIEW', 'PROOF_SUBMITTED', 'ACTIVE', 'PENDING'];
  return [...(agreement.milestones || [])]
    .sort((left, right) => (left.sortOrder || 0) - (right.sortOrder || 0))
    .find((milestone) =>
      payableStatuses.includes(milestone.status)
      && Number.isFinite(Number(milestone.targetUsd ?? NaN))
      && Boolean(milestone.targetUsd)
      && Number(milestone.targetUsd) > 0
    ) || null;
}

async function clearImportedGrantReserveAttentionIfRecovered(agreement: {
  id: string;
  pricingMode?: string | null;
  reserveCkbRemaining?: string | null;
  reserveHealthStatus?: string | null;
  lastSettlementError?: string | null;
  source?: {
    sourceType?: string | null;
  } | null;
  milestones?: Array<{
    status: string;
    targetUsd?: unknown;
    sortOrder?: number | null;
  }>;
}) {
  if (!isUsdEquivalentImportedGrant(agreement) || agreement.reserveHealthStatus !== 'TOP_UP_REQUIRED') {
    return agreement;
  }

  const nextMilestone = getNextUsdEquivalentPayoutMilestone(agreement);
  if (!nextMilestone?.targetUsd) {
    return agreement;
  }

  let amountShannons: bigint;
  try {
    amountShannons = (await getFreshRequiredPayoutFromUsdTarget(Number(nextMilestone.targetUsd))).amountShannons;
  } catch {
    return agreement;
  }

  const reserveRemaining = BigInt(agreement.reserveCkbRemaining || '0');
  if (reserveRemaining < amountShannons) {
    return agreement;
  }

  const updated = await prisma.agreement.update({
    where: { id: agreement.id },
    data: {
      reserveHealthStatus: 'HEALTHY',
      lastSettlementError: agreement.lastSettlementError === 'CKB reserve is insufficient to satisfy the next USD-equivalent milestone payout.'
        ? null
        : agreement.lastSettlementError,
    },
    include: agreementDetailInclude,
  });

  return ensureAgreementMilestones(updated);
}

async function ensureImportedGrantReserveSufficient(
  agreement: {
    id: string;
    reserveCkbRemaining?: string | null;
    reserveHealthStatus?: string | null;
    lastSettlementError?: string | null;
  },
  milestone: {
    id: string;
    title: string;
    targetUsd?: unknown;
  },
) {
  const targetUsd = Number(milestone.targetUsd ?? NaN);
  if (!Number.isFinite(targetUsd) || targetUsd <= 0) {
    throw new Error('This imported grant milestone is missing its canonical USD target.');
  }

  const { quote, amountShannons } = await getFreshRequiredPayoutFromUsdTarget(targetUsd);
  const reserveRemaining = BigInt(agreement.reserveCkbRemaining || '0');

  if (reserveRemaining < amountShannons) {
    await prisma.$transaction(async (tx) => {
      await tx.agreement.update({
        where: { id: agreement.id },
        data: {
          reserveHealthStatus: 'TOP_UP_REQUIRED',
          lastSettlementError: 'CKB reserve is insufficient to satisfy the next USD-equivalent milestone payout.',
        },
      });
    });

    throw new Error('CKB reserve is insufficient for this milestone. Top up the reserve before payout can continue.');
  }

  if (agreement.reserveHealthStatus === 'TOP_UP_REQUIRED') {
    await prisma.agreement.update({
      where: { id: agreement.id },
      data: {
        reserveHealthStatus: 'HEALTHY',
        lastSettlementError: agreement.lastSettlementError === 'CKB reserve is insufficient to satisfy the next USD-equivalent milestone payout.'
          ? null
          : agreement.lastSettlementError,
      },
    });
  }

  return {
    quote,
    amountShannons,
  };
}

async function applyImportedGrantReserveDebit(params: {
  agreementId: string;
  milestoneId?: string | null;
  amountShannons: bigint;
  quoteUsdPerCkb: number;
  realizedUsdValue: number;
  quoteSource: string;
  quotedAt: Date;
}) {
  const agreement = await fetchAgreementOrThrow(params.agreementId);
  const reserveRemaining = BigInt(agreement.reserveCkbRemaining || '0');
  const nextReserve = reserveRemaining - params.amountShannons;

  await prisma.$transaction(async (tx) => {
    await tx.agreement.update({
      where: { id: params.agreementId },
      data: {
        reserveCkbRemaining: nextReserve.toString(),
        reserveHealthStatus: 'HEALTHY',
      },
    });

    if (params.milestoneId) {
      await tx.milestone.update({
        where: { id: params.milestoneId },
        data: {
          releasedCkbAmount: params.amountShannons.toString(),
          releaseQuoteUsdPerCkb: params.quoteUsdPerCkb,
          releaseQuoteSource: params.quoteSource,
          releaseQuotedAt: params.quotedAt,
          releasedUsdValue: params.realizedUsdValue,
        },
      });
    }
  });
}

export async function sendApprovedMilestonePayout(params: {
  agreementId: string;
  milestoneId: string;
  trigger: 'STANDARD_APPROVAL' | 'COMMENCEMENT_AUTO_RELEASE';
}) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(params.agreementId));
  const milestone = agreement.milestones.find((item: any) => item.id === params.milestoneId);

  if (!milestone) {
    throw new Error('Approved milestone not found for payout.');
  }

  if (milestone.status !== 'APPROVED') {
    throw new Error('Milestone must be approved before payout can be sent.');
  }

  const pendingPayout = agreement.settlements.find(
    (settlement: any) =>
      settlement.direction === 'PAYOUT' &&
      settlement.milestoneId === milestone.id &&
      settlement.status === 'PENDING'
  );
  if (pendingPayout) {
    return confirmPendingSettlementIfReady(params.agreementId);
  }

  const existingConfirmedPayout = agreement.settlements.find(
    (settlement: any) =>
      settlement.direction === 'PAYOUT' &&
      settlement.milestoneId === milestone.id &&
      settlement.status === 'CONFIRMED'
  );
  if (existingConfirmedPayout) {
    return completeApprovedMilestone(params.agreementId);
  }

  await createLog({
    agreementId: params.agreementId,
    level: 'INFO',
    eventType: 'RELEASE_PREPARED',
    message:
      params.trigger === 'COMMENCEMENT_AUTO_RELEASE'
        ? `Preparing immediate commencement payout: ${milestone.title}`
        : `Preparing payout for milestone ${milestone.sortOrder}: ${milestone.title}`,
    metadata: {
      milestoneId: milestone.id,
      milestoneTitle: milestone.title,
      milestoneAmount: milestone.amount,
      milestoneTargetUsd: milestone.targetUsd ?? null,
      payoutNetwork: agreement.payoutNetwork,
      trigger: params.trigger,
    },
  });

  let payoutAmount = milestone.amount;
  let payoutQuoteUsdPerCkb: number | null = null;
  let payoutQuoteSource: string | null = null;
  let payoutQuotedAt: Date | null = null;
  let realizedUsdValue: number | null = null;

  if (isUsdEquivalentImportedGrant(agreement)) {
    const reserveCheck = await ensureImportedGrantReserveSufficient(agreement, milestone);
    payoutAmount = reserveCheck.amountShannons.toString();
    payoutQuoteUsdPerCkb = reserveCheck.quote.priceUsd;
    payoutQuoteSource = reserveCheck.quote.source;
    payoutQuotedAt = new Date(reserveCheck.quote.lastUpdatedAt ?? reserveCheck.quote.fetchedAt);
    realizedUsdValue = milestone.targetUsd == null ? null : Number(milestone.targetUsd);
  }

  const payoutTransfer = await sendIdempotentSettlementTransfer({
    agreementId: params.agreementId,
    milestoneId: milestone.id,
    direction: 'PAYOUT',
    amount: payoutAmount,
    destinationAddress: agreement.workerAddress,
  });
  const payoutTxHash = payoutTransfer.txHash;
  await setAgreementSettlementState(params.agreementId, {
    settlementStatus: 'PAYOUT_PENDING', ckbTxHashRelease: payoutTxHash, lastSettlementError: null,
  });

  if (isUsdEquivalentImportedGrant(agreement) && payoutQuoteUsdPerCkb && payoutQuoteSource && payoutQuotedAt && realizedUsdValue != null) {
    await applyImportedGrantReserveDebit({
      agreementId: params.agreementId,
      milestoneId: milestone.id,
      amountShannons: BigInt(payoutAmount),
      quoteUsdPerCkb: payoutQuoteUsdPerCkb,
      realizedUsdValue,
      quoteSource: payoutQuoteSource,
      quotedAt: payoutQuotedAt,
    });
  }

  await createLog({
    agreementId: params.agreementId,
    level: 'INFO',
    eventType: 'RELEASE_SENT',
    message:
      params.trigger === 'COMMENCEMENT_AUTO_RELEASE'
        ? `Commencement payout prepared on CKB: ${milestone.title}`
        : `Milestone payment prepared on CKB: ${milestone.title}`,
    metadata: {
      milestoneId: milestone.id,
      milestoneTitle: milestone.title,
      amount: payoutAmount,
      releaseQuoteUsdPerCkb: payoutQuoteUsdPerCkb,
      realizedUsdValue,
      route: 'CKB',
      trigger: params.trigger,
    },
  });

  return getAgreementById(params.agreementId);
}

async function sendImportedCommencementPayout(params: {
  agreementId: string;
  amountUsd: number;
  title?: string | null;
}) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(params.agreementId));
  const { quote, amountShannons } = await getFreshRequiredPayoutFromUsdTarget(params.amountUsd);
  const payoutAmount = amountShannons.toString();
  const existingSettlement = agreement.settlements.find(
    (settlement: any) =>
      settlement.direction === 'PAYOUT' &&
      settlement.milestoneId == null &&
      settlement.amount === payoutAmount &&
      ['PENDING', 'CONFIRMED'].includes(settlement.status),
  );

  if (existingSettlement) {
    return existingSettlement.status === 'PENDING'
      ? confirmPendingSettlementIfReady(params.agreementId)
      : getAgreementById(params.agreementId);
  }

  await createLog({
    agreementId: params.agreementId,
    level: 'INFO',
    eventType: 'RELEASE_PREPARED',
    message: params.title
      ? `Preparing immediate commencement payout: ${params.title}`
      : 'Preparing immediate commencement payout',
    metadata: {
      amount: payoutAmount,
      amountUsd: params.amountUsd,
      releaseQuoteUsdPerCkb: quote.priceUsd,
      trigger: 'COMMENCEMENT_AUTO_RELEASE',
      payoutNetwork: agreement.payoutNetwork,
    },
  });

  const payoutTransfer = await sendIdempotentSettlementTransfer({
    agreementId: params.agreementId,
    milestoneId: null,
    direction: 'PAYOUT',
    amount: payoutAmount,
    destinationAddress: agreement.workerAddress,
  });
  const payoutTxHash = payoutTransfer.txHash;
  await applyImportedGrantReserveDebit({
    agreementId: params.agreementId,
    milestoneId: null,
    amountShannons,
    quoteUsdPerCkb: quote.priceUsd,
    realizedUsdValue: params.amountUsd,
    quoteSource: quote.source,
    quotedAt: new Date(quote.lastUpdatedAt ?? quote.fetchedAt),
  });

  await setAgreementSettlementState(params.agreementId, {
    settlementStatus: 'PAYOUT_PENDING',
    ckbTxHashRelease: payoutTxHash,
    lastSettlementError: null,
  });

  await createLog({
    agreementId: params.agreementId,
    level: 'INFO',
    eventType: 'RELEASE_SENT',
    message: 'Commencement payout prepared on CKB',
    metadata: {
      amount: payoutAmount,
      amountUsd: params.amountUsd,
      releaseQuoteUsdPerCkb: quote.priceUsd,
      txHash: payoutTxHash,
      trigger: 'COMMENCEMENT_AUTO_RELEASE',
    },
  });

  return getAgreementById(params.agreementId);
}

function getLatestSettlementRecord(
  settlements: Array<{
    id: string;
    direction: string;
    status: string;
    milestoneId: string | null;
    network: string;
    amount: string;
    txHash: string | null;
    paymentReference: string | null;
  }>,
  params: {
    direction: SettlementDirection;
    milestoneId?: string | null;
    status?: SettlementRecordStatus;
  }
) {
  return settlements.find((settlement: any) => {
    if (settlement.direction !== params.direction) {
      return false;
    }

    if (params.status && settlement.status !== params.status) {
      return false;
    }

    if (params.milestoneId !== undefined && settlement.milestoneId !== params.milestoneId) {
      return false;
    }

    return true;
  }) ?? null;
}

type OnchainMatchingOutput = {
  index: number;
  capacity: bigint;
  outputData: string | null;
};

export function matchOnchainFundingOutputsToMilestones(
  milestones: Array<{
    id: string;
    escrowCellData?: string | null;
  }>,
  matchingOutputs: OnchainMatchingOutput[],
) {
  const remainingOutputs = [...matchingOutputs];
  const assignments = milestones.map((milestone) => {
    const milestoneData = normalizeHex(milestone.escrowCellData);
    if (!milestoneData) {
      return null;
    }

    const outputIndex = remainingOutputs.findIndex(
      (output) => normalizeHex(output.outputData) === milestoneData,
    );

    if (outputIndex === -1) {
      return null;
    }

    const [matchedOutput] = remainingOutputs.splice(outputIndex, 1);
    return {
      milestoneId: milestone.id,
      outputIndex: matchedOutput.index,
      outputData: matchedOutput.outputData,
    };
  });

  return assignments;
}

async function inferOnchainSettlementDirection(params: {
  txHash: string;
  workerAddress: string;
  clientAddress: string;
  expectedAmount: string;
}) {
  const [workerVerification, clientVerification] = await Promise.all([
    verifyFundingTransaction({
      txHash: params.txHash,
      toAddress: params.workerAddress,
      expectedAmount: params.expectedAmount,
    }),
    verifyFundingTransaction({
      txHash: params.txHash,
      toAddress: params.clientAddress,
      expectedAmount: params.expectedAmount,
    }),
  ]);

  const isCommitted = workerVerification.status === 'committed' || clientVerification.status === 'committed';
  if (!isCommitted) {
    return {
      direction: null as 'PAYOUT' | 'REFUND' | null,
      blockHash: workerVerification.blockHash || clientVerification.blockHash || null,
    };
  }

  if (workerVerification.status === 'committed' && workerVerification.foundMatchingOutput) {
    return {
      direction: 'PAYOUT' as const,
      blockHash: workerVerification.blockHash,
    };
  }

  if (clientVerification.status === 'committed' && clientVerification.foundMatchingOutput) {
    return {
      direction: 'REFUND' as const,
      blockHash: clientVerification.blockHash,
    };
  }

  return {
    direction: null as 'PAYOUT' | 'REFUND' | null,
    blockHash: workerVerification.blockHash || clientVerification.blockHash || null,
  };
}

async function reconcileSpentOnchainMilestoneCell(
  agreementId: string,
  agreement: Awaited<ReturnType<typeof ensureAgreementMilestones>>,
) {
  if (agreement.escrowModel !== 'ONCHAIN_LOCK') {
    return null;
  }

  const unsettledMilestone = agreement.milestones.find((milestone: any) =>
    !['PAID', 'REFUNDED', 'CANCELLED', 'EXPIRED'].includes(milestone.status)
    && milestone.escrowFundingTxHash
    && milestone.escrowOutputIndex != null
  );

  if (!unsettledMilestone) {
    return null;
  }

  const spending = await findSpendingTransactionForOutPoint({
    txHash: unsettledMilestone.escrowFundingTxHash,
    index: unsettledMilestone.escrowOutputIndex,
  });

  if (!spending.foundTransaction || !spending.spendingTxHash) {
    return null;
  }

  const inferred = await inferOnchainSettlementDirection({
    txHash: spending.spendingTxHash,
    workerAddress: agreement.workerAddress,
    clientAddress: agreement.clientAddress,
    expectedAmount: unsettledMilestone.amount,
  });

  if (!inferred.direction) {
    return null;
  }

  const existingSettlement = agreement.settlements.find((settlement: any) =>
    settlement.milestoneId === unsettledMilestone.id
    && settlement.txHash === spending.spendingTxHash
    && settlement.direction === inferred.direction
  );

  if (existingSettlement) {
    if (existingSettlement.status !== 'CONFIRMED') {
      await markSettlementRecordStatus(existingSettlement.id, {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        errorMessage: null,
      });
    }
  } else {
    await createSettlementRecord({
      agreementId,
      milestoneId: unsettledMilestone.id,
      direction: inferred.direction,
      network: 'CKB',
      amount: unsettledMilestone.amount,
      txHash: spending.spendingTxHash,
      status: 'CONFIRMED',
      confirmedAt: new Date(),
    });
  }

  await setAgreementSettlementState(agreementId, {
    settlementStatus: confirmedSettlementStatus(inferred.direction),
    ckbTxHashRelease: spending.spendingTxHash,
    lastSettlementError: null,
  });

  if (inferred.direction === 'PAYOUT') {
    await prisma.milestone.update({
      where: { id: unsettledMilestone.id },
      data: { status: 'PAID' },
    });
    await resolveOpenMilestoneDisputes(unsettledMilestone.id);

    const remainingMilestones = agreement.milestones.filter((item: any) => item.sortOrder > unsettledMilestone.sortOrder);
    const nextPendingMilestone = remainingMilestones.find((item: any) => item.status === 'PENDING');

    if (nextPendingMilestone) {
      await prisma.$transaction([
        prisma.agreement.update({
          where: { id: agreementId },
          data: {
            status: 'FUNDED',
            settlementStatus: 'FUNDED',
            lastSettlementError: null,
          },
        }),
        prisma.milestone.update({
          where: { id: nextPendingMilestone.id },
          data: { status: 'ACTIVE' },
        }),
      ]);

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
          recoveredFromTxHash: spending.spendingTxHash,
        },
      });
    } else {
      await prisma.agreement.update({
        where: { id: agreementId },
        data: {
          status: 'PAID',
          settlementStatus: 'PAYOUT_CONFIRMED',
          lastSettlementError: null,
        },
      });
    }

    const updatedAgreement = await getAgreementById(agreementId);
    await createLog({
      agreementId,
      level: 'SUCCESS',
      eventType: 'SETTLEMENT_CONFIRMED',
      message: 'Recovered a previously missed on-chain payout settlement',
      metadata: {
        milestoneId: unsettledMilestone.id,
        milestoneTitle: unsettledMilestone.title,
        txHash: spending.spendingTxHash,
        blockHash: inferred.blockHash,
      },
    });
    return updatedAgreement;
  }

  await resolveOpenMilestoneDisputes(unsettledMilestone.id);
  await prisma.$transaction([
    prisma.milestone.update({
      where: { id: unsettledMilestone.id },
      data: { status: 'REFUNDED' },
    }),
    prisma.agreement.update({
      where: { id: agreementId },
      data: {
        status: 'REFUNDED',
        settlementStatus: 'REFUND_CONFIRMED',
        lastSettlementError: null,
      },
    }),
  ]);
  await createLog({
    agreementId,
    level: 'SUCCESS',
    eventType: 'SETTLEMENT_CONFIRMED',
    message: 'Recovered a previously missed on-chain refund settlement',
    metadata: {
      milestoneId: unsettledMilestone.id,
      milestoneTitle: unsettledMilestone.title,
      txHash: spending.spendingTxHash,
      blockHash: inferred.blockHash,
    },
  });

  return getAgreementById(agreementId);
}

async function resolveOpenMilestoneDisputes(milestoneId: string) {
  await prisma.dispute.updateMany({
    where: { milestoneId, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
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
    payload: toJsonSafe(serializeAgreementForBroadcast(agreement)),
  });

  void refreshReputationForAgreement(agreementId).catch((error) => {
    console.error('[REPUTATION] Failed to refresh after agreement broadcast:', error);
  });

  return agreement;
}

async function fetchAgreementOrThrow(agreementId: string): Promise<any> {
  const agreement = await prisma.agreement.findUnique({
    where: { id: agreementId },
    include: agreementDetailInclude,
  });

  if (!agreement) {
    throw new Error(`Agreement ${agreementId} not found`);
  }

  return agreement;
}

async function ensureAgreementMilestones<
  T extends {
    id: string;
    appId: string;
    title: string;
    description: string;
    amount: string;
    status: string;
    milestones: unknown[];
  }
>(agreement: T): Promise<any> {
  if (agreement.milestones.length > 0) {
    return agreement;
  }

  await prisma.milestone.create({
    data: {
      id: uuid(),
      appId: agreement.appId,
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
    payload: toJsonSafe(serializeAgreementForBroadcast(updated)),
  });

  void refreshReputationForAgreement(agreementId).catch((error) => {
    console.error('[REPUTATION] Failed to refresh after status transition:', error);
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
  const currentMilestone = agreement.milestones.find((milestone: any) =>
    ['ACTIVE', 'PROOF_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'DISPUTED'].includes(milestone.status)
  );
  if (currentMilestone) {
    return currentMilestone;
  }

  const nextMilestone = agreement.milestones.find((milestone: any) => milestone.status === 'PENDING');
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

export async function updateDraftAgreement(agreementId: string, data: {
  title: string;
  description: string;
  workerAddress: string;
  deadlineAt: string;
  disputeWindowSecs: number;
  proofType: string;
  reviewerMode: string;
  releaseMode: string;
  payoutNetwork: string;
  milestones: Array<{
    id?: string;
    title: string;
    description: string;
    amount: string;
  }>;
}) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(agreementId));
  if (agreement.status !== 'DRAFT') {
    throw new Error('Only draft agreements can be edited.');
  }

  if (!data.milestones.length) {
    throw new Error('At least one milestone is required.');
  }

  const totalAmount = data.milestones.reduce((sum, milestone) => sum + BigInt(milestone.amount), BigInt(0)).toString();
  const normalizedMilestones = data.milestones.map((milestone, index) => ({
    id: milestone.id || null,
    title: milestone.title,
    description: milestone.description,
    amount: milestone.amount,
    sortOrder: index + 1,
  }));
  const milestoneDigest = buildMilestoneDigest(normalizedMilestones);
  const agreementDigest = buildAgreementDigest({
    title: data.title,
    description: data.description,
    clientAddress: agreement.clientAddress,
    workerAddress: normalizeAddress(data.workerAddress),
    deadlineAt: data.deadlineAt,
    disputeWindowSecs: data.disputeWindowSecs,
    proofType: data.proofType,
    reviewerMode: data.reviewerMode,
    releaseMode: data.releaseMode,
    payoutNetwork: 'CKB',
    milestoneDigest,
  });

  await prisma.$transaction(async (tx) => {
    const existingMilestoneIds = agreement.milestones.map((milestone: any) => milestone.id);
    const incomingMilestoneIds = normalizedMilestones.map((milestone) => milestone.id).filter(Boolean) as string[];

    await tx.agreement.update({
      where: { id: agreementId },
      data: {
        title: data.title,
        description: data.description,
        workerAddress: normalizeAddress(data.workerAddress),
        workerFiberPubkey: null,
        deadlineAt: new Date(data.deadlineAt),
        disputeWindowSecs: data.disputeWindowSecs,
        proofType: data.proofType,
        reviewerMode: data.reviewerMode,
        releaseMode: data.releaseMode,
        payoutNetwork: 'CKB',
        amount: totalAmount,
        agreementDigest,
        milestoneDigest,
      },
    });

    const milestonesToDelete = existingMilestoneIds.filter((id: string) => !incomingMilestoneIds.includes(id));
    if (milestonesToDelete.length) {
      await tx.milestone.deleteMany({
        where: { id: { in: milestonesToDelete } },
      });
    }

    for (const milestone of normalizedMilestones) {
      if (milestone.id && existingMilestoneIds.includes(milestone.id)) {
        await tx.milestone.update({
          where: { id: milestone.id },
          data: {
            title: milestone.title,
            description: milestone.description,
            amount: milestone.amount,
            sortOrder: milestone.sortOrder,
          },
        });
      } else {
        await tx.milestone.create({
          data: {
            id: randomUUID(),
            appId: agreement.appId,
            agreementId,
            title: milestone.title,
            description: milestone.description,
            amount: milestone.amount,
            sortOrder: milestone.sortOrder,
            status: 'PENDING',
          },
        });
      }
    }
  });

  await createLog({
    agreementId,
    level: 'INFO',
    eventType: 'AGREEMENT_CREATED',
    message: 'Draft agreement updated before funding',
    metadata: {
      milestoneCount: normalizedMilestones.length,
      amount: totalAmount,
    },
  });

  return getAgreementById(agreementId);
}

export async function cancelDraftAgreement(agreementId: string) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(agreementId));
  if (agreement.status !== 'DRAFT') {
    throw new Error('Only draft agreements can be cancelled.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.milestone.updateMany({
      where: { agreementId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    await tx.agreement.update({
      where: { id: agreementId },
      data: {
        status: 'CANCELLED',
        settlementStatus: 'UNFUNDED',
      },
    });
  });

  await broadcastAgreementUpdateById(agreementId);
  await createLog({
    agreementId,
    level: 'WARN',
    eventType: 'AGREEMENT_CREATED',
    message: 'Draft agreement was cancelled before funding',
  });

  return getAgreementById(agreementId);
}

export async function createAgreementComment(
  agreementId: string,
  authorAddress: string,
  content: string
) {
  const comment = await prisma.agreementComment.create({
    data: {
      id: randomUUID(),
      agreementId,
      authorAddress: normalizeAddress(authorAddress),
      content: content.trim(),
    },
  });

  await broadcastAgreementUpdateById(agreementId);
  await createLog({
    agreementId,
    level: 'INFO',
    eventType: 'DISPUTE_OPENED',
    message: `Agreement comment added by ${normalizeAddress(authorAddress)}`,
    metadata: {
      commentId: comment.id,
    },
  });

  return {
    comment,
    agreement: await getAgreementById(agreementId),
  };
}

export async function proposeAgreementAmendment(
  agreementId: string,
  proposedBy: string,
  input: {
    reason?: string;
    title?: string;
    description?: string;
    deadlineAt?: string;
    disputeWindowSecs?: number;
    releaseMode?: string;
    payoutNetwork?: string;
    milestones?: Array<{
      id: string;
      title?: string;
      description?: string;
      sortOrder?: number;
    }>;
  }
) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(agreementId));
  if (agreement.status === 'DRAFT' || agreement.status === 'CANCELLED') {
    throw new Error('Use draft editing before funding instead of amendment proposals.');
  }

  const amendment = await prisma.agreementAmendment.create({
    data: {
      id: randomUUID(),
      agreementId,
      proposedBy: normalizeAddress(proposedBy),
      reason: input.reason?.trim() || null,
      title: input.title?.trim() || null,
      description: input.description?.trim() || null,
      deadlineAt: input.deadlineAt ? new Date(input.deadlineAt) : null,
      disputeWindowSecs: input.disputeWindowSecs ?? null,
      releaseMode: input.releaseMode || null,
      payoutNetwork: input.payoutNetwork ? 'CKB' : null,
      milestonesJson: input.milestones ? JSON.stringify(input.milestones) : null,
    },
  });

  await broadcastAgreementUpdateById(agreementId);
  return {
    amendment,
    agreement: await getAgreementById(agreementId),
  };
}

export async function respondToAgreementAmendment(
  agreementId: string,
  amendmentId: string,
  actorAddress: string,
  input: {
    accept: boolean;
    responseNote?: string;
  }
) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(agreementId));
  const amendment = agreement.amendments?.find((item: any) => item.id === amendmentId);

  if (!amendment) {
    throw new Error('Amendment proposal not found.');
  }

  if (amendment.status !== 'PROPOSED') {
    throw new Error('This amendment proposal has already been resolved.');
  }

  const normalizedActor = normalizeAddress(actorAddress);
  if (normalizedActor === amendment.proposedBy) {
    throw new Error('The proposer cannot accept their own amendment.');
  }

  if (input.accept) {
    await prisma.$transaction(async (tx) => {
      await tx.agreementAmendment.update({
        where: { id: amendmentId },
        data: {
          status: 'ACCEPTED',
          responseNote: input.responseNote?.trim() || null,
          respondedAt: new Date(),
        },
      });

      const agreementUpdate: Record<string, unknown> = {};
      if (amendment.title) agreementUpdate.title = amendment.title;
      if (amendment.description) agreementUpdate.description = amendment.description;
      if (amendment.deadlineAt) agreementUpdate.deadlineAt = amendment.deadlineAt;
      if (amendment.disputeWindowSecs != null) agreementUpdate.disputeWindowSecs = amendment.disputeWindowSecs;
      if (amendment.releaseMode) agreementUpdate.releaseMode = amendment.releaseMode;
      if (amendment.payoutNetwork) agreementUpdate.payoutNetwork = amendment.payoutNetwork;

      if (Object.keys(agreementUpdate).length > 0) {
        await tx.agreement.update({
          where: { id: agreementId },
          data: agreementUpdate,
        });
      }

      if (amendment.milestonesJson) {
        const milestoneUpdates = JSON.parse(amendment.milestonesJson) as Array<{
          id: string;
          title?: string;
          description?: string;
          sortOrder?: number;
        }>;

        for (const milestoneUpdate of milestoneUpdates) {
          const existing = agreement.milestones.find((milestone: any) => milestone.id === milestoneUpdate.id);
          if (!existing || existing.status !== 'PENDING') {
            continue;
          }

          await tx.milestone.update({
            where: { id: milestoneUpdate.id },
            data: {
              title: milestoneUpdate.title ?? existing.title,
              description: milestoneUpdate.description ?? existing.description,
              sortOrder: milestoneUpdate.sortOrder ?? existing.sortOrder,
            },
          });
        }
      }
    });
  } else {
    await prisma.agreementAmendment.update({
      where: { id: amendmentId },
      data: {
        status: 'REJECTED',
        responseNote: input.responseNote?.trim() || null,
        respondedAt: new Date(),
      },
    });
  }

  await broadcastAgreementUpdateById(agreementId);
  return getAgreementById(agreementId);
}

export async function createAgreement(data: {
  title: string;
  description: string;
  clientAddress: string;
  workerAddress: string;
  deadlineAt: string;
  disputeWindowSecs: number;
  proofType: string;
  reviewerMode: string;
  releaseMode: string;
  payoutNetwork: string;
  escrowModel?: string;
  milestones: Array<{
    title: string;
    description: string;
    amount: string;
    targetUsd?: number;
  }>;
  sourceMetadata?: {
    sourceType: string;
    sourceLabel: string;
    externalUrl: string;
    forumThreadUrl?: string;
    sourceReferenceId?: string;
    externalMetadataJson?: string;
    sponsorName?: string;
    bountyTitle: string;
    bountyDescription?: string;
    governanceNotes?: string;
    createdByAddress: string;
  };
}) {
  if (!data.milestones.length) {
    throw new Error('At least one milestone is required');
  }

  const sourceMetadata = data.sourceMetadata
    ? safeParseSourceMetadata<ImportedSourceMetadata>(data.sourceMetadata.externalMetadataJson)
    : null;
  const isImportedGrant = Boolean(data.sourceMetadata && ['DAO', 'BOUNTY'].includes(data.sourceMetadata.sourceType));
  const commencementAmount = sourceMetadata?.upfrontPayment?.amountShannons
    ? BigInt(sourceMetadata.upfrontPayment.amountShannons)
    : BigInt(0);

  const clientAddress = normalizeAddress(data.clientAddress);
  const workerAddress = normalizeAddress(data.workerAddress);

  let reserveFundingQuoteUsdPerCkb: number | null = null;
  let reserveFundingQuoteSource: string | null = null;
  let reserveFundingQuotedAt: Date | null = null;
  let pricingMode = 'FIXED_CKB';
  let reserveCkbLocked = '0';
  let reserveCkbRemaining = '0';
  let reserveHealthStatus = 'HEALTHY';

  const totalAmount = (() => {
    if (!isImportedGrant) {
      return data.milestones
        .reduce((sum, milestone) => sum + BigInt(milestone.amount), commencementAmount)
        .toString();
    }

    pricingMode = 'USD_EQUIVALENT';
    return 'PENDING_IMPORTED_USD_EQUIVALENT';
  })();
  const agreementId = uuid();
  const normalizedMilestones = data.milestones.map((milestone, index) => ({
    title: milestone.title,
    description: milestone.description,
    amount: milestone.amount,
    targetUsd:
      isImportedGrant
        ? milestone.targetUsd ?? getImportedMilestoneTargetUsdFromMetadata(sourceMetadata, index + 1)
        : null,
    sortOrder: index + 1,
  }));

  const computedImportedUsdTotal = (() => {
    if (!isImportedGrant) {
      return 0;
    }

    const canonicalUsdTotal = normalizedMilestones.reduce((sum, milestone) => {
      const usdTarget = milestone.targetUsd;
      if (!Number.isFinite(usdTarget ?? NaN) || !usdTarget || usdTarget <= 0) {
        throw new Error(`Imported milestone ${milestone.sortOrder} is missing its canonical USD target.`);
      }
      return sum + usdTarget;
    }, 0);

    const commencementUsd = parseUsdAmount(sourceMetadata?.upfrontPayment?.amountUsd || null) || 0;
    const totalUsd = canonicalUsdTotal + commencementUsd;
    if (!Number.isFinite(totalUsd) || totalUsd <= 0) {
      throw new Error('Imported grant requires a positive USD-equivalent target before it can be created.');
    }

    return totalUsd;
  })();
  const milestoneDigest = buildMilestoneDigest(normalizedMilestones);
  const agreementDigest = buildAgreementDigest({
    title: data.title,
    description: data.description,
    clientAddress,
    workerAddress,
    deadlineAt: data.deadlineAt,
    disputeWindowSecs: data.disputeWindowSecs,
    proofType: data.proofType,
    reviewerMode: data.reviewerMode,
    releaseMode: data.releaseMode,
    payoutNetwork: 'CKB',
    milestoneDigest,
  });
  const escrowModel = isImportedGrant ? 'TREASURY_BRIDGE' : (data.escrowModel || 'TREASURY_BRIDGE');

  if (isImportedGrant) {
    const quote = await fetchCkbPriceQuote(true);
    reserveFundingQuoteUsdPerCkb = quote.priceUsd;
    reserveFundingQuoteSource = quote.source;
    reserveFundingQuotedAt = new Date(quote.lastUpdatedAt ?? quote.fetchedAt);
    const reserveShannons = convertUsdToShannonsOrThrow(
      computedImportedUsdTotal * IMPORTED_GRANT_RESERVE_BUFFER_MULTIPLIER,
      quote.priceUsd,
    ).toString();
    reserveCkbLocked = reserveShannons;
    reserveCkbRemaining = reserveShannons;
  }

  if (escrowModel === 'ONCHAIN_LOCK' && !isOnchainEscrowReady()) {
    throw new Error('On-chain lock escrow is not configured in this environment yet.');
  }

  const onchainDescriptor =
    escrowModel === 'ONCHAIN_LOCK'
      ? await buildOnchainEscrowDescriptor({
          agreementId,
          agreementDigest,
          clientAddress,
          workerAddress,
        })
      : null;

  if (escrowModel === 'ONCHAIN_LOCK' && onchainDescriptor) {
    const minimumMilestoneCapacity = getOnchainEscrowOccupiedCapacity({
      lockArgs: onchainDescriptor.lockArgs,
    });
    const underfundedMilestone = normalizedMilestones.find((milestone) => BigInt(milestone.amount) < minimumMilestoneCapacity);

    if (underfundedMilestone) {
      throw new Error(
        `Milestone ${underfundedMilestone.sortOrder} is too small for on-chain lock funding. Each milestone currently needs at least ${formatShannonsAsCkb(minimumMilestoneCapacity)} CKB, but this milestone is ${formatShannonsAsCkb(BigInt(underfundedMilestone.amount))} CKB.`,
      );
    }
  }

  const escrowAddress =
    escrowModel === 'ONCHAIN_LOCK'
      ? onchainDescriptor?.escrowAddress || null
      : await getTreasuryAddress().catch(() => null);

  const legacyApp = await ensureLegacyApp();

  const agreement = await prisma.agreement.create({
    data: {
      id: agreementId,
      appId: legacyApp.id,
      title: data.title,
      description: data.description,
      clientAddress,
      workerAddress,
      arbitratorAddress: null,
      workerFiberPubkey: null,
      amount: isImportedGrant ? reserveCkbLocked : totalAmount,
      deadlineAt: new Date(data.deadlineAt),
      disputeWindowSecs: data.disputeWindowSecs,
      proofType: data.proofType,
      reviewerMode: data.reviewerMode,
      releaseMode: data.releaseMode,
      payoutNetwork: 'CKB',
      escrowModel,
      escrowAddress,
      escrowLockCodeHash: onchainDescriptor?.lockCodeHash || null,
      escrowLockHashType: onchainDescriptor?.lockHashType || null,
      escrowLockArgs: onchainDescriptor?.lockArgs || null,
      agreementDigest,
      milestoneDigest,
      pricingMode,
      reserveCkbLocked,
      reserveCkbRemaining,
      reserveFundingQuoteUsdPerCkb,
      reserveFundingQuoteSource,
      reserveFundingQuotedAt,
      reserveHealthStatus,
      settlementStatus: 'UNFUNDED',
      status: 'DRAFT',
      milestones: {
        create: normalizedMilestones.map((milestone) => ({
          id: uuid(),
          appId: legacyApp.id,
          title: milestone.title,
          description: milestone.description,
          amount: milestone.amount,
          targetUsd: milestone.targetUsd ?? null,
          sortOrder: milestone.sortOrder,
          status: 'PENDING',
        })),
      },
    },
    include: {
      milestones: {
        orderBy: { sortOrder: 'asc' },
      },
      settlements: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (data.sourceMetadata) {
    await prisma.agreementSource.create({
      data: {
        id: randomUUID(),
        agreementId: agreement.id,
        sourceType: data.sourceMetadata.sourceType,
        sourceLabel: data.sourceMetadata.sourceLabel,
        externalUrl: data.sourceMetadata.externalUrl,
        forumThreadUrl: data.sourceMetadata.forumThreadUrl || null,
        sourceReferenceId: data.sourceMetadata.sourceReferenceId || null,
        externalMetadataJson: data.sourceMetadata.externalMetadataJson || null,
        sponsorName: data.sourceMetadata.sponsorName || null,
        bountyTitle: data.sourceMetadata.bountyTitle,
        bountyDescription: data.sourceMetadata.bountyDescription || null,
        governanceNotes: data.sourceMetadata.governanceNotes || null,
        syncStatus: data.sourceMetadata.forumThreadUrl || data.sourceMetadata.externalUrl ? 'READY_TO_SYNC' : 'NOT_CONFIGURED',
        createdByAddress: normalizeAddress(data.sourceMetadata.createdByAddress),
      },
    });
  }

  await createLog({
    agreementId: agreement.id,
    level: 'INFO',
    eventType: 'AGREEMENT_CREATED',
    message: `Agreement "${agreement.title}" created by ${agreement.clientAddress}`,
    metadata: {
      title: agreement.title,
      amount: agreement.amount,
      workerAddress: agreement.workerAddress,
      milestoneCount: normalizedMilestones.length,
      disputeResolution: 'MUTUAL_SETTLEMENT',
      escrowModel: agreement.escrowModel,
      escrowAddress: agreement.escrowAddress,
      escrowLockCodeHash: agreement.escrowLockCodeHash,
      escrowLockHashType: agreement.escrowLockHashType,
      escrowLockArgs: agreement.escrowLockArgs,
      agreementDigest: agreement.agreementDigest,
      milestoneDigest: agreement.milestoneDigest,
    },
  });

  void refreshReputationForAgreement(agreement.id).catch((error) => {
    console.error('[REPUTATION] Failed to refresh after agreement creation:', error);
  });

  if (data.sourceMetadata) {
    return getAgreementById(agreement.id);
  }

  return agreement;
}

export async function fundAgreement(agreementId: string, txHash: string, amountOverride?: string) {
  const agreement = await fetchAgreementOrThrow(agreementId);

  if (agreement.status !== 'DRAFT') {
    throw new Error('Only draft agreements can accept a new funding transaction');
  }

  if (agreement.ckbTxHashFund) {
    throw new Error('This agreement already has a recorded funding transaction. Wait for reconciliation before sending another transfer.');
  }

  if (agreement.escrowModel !== 'TREASURY_BRIDGE') {
    throw new Error('This environment does not yet support funding non-treasury escrow agreements through the current settlement handlers.');
  }

  const escrowAddress = agreement.escrowAddress || await getTreasuryAddress();
  const fundingAmount = isUsdEquivalentImportedGrant(agreement) && amountOverride
    ? amountOverride
    : agreement.amount;

  await prisma.$transaction(async (tx) => {
    await tx.agreement.update({
      where: { id: agreementId },
      data: {
        ckbTxHashFund: txHash,
        escrowAddress,
        amount: fundingAmount,
        settlementStatus: 'FUNDING_PENDING',
        lastSettlementError: null,
      },
    });

    await tx.milestoneSettlement.create({
      data: {
        id: uuid(),
        agreementId,
        direction: 'FUNDING',
        network: 'CKB',
        amount: fundingAmount,
        txHash,
        status: 'PENDING',
      },
    });
  });

  await createLog({
    agreementId,
    level: 'INFO',
    eventType: 'FUNDING_PENDING',
    message: `Funding transaction submitted for on-chain verification: ${txHash}`,
    metadata: {
      txHash,
      escrowAddress,
      fundingAmount,
      agreementDigest: agreement.agreementDigest,
      milestoneDigest: agreement.milestoneDigest,
    },
  });

  return getAgreementById(agreementId);
}

export async function topUpImportedGrantReserve(agreementId: string, txHash: string, amount: string) {
  const agreement = await fetchAgreementOrThrow(agreementId);

  if (!isUsdEquivalentImportedGrant(agreement)) {
    throw new Error('Reserve top-up is available only for USD-equivalent imported grants.');
  }

  if (agreement.escrowModel !== 'TREASURY_BRIDGE') {
    throw new Error('Reserve top-up is available only for treasury-backed imported grants.');
  }

  const escrowAddress = agreement.escrowAddress || await getTreasuryAddress();

  const verification = await verifyFundingTransaction({
    txHash,
    toAddress: escrowAddress,
    expectedAmount: amount,
  });

  if (!verification.foundTransaction || verification.status !== 'committed' || !verification.foundMatchingOutput) {
    throw new Error('Top-up transaction could not be verified on-chain yet.');
  }

  const nextReserveLocked = (BigInt(agreement.reserveCkbLocked || '0') + BigInt(amount)).toString();
  const nextReserveRemaining = (BigInt(agreement.reserveCkbRemaining || '0') + BigInt(amount)).toString();

  await prisma.$transaction(async (tx) => {
    await tx.agreement.update({
      where: { id: agreementId },
      data: {
        reserveCkbLocked: nextReserveLocked,
        reserveCkbRemaining: nextReserveRemaining,
        reserveHealthStatus: 'HEALTHY',
        lastSettlementError: null,
      },
    });

    await tx.milestoneSettlement.create({
      data: {
        id: uuid(),
        agreementId,
        direction: 'FUNDING',
        network: 'CKB',
        amount,
        txHash,
        status: 'CONFIRMED',
        confirmedAt: new Date(),
      },
    });
  });

  await createLog({
    agreementId,
    level: 'SUCCESS',
    eventType: 'FUNDING_CONFIRMED',
    message: 'Imported grant reserve top-up confirmed on-chain',
    metadata: {
      txHash,
      amount,
      reserveCkbLocked: nextReserveLocked,
      reserveCkbRemaining: nextReserveRemaining,
    },
  });

  return getAgreementById(agreementId);
}

export async function registerOnchainFundingIntent(
  agreementId: string,
  txHash: string,
  milestoneOutputs: Array<{
    milestoneId: string;
    outputIndex: number;
    escrowCellData: string;
    refundTimeoutBlock: string;
  }>,
  commencementOutputIndex?: number | null,
) {
  const agreement = await fetchAgreementOrThrow(agreementId);

  if (agreement.status !== 'DRAFT') {
    throw new Error('Only draft agreements can accept a new funding transaction');
  }

  if (agreement.escrowModel !== 'ONCHAIN_LOCK') {
    throw new Error('This agreement is not configured for on-chain lock funding');
  }

  if (agreement.ckbTxHashFund) {
    throw new Error('This agreement already has a recorded funding transaction. Wait for reconciliation before sending another transfer.');
  }

  const milestoneMap = new Map(agreement.milestones.map((milestone: any) => [milestone.id, milestone]));
  if (milestoneOutputs.length !== agreement.milestones.length) {
    throw new Error('Every milestone needs an escrow output entry for on-chain funding');
  }

  await prisma.$transaction(async (tx) => {
    await tx.agreement.update({
      where: { id: agreementId },
      data: {
        ckbTxHashFund: txHash,
        settlementStatus: 'FUNDING_PENDING',
        lastSettlementError: null,
      },
    });

    for (const output of milestoneOutputs) {
      const milestone = milestoneMap.get(output.milestoneId);
      if (!milestone) {
        throw new Error(`Milestone ${output.milestoneId} does not belong to agreement ${agreementId}`);
      }

      await tx.milestone.update({
        where: { id: output.milestoneId },
        data: {
          escrowFundingTxHash: txHash,
          escrowOutputIndex: output.outputIndex,
          escrowCellData: output.escrowCellData,
          refundTimeoutBlock: BigInt(output.refundTimeoutBlock),
        } as any,
      });
    }

    await tx.milestoneSettlement.create({
      data: {
        id: uuid(),
        agreementId,
        direction: 'FUNDING',
        network: 'CKB',
        amount: agreement.amount,
        txHash,
        status: 'PENDING',
      },
    });
  });

  await createLog({
    agreementId,
    level: 'INFO',
    eventType: 'FUNDING_PENDING',
    message: `On-chain lock funding transaction submitted for verification: ${txHash}`,
    metadata: {
      txHash,
      escrowAddress: agreement.escrowAddress,
      milestoneOutputs: milestoneOutputs.map((item) => ({
        milestoneId: item.milestoneId,
        outputIndex: item.outputIndex,
      })),
      commencementOutputIndex: commencementOutputIndex ?? null,
    },
  });

  return getAgreementById(agreementId);
}

export async function confirmFundingIfReady(agreementId: string) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(agreementId));

  if (
    !agreement.ckbTxHashFund ||
    !['FUNDING_PENDING', 'FAILED'].includes(agreement.settlementStatus)
  ) {
    return null;
  }

  const verification =
    agreement.escrowModel === 'ONCHAIN_LOCK'
      ? await inspectTransactionOutputsToAddress({
          txHash: agreement.ckbTxHashFund,
          toAddress: agreement.escrowAddress || await getTreasuryAddress(),
        })
      : await verifyFundingTransaction({
          txHash: agreement.ckbTxHashFund,
          toAddress: agreement.escrowAddress || await getTreasuryAddress(),
          expectedAmount: agreement.amount,
        });
  const importedCommencement = getImportedCommencementDetails(agreement);
  const commencementAmount = importedCommencement?.amountShannons
    ? BigInt(importedCommencement.amountShannons)
    : BigInt(0);
  const commencementUsdAmount = parseUsdAmount(importedCommencement?.amountUsd || null) || 0;
  const commencementVerification =
    agreement.escrowModel === 'ONCHAIN_LOCK' && commencementAmount > BigInt(0)
      ? await inspectTransactionOutputsToAddress({
          txHash: agreement.ckbTxHashFund,
          toAddress: agreement.workerAddress,
        })
      : null;

  if (!verification.foundTransaction || verification.status === 'pending' || verification.status === 'proposed') {
    return null;
  }

  const fundingRecord = getLatestSettlementRecord(agreement.settlements, {
    direction: 'FUNDING',
    milestoneId: null,
    status: 'PENDING',
  });

  const matchedMilestoneOutputs =
    agreement.escrowModel === 'ONCHAIN_LOCK' && 'matchingOutputs' in verification
      ? matchOnchainFundingOutputsToMilestones(
          agreement.milestones.map((milestone: any) => ({
            id: milestone.id,
            escrowCellData: milestone.escrowCellData,
          })),
          verification.matchingOutputs as Array<{
            index: number;
            capacity: bigint;
            outputData: string | null;
          }>,
        )
      : [];

  const fundingValid =
    agreement.escrowModel === 'ONCHAIN_LOCK'
      ? verification.status === 'committed' &&
        'totalMatchedCapacity' in verification &&
        verification.totalMatchedCapacity >= (BigInt(agreement.amount) - commencementAmount) &&
        (
          commencementAmount === BigInt(0)
          || Boolean(
            commencementVerification &&
            commencementVerification.status === 'committed' &&
            commencementVerification.matchingOutputs.some((output) => output.capacity >= commencementAmount),
          )
        ) &&
        matchedMilestoneOutputs.length === agreement.milestones.length &&
        matchedMilestoneOutputs.every(Boolean)
      : verification.status === 'committed' &&
        'foundMatchingOutput' in verification &&
        verification.foundMatchingOutput;

  if (fundingValid) {
    const confirmedAt = new Date();

    if (fundingRecord) {
      await markSettlementRecordStatus(fundingRecord.id, {
        status: 'CONFIRMED',
        confirmedAt,
        errorMessage: null,
      });
    }

    if (agreement.escrowModel === 'ONCHAIN_LOCK') {
      await prisma.$transaction(
        matchedMilestoneOutputs.map((matchedOutput) =>
          prisma.milestone.update({
            where: { id: matchedOutput!.milestoneId },
            data: {
              escrowFundingTxHash: agreement.ckbTxHashFund,
              escrowOutputIndex: matchedOutput!.outputIndex,
            },
          })
        ),
      );
    }

    await prisma.agreement.update({
      where: { id: agreementId },
      data: {
        reserveCkbLocked: isUsdEquivalentImportedGrant(agreement) ? agreement.amount : agreement.reserveCkbLocked,
        reserveCkbRemaining: isUsdEquivalentImportedGrant(agreement) ? agreement.amount : agreement.reserveCkbRemaining,
        reserveHealthStatus: isUsdEquivalentImportedGrant(agreement) ? 'HEALTHY' : agreement.reserveHealthStatus,
      },
    });

    await setAgreementSettlementState(agreementId, {
      settlementStatus: 'FUNDED',
      fundingConfirmedAt: confirmedAt,
      lastSettlementError: null,
    });

    await transitionStatus(agreementId, 'FUNDED');
    const activeMilestone = await activateNextMilestone(agreementId);

    await createLog({
      agreementId,
      level: 'SUCCESS',
      eventType: 'FUNDING_CONFIRMED',
      message: 'Agreement funding confirmed on-chain',
      metadata: {
        txHash: agreement.ckbTxHashFund,
        blockHash: verification.blockHash,
        activeMilestoneId: activeMilestone?.id ?? null,
        activeMilestoneTitle: activeMilestone?.title ?? null,
        commencementAmount: commencementAmount > BigInt(0) ? commencementAmount.toString() : null,
        matchedOutputIndexes: matchedMilestoneOutputs.map((output) => output?.outputIndex ?? null),
      },
    });

    if (commencementAmount > BigInt(0)) {
      const existingCommencementPayout = agreement.settlements.find(
        (settlement: any) =>
          settlement.direction === 'PAYOUT' &&
          settlement.milestoneId == null &&
          settlement.amount === commencementAmount.toString() &&
          settlement.status === 'CONFIRMED',
      );

      if (!existingCommencementPayout && !isUsdEquivalentImportedGrant(agreement)) {
        await createSettlementRecord({
          agreementId,
          milestoneId: null,
          direction: 'PAYOUT',
          network: 'CKB',
          amount: commencementAmount.toString(),
          txHash: agreement.ckbTxHashFund,
          status: 'CONFIRMED',
          confirmedAt,
        });

        await createLog({
          agreementId,
          level: 'SUCCESS',
          eventType: 'SETTLEMENT_CONFIRMED',
          message: importedCommencement?.title
            ? `${importedCommencement.title} released immediately after funding confirmation`
            : 'Commencement payout released immediately after funding confirmation',
          metadata: {
            amount: commencementAmount.toString(),
            txHash: agreement.ckbTxHashFund,
            trigger: 'COMMENCEMENT_AUTO_RELEASE',
          },
        });
      }
    }

    if (agreement.escrowModel !== 'ONCHAIN_LOCK' && commencementUsdAmount > 0 && isUsdEquivalentImportedGrant(agreement)) {
      await sendImportedCommencementPayout({
        agreementId,
        amountUsd: commencementUsdAmount,
        title: importedCommencement?.title || null,
      });
    } else if (agreement.escrowModel !== 'ONCHAIN_LOCK' && commencementUsdAmount > 0 && !isUsdEquivalentImportedGrant(agreement)) {
      await sendImportedCommencementPayout({
        agreementId,
        amountUsd: commencementUsdAmount,
        title: importedCommencement?.title || null,
      });
    }

    return getAgreementById(agreementId);
  }

  if (fundingRecord) {
    await markSettlementRecordStatus(fundingRecord.id, {
      status: 'FAILED',
      errorMessage: 'Funding transaction did not produce the expected escrow output.',
      confirmedAt: null,
    });
  }

  await setAgreementSettlementState(agreementId, {
    settlementStatus: 'FAILED',
    lastSettlementError: 'Funding verification failed. The transaction did not match the escrow target.',
  });

  await createLog({
    agreementId,
    level: 'ERROR',
    eventType: 'ERROR',
    message: 'Funding verification failed because the expected escrow output was not found on-chain',
    metadata: {
      txHash: agreement.ckbTxHashFund,
      blockHash: verification.blockHash,
      rpcStatus: verification.status,
      matchedOutputs:
        'matchingOutputs' in verification
          ? verification.matchingOutputs.map((output: { index: number; capacity: bigint; outputData: string | null }) => ({
              index: output.index,
              capacity: output.capacity.toString(),
              outputData: output.outputData,
            }))
          : null,
      expectedMilestoneData: agreement.milestones.map((milestone: any) => ({
        milestoneId: milestone.id,
        escrowOutputIndex: milestone.escrowOutputIndex,
        escrowCellData: milestone.escrowCellData,
      })),
    },
  });

  return getAgreementById(agreementId);
}

export async function submitProof(
  agreementId: string,
  milestoneId: string,
  proofType: string,
  content: string,
  contentHash?: string,
  options?: {
    summary?: string;
    artifacts?: ArtifactInput[];
  }
) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(agreementId));
  const milestone = agreement.milestones.find((item: any) => item.id === milestoneId);

  if (!milestone) {
    throw new Error('Milestone not found');
  }

  if (!['ACTIVE', 'PROOF_SUBMITTED'].includes(milestone.status)) {
    throw new Error('Proof can only be submitted for the active milestone or to revise a requested update');
  }

  const latestExistingProof = milestone.proofs?.[0] || null;
  const previousProof = latestExistingProof?.content
    ? parseProofBundle(latestExistingProof.content)
    : null;
  const mergedArtifacts = new Map<string, ArtifactInput>();
  if (previousProof) {
    previousProof.artifacts.forEach((artifact) => {
      mergedArtifacts.set(artifact.id, {
        id: artifact.id,
        kind: artifact.kind,
        label: artifact.label,
        mimeType: artifact.mimeType || undefined,
        content: artifact.content,
        sizeBytes: artifact.sizeBytes || undefined,
      });
    });
  }
  (options?.artifacts || []).forEach((artifact, index) => {
    mergedArtifacts.set(artifact.id || `${artifact.kind}-${index}`, artifact);
  });

  const mergedPrimaryText = content.trim() || previousProof?.primaryText || '';
  const mergedSummary = options?.summary?.trim() || previousProof?.summary || '';
  const revision = (milestone.proofs?.length || 0) + 1;
  const serializedContent = serializeProofBundle({
    summary: mergedSummary,
    primaryText: mergedPrimaryText,
    artifacts: Array.from(mergedArtifacts.values()),
    revision,
  });
  const hash = contentHash || computeContentHash(serializedContent);

  const proof = await prisma.proof.create({
    data: {
      id: uuid(),
      appId: agreement.appId,
      agreementId,
      milestoneId,
      proofType,
      content: serializedContent,
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
      artifactCount: options?.artifacts?.length || 0,
      revision,
    },
  });

  return {
    proof,
    agreement: await getAgreementById(agreementId),
  };
}

export async function recordOnchainResolutionIntent(params: {
  agreementId: string;
  milestoneId: string;
  txHash: string;
  direction: 'PAYOUT' | 'REFUND';
}) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(params.agreementId));
  const milestone = agreement.milestones.find((item: any) => item.id === params.milestoneId);

  if (!milestone) {
    throw new Error('Milestone not found');
  }

  if (agreement.escrowModel !== 'ONCHAIN_LOCK') {
    throw new Error('This agreement is not configured for on-chain lock settlement');
  }

  if (params.direction === 'REFUND' && isSponsorControlledImportedAgreement(agreement)) {
    throw new Error('Imported grant milestones cannot be refunded through the worker settlement path.');
  }

  if (params.direction === 'PAYOUT') {
    if (!['PROOF_SUBMITTED', 'UNDER_REVIEW', 'DISPUTED'].includes(milestone.status)) {
      throw new Error('Milestone is not ready for payout settlement');
    }

    const openDispute = milestone.disputes?.find((item: any) => !item.resolvedAt) || null;
    if (openDispute) {
      const decoratedAgreement = await getAgreementById(params.agreementId);
      const decoratedDispute = decoratedAgreement?.disputes?.find((item: any) => item.id === openDispute.id) || null;
      const blockingProposal = getBlockingDisputeSettlementProposal({ dispute: decoratedDispute });
      if (blockingProposal) {
        throw new Error(
          blockingProposal.type === 'SPLIT'
            ? 'A split settlement proposal is still open. The worker must accept it before funds move, or the participants must resolve the dispute before approving a full payout.'
            : 'A mutual refund proposal is still open. Resolve the refund proposal before approving a full payout.'
        );
      }
    }

    await resolveOpenMilestoneDisputes(milestone.id);
    await transitionMilestoneStatus(milestone.id, 'APPROVED');
    await transitionStatus(params.agreementId, 'APPROVED');
    await recordMilestoneSettlementAttempt({
      agreementId: params.agreementId,
      milestoneId: milestone.id,
      direction: 'PAYOUT',
      network: 'CKB',
      amount: milestone.amount,
      txHash: params.txHash,
    });

    return getAgreementById(params.agreementId);
  }

  if (!['ACTIVE', 'UNDER_REVIEW', 'DISPUTED', 'PROOF_SUBMITTED'].includes(milestone.status)) {
    throw new Error('Milestone is not eligible for refund settlement');
  }

  await resolveOpenMilestoneDisputes(milestone.id);
  await transitionMilestoneStatus(milestone.id, 'REFUNDED');
  await transitionStatus(params.agreementId, 'REFUNDED');
  await recordMilestoneSettlementAttempt({
    agreementId: params.agreementId,
    milestoneId: milestone.id,
    direction: 'REFUND',
    network: 'CKB',
    amount: milestone.amount,
    txHash: params.txHash,
  });

  return getAgreementById(params.agreementId);
}

export async function openDispute(
  agreementId: string,
  milestoneId: string,
  openedBy: string,
  reason: string,
  evidenceNotes?: string,
  options?: {
    desiredResolution?: DisputeResolutionChoice;
    splitWorkerAmount?: string;
    artifacts?: ArtifactInput[];
  }
) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(agreementId));
  if (isSponsorControlledImportedAgreement(agreement)) {
    throw new Error('Imported grant milestones use reviewer follow-up requests instead of disputes.');
  }
  const milestone = agreement.milestones.find((item: any) => item.id === milestoneId);

  if (!milestone) {
    throw new Error('Milestone not found');
  }

  if (milestone.disputes.some((item: any) => !item.resolvedAt)) {
    throw new Error('This milestone already has an open dispute');
  }

  let validatedSplit:
    | {
        workerAmountValue: bigint;
        milestoneAmountValue: bigint;
        clientRefundAmount: string;
      }
    | null = null;
  if (options?.desiredResolution === 'SPLIT') {
    if (!options.splitWorkerAmount) {
      throw new Error('Split settlement worker amount is required when requesting a split.');
    }

    validatedSplit = validateSplitWorkerAmount(options.splitWorkerAmount, milestone.amount);
  }

  const dispute = await prisma.dispute.create({
    data: {
      id: uuid(),
      appId: agreement.appId,
      agreementId,
      milestoneId,
      openedBy,
      reason,
      evidenceNotes: evidenceNotes || null,
    },
  });

  if (options?.artifacts?.length || options?.desiredResolution || evidenceNotes?.trim()) {
    await prisma.disputeEvidence.create({
      data: {
        id: uuid(),
        disputeId: dispute.id,
        submittedBy: openedBy,
        content: serializeDisputeEvidenceBundle({
          message: evidenceNotes || '',
          desiredResolution: options?.desiredResolution || null,
          splitWorkerAmount: options?.splitWorkerAmount || null,
          artifacts: options?.artifacts,
        }),
      },
    });
  }

  if (
    options?.desiredResolution === 'SPLIT'
    && validatedSplit
    && openedBy === agreement.clientAddress
  ) {
    await createAuditLog({
      agreementId,
      actorAddress: openedBy,
      action: 'SPLIT_PROPOSED',
      resourceType: 'DISPUTE',
      resourceId: dispute.id,
      metadata: {
        milestoneId: milestone.id,
        settlement: 'SPLIT',
        workerAmount: validatedSplit.workerAmountValue.toString(),
        clientRefundAmount: validatedSplit.clientRefundAmount,
        source: 'DISPUTE_OPENED',
      },
    });
  }

  if (options?.desiredResolution === 'REFUND' && openedBy === agreement.clientAddress) {
    await createAuditLog({
      agreementId,
      actorAddress: openedBy,
      action: 'REFUND_PROPOSED',
      resourceType: 'DISPUTE',
      resourceId: dispute.id,
      metadata: {
        milestoneId: milestone.id,
        settlement: 'REFUND',
        source: 'DISPUTE_OPENED',
      },
    });
  }

  await transitionMilestoneStatus(milestoneId, 'DISPUTED');
  await transitionStatus(agreementId, 'DISPUTED');
  await setAgreementSettlementState(agreementId, {
    settlementStatus: 'DISPUTE_LOCKED',
    lastSettlementError: null,
  });

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
      desiredResolution: options?.desiredResolution || null,
    },
  });

  return {
    dispute,
    agreement: await getAgreementById(agreementId),
  };
}

export async function recordMutualRefundConsent(
  agreementId: string,
  actorAddress: string
) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(agreementId));
  if (isSponsorControlledImportedAgreement(agreement)) {
    throw new Error('Imported grant milestones do not support mutual refund settlement.');
  }
  const milestone = getCurrentMilestoneFromAgreement(agreement);

  if (!milestone || milestone.status !== 'DISPUTED') {
    throw new Error('Open a dispute on the current milestone before proposing a refund.');
  }

  if (agreement.escrowModel !== 'TREASURY_BRIDGE') {
    throw new Error('Mutual settlement refunds are currently available only for Treasury Bridge agreements.');
  }

  if (actorAddress !== agreement.clientAddress && actorAddress !== agreement.workerAddress) {
    throw new Error('Only the client or worker can approve a mutual refund.');
  }

  const dispute = milestone.disputes.find((item: any) => !item.resolvedAt);
  if (!dispute) {
    throw new Error('No open dispute found for the current milestone.');
  }

  const refundConsensus = await buildRefundConsensusForDispute(
    agreementId,
    dispute.id,
    agreement.clientAddress,
    agreement.workerAddress
  );

  if (!refundConsensus.proposedBy && actorAddress !== agreement.clientAddress) {
    throw new Error('Only the client can propose a mutual refund.');
  }

  if (refundConsensus.proposedBy && actorAddress === agreement.clientAddress) {
    throw new Error('Refund proposal already sent. It is now waiting for the worker to accept it.');
  }

  const actorAlreadyApproved =
    (actorAddress === agreement.clientAddress && refundConsensus.clientApprovedAt)
    || (actorAddress === agreement.workerAddress && refundConsensus.workerApprovedAt);

  if (!actorAlreadyApproved) {
    await createAuditLog({
      agreementId,
      actorAddress,
      action: refundConsensus.proposedBy ? 'REFUND_APPROVED' : 'REFUND_PROPOSED',
      resourceType: 'DISPUTE',
      resourceId: dispute.id,
      metadata: {
        milestoneId: milestone.id,
        settlement: 'REFUND',
      },
    });
  }

  const updatedConsensus = await buildRefundConsensusForDispute(
    agreementId,
    dispute.id,
    agreement.clientAddress,
    agreement.workerAddress
  );

  if (updatedConsensus.fullyApproved) {
    await createAuditLog({
      agreementId,
      actorType: 'SYSTEM',
      action: 'REFUND_MUTUAL_SETTLEMENT_REACHED',
      resourceType: 'DISPUTE',
      resourceId: dispute.id,
      metadata: {
        milestoneId: milestone.id,
        proposedBy: updatedConsensus.proposedBy,
        clientApprovedAt: updatedConsensus.clientApprovedAt,
        workerApprovedAt: updatedConsensus.workerApprovedAt,
      },
    });

    return refundCurrentMilestone(agreementId);
  }

  await createLog({
    agreementId,
    level: 'INFO',
    eventType: 'DISPUTE_OPENED',
    message: `Refund proposal recorded for milestone ${milestone.sortOrder}: ${milestone.title}`,
    metadata: {
      disputeId: dispute.id,
      milestoneId: milestone.id,
      proposedBy: updatedConsensus.proposedBy,
      awaitingAddress: updatedConsensus.awaitingAddress,
    },
  });

  await broadcastAgreementUpdateById(agreementId);

  return getAgreementById(agreementId);
}

export async function addDisputeEvidence(
  agreementId: string,
  disputeId: string,
  submittedBy: string,
  content: string,
  options?: {
    desiredResolution?: DisputeResolutionChoice;
    splitWorkerAmount?: string;
    artifacts?: ArtifactInput[];
  }
) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(agreementId));
  if (isSponsorControlledImportedAgreement(agreement)) {
    throw new Error('Imported grant milestones do not use the dispute evidence workspace.');
  }
  const dispute = agreement.disputes.find((item: any) => item.id === disputeId);

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
      content: serializeDisputeEvidenceBundle({
        message: content,
        desiredResolution: options?.desiredResolution || null,
        splitWorkerAmount: options?.splitWorkerAmount || null,
        artifacts: options?.artifacts,
      }),
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
      desiredResolution: options?.desiredResolution || null,
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

  if (!['PROOF_SUBMITTED', 'UNDER_REVIEW', 'DISPUTED'].includes(milestone.status)) {
    throw new Error('Current milestone is not ready for approval');
  }

  const openDispute = milestone.disputes?.find((item: any) => !item.resolvedAt) || null;
  if (openDispute) {
    const decoratedAgreement = await getAgreementById(agreementId);
    const decoratedDispute = decoratedAgreement?.disputes?.find((item: any) => item.id === openDispute.id) || null;
    const blockingProposal = getBlockingDisputeSettlementProposal({ dispute: decoratedDispute });
    if (blockingProposal) {
      throw new Error(
        blockingProposal.type === 'SPLIT'
          ? 'A split settlement proposal is still open. The worker must accept it before funds move, or the participants must resolve the dispute before approving a full payout.'
          : 'A mutual refund proposal is still open. Resolve the refund proposal before approving a full payout.'
      );
    }
  }

  await resolveOpenMilestoneDisputes(milestone.id);
  await transitionMilestoneStatus(milestone.id, 'APPROVED');
  await transitionStatus(agreementId, 'APPROVED');
  await setAgreementSettlementState(agreementId, {
    settlementStatus: 'FUNDED',
    lastSettlementError: null,
  });

  return getAgreementById(agreementId);
}

export async function recordMilestoneSettlementAttempt(params: {
  agreementId: string;
  milestoneId: string;
  direction: Exclude<SettlementDirection, 'FUNDING'>;
  network: SettlementNetwork;
  amount: string;
  txHash?: string | null;
  paymentReference?: string | null;
  status?: SettlementRecordStatus;
  confirmedAt?: Date | null;
}) {
  const settlement = await createSettlementRecord({
    agreementId: params.agreementId,
    milestoneId: params.milestoneId,
    direction: params.direction,
    network: params.network,
    amount: params.amount,
    txHash: params.txHash,
    paymentReference: params.paymentReference,
    status: params.status ?? 'PENDING',
    confirmedAt: params.confirmedAt ?? null,
  });

  await setAgreementSettlementState(params.agreementId, {
    settlementStatus:
      params.status === 'CONFIRMED'
        ? confirmedSettlementStatus(params.direction)
        : pendingSettlementStatus(params.direction),
    ckbTxHashRelease: params.txHash ?? null,
    fiberPaymentReference: params.paymentReference ?? null,
    lastSettlementError: null,
  });

  return settlement;
}

export async function recordSplitSettlementConsent(
  agreementId: string,
  actorAddress: string,
  workerAmount: string
) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(agreementId));
  if (isSponsorControlledImportedAgreement(agreement)) {
    throw new Error('Imported grant milestones do not support split dispute settlement.');
  }
  const milestone = getCurrentMilestoneFromAgreement(agreement);

  if (!milestone || milestone.status !== 'DISPUTED') {
    throw new Error('Open a dispute on the current milestone before proposing a split settlement.');
  }

  if (agreement.escrowModel !== 'TREASURY_BRIDGE') {
    throw new Error('Split settlement is currently available only for Treasury Bridge agreements.');
  }

  if (actorAddress !== agreement.clientAddress && actorAddress !== agreement.workerAddress) {
    throw new Error('Only the client or worker can approve a split settlement.');
  }

  const { milestoneAmountValue } = validateSplitWorkerAmount(workerAmount, milestone.amount);

  const dispute = milestone.disputes.find((item: any) => !item.resolvedAt);
  if (!dispute) {
    throw new Error('No open dispute found for the current milestone.');
  }

  const splitConsensus = await buildSplitConsensusForDispute(
    agreementId,
    dispute.id,
    agreement.clientAddress,
    agreement.workerAddress,
    milestone.amount
  );

  if (!splitConsensus.proposedBy && actorAddress !== agreement.clientAddress) {
    throw new Error('Only the client can propose a split settlement.');
  }

  if (splitConsensus.proposedBy && actorAddress === agreement.clientAddress) {
    throw new Error('Split proposal already sent. It is now waiting for the worker to accept it.');
  }

  if (splitConsensus.workerAmount && splitConsensus.workerAmount !== workerAmount) {
    throw new Error('Worker must accept the exact split amount proposed by the client.');
  }

  const actorAlreadyApproved =
    (actorAddress === agreement.clientAddress && splitConsensus.clientApprovedAt)
    || (actorAddress === agreement.workerAddress && splitConsensus.workerApprovedAt);

  if (!actorAlreadyApproved) {
    const clientRefundAmount = (milestoneAmountValue - BigInt(workerAmount)).toString();
    await createAuditLog({
      agreementId,
      actorAddress,
      action: splitConsensus.proposedBy ? 'SPLIT_APPROVED' : 'SPLIT_PROPOSED',
      resourceType: 'DISPUTE',
      resourceId: dispute.id,
      metadata: {
        milestoneId: milestone.id,
        settlement: 'SPLIT',
        workerAmount,
        clientRefundAmount,
      },
    });
  }

  const updatedConsensus = await buildSplitConsensusForDispute(
    agreementId,
    dispute.id,
    agreement.clientAddress,
    agreement.workerAddress,
    milestone.amount
  );

  if (updatedConsensus.fullyApproved && updatedConsensus.workerAmount) {
    return settleCurrentMilestoneSplit(agreementId, updatedConsensus.workerAmount);
  }

  await createLog({
    agreementId,
    level: 'INFO',
    eventType: 'DISPUTE_OPENED',
    message: `Split settlement proposed for milestone ${milestone.sortOrder}: ${milestone.title}`,
    metadata: {
      disputeId: dispute.id,
      milestoneId: milestone.id,
      workerAmount: updatedConsensus.workerAmount,
      clientRefundAmount: updatedConsensus.clientRefundAmount,
      awaitingAddress: updatedConsensus.awaitingAddress,
    },
  });

  await broadcastAgreementUpdateById(agreementId);
  return getAgreementById(agreementId);
}

export async function settleCurrentMilestoneSplit(
  agreementId: string,
  workerAmount: string
) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(agreementId));
  if (isSponsorControlledImportedAgreement(agreement)) {
    throw new Error('Imported grant milestones do not support split dispute settlement.');
  }
  const milestone = getCurrentMilestoneFromAgreement(agreement);

  if (!milestone) {
    throw new Error('No active milestone available to split-settle');
  }

  if (!['DISPUTED', 'UNDER_REVIEW', 'PROOF_SUBMITTED'].includes(milestone.status)) {
    throw new Error('Current milestone cannot be split-settled');
  }

  const { workerAmountValue, clientRefundAmount } = validateSplitWorkerAmount(workerAmount, milestone.amount);

  await resolveOpenMilestoneDisputes(milestone.id);
  await transitionMilestoneStatus(milestone.id, 'APPROVED');
  await transitionStatus(agreementId, 'APPROVED');

  const payoutTransfer = await sendIdempotentSettlementTransfer({
    agreementId,
    milestoneId: milestone.id,
    direction: 'PAYOUT',
    amount: workerAmountValue.toString(),
    destinationAddress: agreement.workerAddress,
    operationSuffix: 'split',
  });
  const refundTransfer = await sendIdempotentSettlementTransfer({
    agreementId,
    milestoneId: milestone.id,
    direction: 'REFUND',
    amount: clientRefundAmount,
    destinationAddress: agreement.clientAddress,
    operationSuffix: 'split',
  });
  const payoutTxHash = payoutTransfer.txHash;
  const refundTxHash = refundTransfer.txHash;

  await setAgreementSettlementState(agreementId, {
    settlementStatus: 'SPLIT_PENDING',
    ckbTxHashRelease: refundTxHash ?? payoutTxHash,
    lastSettlementError: null,
  });

  await createLog({
    agreementId,
    level: 'INFO',
    eventType: 'RELEASE_SENT',
    message: `Split settlement prepared for milestone ${milestone.sortOrder}: ${milestone.title}`,
    metadata: {
      milestoneId: milestone.id,
      workerAmount: workerAmountValue.toString(),
      clientRefundAmount,
      payoutTxHash,
      refundTxHash,
    },
  });

  return getAgreementById(agreementId);
}

export async function refundCurrentMilestone(agreementId: string) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(agreementId));
  if (isSponsorControlledImportedAgreement(agreement)) {
    throw new Error('Imported grant milestones cannot be refunded.');
  }
  const milestone = getCurrentMilestoneFromAgreement(agreement);

  if (!milestone) {
    throw new Error('No active milestone available to refund');
  }

  if (!['ACTIVE', 'UNDER_REVIEW', 'DISPUTED', 'PROOF_SUBMITTED'].includes(milestone.status)) {
    throw new Error('Current milestone cannot be refunded');
  }

  if (agreement.escrowModel !== 'TREASURY_BRIDGE') {
    throw new Error('Refund execution for non-treasury escrow agreements is not enabled in this environment yet.');
  }

  await resolveOpenMilestoneDisputes(milestone.id);
  await transitionMilestoneStatus(milestone.id, 'REFUNDED');

  const refundTransfer = await sendIdempotentSettlementTransfer({
    agreementId,
    milestoneId: milestone.id,
    direction: 'REFUND',
    amount: milestone.amount,
    destinationAddress: agreement.clientAddress,
  });
  const refundTxHash = refundTransfer.txHash;
  await setAgreementSettlementState(agreementId, {
    settlementStatus: 'REFUND_PENDING', ckbTxHashRelease: refundTxHash, lastSettlementError: null,
  });

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

export async function confirmPendingSettlementIfReady(agreementId: string) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(agreementId));
  if (agreement.settlementStatus === 'SPLIT_PENDING') {
    const splitMilestone =
      agreement.milestones.find((milestone: any) =>
        agreement.settlements.some((settlement: any) =>
          settlement.milestoneId === milestone.id && settlement.status === 'PENDING'
        )
      ) || agreement.milestones.find((milestone: any) => milestone.status === 'APPROVED');

    if (!splitMilestone) {
      return getAgreementById(agreementId);
    }

    const pendingSplitSettlements = agreement.settlements.filter((settlement: any) =>
      settlement.milestoneId === splitMilestone.id && settlement.status === 'PENDING'
    );

    let stillPending = false;
    for (const pendingSettlement of pendingSplitSettlements) {
      if (pendingSettlement.network !== 'CKB' || !pendingSettlement.txHash) {
        stillPending = true;
        continue;
      }

      const destinationAddress =
        pendingSettlement.direction === 'REFUND'
          ? agreement.clientAddress
          : agreement.workerAddress;

      const verification = await verifyFundingTransaction({
        txHash: pendingSettlement.txHash,
        toAddress: destinationAddress,
        expectedAmount: pendingSettlement.amount,
      });

      if (!verification.foundTransaction || verification.status === 'pending' || verification.status === 'proposed') {
        stillPending = true;
        continue;
      }

      if (verification.status === 'committed' && verification.foundMatchingOutput) {
        await markSettlementRecordStatus(pendingSettlement.id, {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          errorMessage: null,
        });
        continue;
      }

      await markSettlementRecordStatus(pendingSettlement.id, {
        status: 'FAILED',
        confirmedAt: null,
        errorMessage: 'Split settlement verification failed on-chain.',
      });

      await setAgreementSettlementState(agreementId, {
        settlementStatus: 'FAILED',
        lastSettlementError: 'Split settlement verification failed. At least one expected output was not found on-chain.',
      });

      await createLog({
        agreementId,
        level: 'ERROR',
        eventType: 'ERROR',
        message: 'Split settlement verification failed because one expected output was not found on-chain',
        metadata: {
          settlementId: pendingSettlement.id,
          txHash: pendingSettlement.txHash,
          blockHash: verification.blockHash,
          rpcStatus: verification.status,
          direction: pendingSettlement.direction,
        },
      });

      return getAgreementById(agreementId);
    }

    if (stillPending) {
      return null;
    }

    const updatedAgreement = await completeApprovedMilestone(agreementId, {
      finalSettlementStatus: 'SPLIT_CONFIRMED',
    });
    await createLog({
      agreementId,
      level: 'SUCCESS',
      eventType: 'SETTLEMENT_CONFIRMED',
      message: 'Split settlement confirmed on-chain',
      metadata: {
        milestoneId: splitMilestone.id,
      },
    });
    return updatedAgreement;
  }

  const pendingSettlement = agreement.settlements.find((settlement: any) => settlement.status === 'PENDING');

  if (!pendingSettlement) {
    return null;
  }

  if (pendingSettlement.direction === 'FUNDING') {
    return confirmFundingIfReady(agreementId);
  }

  if (pendingSettlement.network !== 'CKB' || !pendingSettlement.txHash) {
    return null;
  }

  const destinationAddress =
    pendingSettlement.direction === 'REFUND'
      ? agreement.clientAddress
      : agreement.workerAddress;
  const verification = await verifyFundingTransaction({
    txHash: pendingSettlement.txHash,
    toAddress: destinationAddress,
    expectedAmount: pendingSettlement.amount,
  });

  if (!verification.foundTransaction || verification.status === 'pending' || verification.status === 'proposed') {
    return null;
  }

  if (verification.status === 'committed' && verification.foundMatchingOutput) {
    const confirmedAt = new Date();
    await markSettlementRecordStatus(pendingSettlement.id, {
      status: 'CONFIRMED',
      confirmedAt,
      errorMessage: null,
    });

    await setAgreementSettlementState(agreementId, {
      settlementStatus: confirmedSettlementStatus(pendingSettlement.direction as SettlementDirection),
      ckbTxHashRelease: pendingSettlement.txHash,
      fiberPaymentReference: pendingSettlement.paymentReference,
      lastSettlementError: null,
    });

    if (pendingSettlement.direction === 'PAYOUT') {
      if (!pendingSettlement.milestoneId) {
        await createLog({
          agreementId,
          level: 'SUCCESS',
          eventType: 'SETTLEMENT_CONFIRMED',
          message: 'Commencement payout confirmed on-chain',
          metadata: {
            settlementId: pendingSettlement.id,
            txHash: pendingSettlement.txHash,
            blockHash: verification.blockHash,
            trigger: 'COMMENCEMENT_AUTO_RELEASE',
          },
        });
        return getAgreementById(agreementId);
      }

      const updatedAgreement = await completeApprovedMilestone(agreementId);
      await createLog({
        agreementId,
        level: 'SUCCESS',
        eventType: 'SETTLEMENT_CONFIRMED',
        message: pendingSettlement.milestoneId
          ? `Milestone payout confirmed on-chain`
          : 'Agreement payout confirmed on-chain',
        metadata: {
          settlementId: pendingSettlement.id,
          txHash: pendingSettlement.txHash,
          blockHash: verification.blockHash,
          finalAgreementStatus: updatedAgreement?.status,
        },
      });
      return updatedAgreement;
    }

    await createLog({
      agreementId,
      level: 'SUCCESS',
      eventType: 'SETTLEMENT_CONFIRMED',
      message: 'Refund confirmed on-chain',
      metadata: {
        settlementId: pendingSettlement.id,
        txHash: pendingSettlement.txHash,
        blockHash: verification.blockHash,
      },
    });

    return getAgreementById(agreementId);
  }

  await markSettlementRecordStatus(pendingSettlement.id, {
    status: 'FAILED',
    confirmedAt: null,
    errorMessage: 'Settlement verification failed on-chain.',
  });

  await setAgreementSettlementState(agreementId, {
    settlementStatus: 'FAILED',
    lastSettlementError: 'Settlement verification failed. The expected payout or refund output was not found.',
  });

  await createLog({
    agreementId,
    level: 'ERROR',
    eventType: 'ERROR',
    message: 'Settlement verification failed because the expected output was not found on-chain',
    metadata: {
      settlementId: pendingSettlement.id,
      txHash: pendingSettlement.txHash,
      blockHash: verification.blockHash,
      rpcStatus: verification.status,
      direction: pendingSettlement.direction,
    },
  });

  return getAgreementById(agreementId);
}

export async function reconcileAgreementSettlement(agreementId: string) {
  const agreement = await fetchAgreementOrThrow(agreementId);

  if (
    agreement.status === 'DRAFT' &&
    agreement.ckbTxHashFund &&
    ['FUNDING_PENDING', 'FAILED'].includes(agreement.settlementStatus)
  ) {
    return confirmFundingIfReady(agreementId);
  }

  if (['PAYOUT_PENDING', 'REFUND_PENDING', 'SPLIT_PENDING'].includes(agreement.settlementStatus)) {
    return confirmPendingSettlementIfReady(agreementId);
  }

  if (agreement.escrowModel === 'ONCHAIN_LOCK') {
    const hydrated = await ensureAgreementMilestones(agreement);
    const recovered = await reconcileSpentOnchainMilestoneCell(agreementId, hydrated);
    if (recovered) {
      return recovered;
    }
  }

  return getAgreementById(agreementId);
}

export async function retryFailedSettlement(agreementId: string) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(agreementId));

  if (agreement.escrowModel !== 'TREASURY_BRIDGE') {
    throw new Error('Retry handling is currently available only for Treasury Bridge agreements.');
  }

  if (agreement.settlementStatus !== 'FAILED') {
    throw new Error('Only failed settlements can be retried.');
  }

  const failedSettlements = agreement.settlements.filter((settlement: any) => settlement.status === 'FAILED');
  if (!failedSettlements.length) {
    throw new Error('No failed settlement attempts were found for this agreement.');
  }

  const latestFailure = failedSettlements[0];
  const relatedFailures = failedSettlements.filter((settlement: any) =>
    settlement.milestoneId === latestFailure.milestoneId &&
    ['PAYOUT', 'REFUND'].includes(settlement.direction)
  );

  for (const settlement of relatedFailures) {
    const destinationAddress =
      settlement.direction === 'REFUND'
        ? agreement.clientAddress
        : agreement.workerAddress;
    await sendIdempotentSettlementTransfer({
      agreementId,
      milestoneId: settlement.milestoneId,
      direction: settlement.direction,
      amount: settlement.amount,
      destinationAddress,
      operationSuffix: `retry:${settlement.id}`,
    });
  }

  await setAgreementSettlementState(agreementId, {
    settlementStatus: relatedFailures.length > 1 ? 'SPLIT_PENDING' : pendingSettlementStatus(relatedFailures[0].direction as SettlementDirection),
    lastSettlementError: null,
  });

  await createLog({
    agreementId,
    level: 'INFO',
    eventType: 'RELEASE_PREPARED',
    message: 'Retrying failed settlement attempts for the current milestone',
    metadata: {
      milestoneId: latestFailure.milestoneId,
      directions: relatedFailures.map((settlement: any) => settlement.direction),
    },
  });

  return getAgreementById(agreementId);
}

export async function completeApprovedMilestone(
  agreementId: string,
  options?: { finalSettlementStatus?: string }
) {
  const agreement = await ensureAgreementMilestones(await fetchAgreementOrThrow(agreementId));
  const milestone = agreement.milestones.find((item: any) => item.status === 'APPROVED');

  if (!milestone) {
    if (['FUNDED', 'PAID', 'REFUNDED'].includes(agreement.status)) {
      return agreement;
    }

    throw new Error('No approved milestone available for settlement');
  }

  await transitionMilestoneStatus(milestone.id, 'PAID');

  const remainingMilestones = agreement.milestones.filter((item: any) => item.sortOrder > milestone.sortOrder);
  const nextPendingMilestone = remainingMilestones.find((item: any) => item.status === 'PENDING');

  if (nextPendingMilestone) {
    await transitionStatus(agreementId, 'FUNDED');
    await transitionMilestoneStatus(nextPendingMilestone.id, 'ACTIVE');
    await setAgreementSettlementState(agreementId, {
      settlementStatus: 'FUNDED',
      lastSettlementError: null,
    });

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
    const reserveRemaining = BigInt(agreement.reserveCkbRemaining || '0');
    const existingReserveRefund = agreement.settlements.find((settlement: any) =>
      settlement.direction === 'REFUND'
      && settlement.milestoneId == null
      && ['PENDING', 'CONFIRMED'].includes(settlement.status)
    );

    if (isUsdEquivalentImportedGrant(agreement) && reserveRemaining > BigInt(0) && !existingReserveRefund) {
      const reserveRefund = await sendIdempotentSettlementTransfer({
        agreementId,
        milestoneId: null,
        direction: 'REFUND',
        amount: reserveRemaining.toString(),
        destinationAddress: agreement.clientAddress,
        operationSuffix: 'unused-reserve',
      });
      const refundTxHash = reserveRefund.txHash;
      await prisma.agreement.update({
        where: { id: agreementId },
        data: {
          reserveCkbRemaining: '0',
        },
      });
      await setAgreementSettlementState(agreementId, {
        settlementStatus: 'REFUND_PENDING',
        ckbTxHashRelease: refundTxHash,
        lastSettlementError: null,
      });
      await createLog({
        agreementId,
        level: 'INFO',
        eventType: 'RELEASE_SENT',
        message: 'Returning leftover imported grant reserve to the client',
        metadata: {
          amount: reserveRemaining.toString(),
          txHash: refundTxHash,
          trigger: 'IMPORTED_GRANT_RESERVE_CLOSEOUT',
        },
      });
    } else {
      await setAgreementSettlementState(agreementId, {
        settlementStatus: options?.finalSettlementStatus || 'PAYOUT_CONFIRMED',
        lastSettlementError: null,
      });
    }
  }

  return getAgreementById(agreementId);
}

export async function getAgreements(address?: string, limit = 50, cursor?: string) {
  const agreements = await prisma.agreement.findMany({
    where: address
      ? {
          OR: [
            { clientAddress: address },
            { workerAddress: address },
            {
              source: {
                is: {
                  createdByAddress: address,
                },
              },
            },
          ],
        }
      : undefined,
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100) + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: agreementListInclude,
  });

  const page = agreements.slice(0, Math.min(Math.max(limit, 1), 100));
  const hydrated = await Promise.all(page.map((agreement) => ensureAgreementMilestones(agreement)));
  return {
    data: hydrated.map((agreement) => toJsonSafe(agreement)),
    pagination: { limit, cursor: agreements.length > page.length ? page[page.length - 1]?.id ?? null : null },
  };
}

export async function getAgreementById(id: string) {
  const agreement = await prisma.agreement.findUnique({
    where: { id },
    include: agreementDetailInclude,
  });

  if (!agreement) {
    return null;
  }

  const hydratedAgreement = await clearImportedGrantReserveAttentionIfRecovered(
    await ensureAgreementMilestones(agreement),
  );
  const decoratedAgreement = await decorateAgreementWithRefundConsensus(hydratedAgreement);
  return toJsonSafe(decoratedAgreement);
}

export async function getAgreementParticipantById(id: string) {
  return prisma.agreement.findUnique({
    where: { id },
    select: {
      id: true,
      clientAddress: true,
      workerAddress: true,
      arbitratorAddress: true,
      source: {
        select: {
          sourceType: true,
        },
      },
    },
  });
}
