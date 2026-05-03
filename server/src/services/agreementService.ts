import { createHash, randomUUID } from 'crypto';
import { v4 as uuid } from 'uuid';
import { prisma } from '../db';
import { broadcast } from '../ws';
import {
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
  isOnchainEscrowReady,
} from './onchainEscrowService';
import {
  type ArtifactInput,
  type DisputeResolutionChoice,
  computeContentHash,
  parseDisputeEvidenceBundle,
  serializeDisputeEvidenceBundle,
  serializeProofBundle,
} from './richPayloadService';

const AGREEMENT_VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['FUNDED', 'EXPIRED', 'CANCELLED'],
  CANCELLED: [],
  FUNDED: ['PROOF_SUBMITTED', 'DISPUTED', 'EXPIRED', 'REFUNDED'],
  PROOF_SUBMITTED: ['UNDER_REVIEW', 'DISPUTED', 'EXPIRED'],
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
  PROOF_SUBMITTED: ['UNDER_REVIEW', 'DISPUTED', 'EXPIRED'],
  UNDER_REVIEW: ['APPROVED', 'DISPUTED', 'EXPIRED', 'REFUNDED'],
  APPROVED: ['PAID'],
  PAID: [],
  DISPUTED: ['APPROVED', 'REFUNDED'],
  REFUNDED: [],
  EXPIRED: [],
};

const agreementListInclude = {
  milestones: {
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
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
    },
  });
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
  workerFiberPubkey?: string;
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
    workerFiberPubkey: data.workerFiberPubkey || null,
    deadlineAt: data.deadlineAt,
    disputeWindowSecs: data.disputeWindowSecs,
    proofType: data.proofType,
    reviewerMode: data.reviewerMode,
    releaseMode: data.releaseMode,
    payoutNetwork: data.payoutNetwork,
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
        workerFiberPubkey: data.workerFiberPubkey || null,
        deadlineAt: new Date(data.deadlineAt),
        disputeWindowSecs: data.disputeWindowSecs,
        proofType: data.proofType,
        reviewerMode: data.reviewerMode,
        releaseMode: data.releaseMode,
        payoutNetwork: data.payoutNetwork,
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
    workerFiberPubkey?: string;
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
      payoutNetwork: input.payoutNetwork || null,
      workerFiberPubkey: input.workerFiberPubkey?.trim() || null,
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
      if (amendment.workerFiberPubkey !== null) agreementUpdate.workerFiberPubkey = amendment.workerFiberPubkey;

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
  workerFiberPubkey?: string;
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
  }>;
}) {
  if (!data.milestones.length) {
    throw new Error('At least one milestone is required');
  }

  const clientAddress = normalizeAddress(data.clientAddress);
  const workerAddress = normalizeAddress(data.workerAddress);

  const totalAmount = data.milestones
    .reduce((sum, milestone) => sum + BigInt(milestone.amount), BigInt(0))
    .toString();
  const agreementId = uuid();
  const normalizedMilestones = data.milestones.map((milestone, index) => ({
    title: milestone.title,
    description: milestone.description,
    amount: milestone.amount,
    sortOrder: index + 1,
  }));
  const milestoneDigest = buildMilestoneDigest(normalizedMilestones);
  const agreementDigest = buildAgreementDigest({
    title: data.title,
    description: data.description,
    clientAddress,
    workerAddress,
    workerFiberPubkey: data.workerFiberPubkey || null,
    deadlineAt: data.deadlineAt,
    disputeWindowSecs: data.disputeWindowSecs,
    proofType: data.proofType,
    reviewerMode: data.reviewerMode,
    releaseMode: data.releaseMode,
    payoutNetwork: data.payoutNetwork,
    milestoneDigest,
  });
  const escrowModel = data.escrowModel || 'TREASURY_BRIDGE';

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
  const escrowAddress =
    escrowModel === 'ONCHAIN_LOCK'
      ? onchainDescriptor?.escrowAddress || null
      : await getTreasuryAddress().catch(() => null);

  const agreement = await prisma.agreement.create({
    data: {
      id: agreementId,
      title: data.title,
      description: data.description,
      clientAddress,
      workerAddress,
      arbitratorAddress: null,
      workerFiberPubkey: data.workerFiberPubkey || null,
      amount: totalAmount,
      deadlineAt: new Date(data.deadlineAt),
      disputeWindowSecs: data.disputeWindowSecs,
      proofType: data.proofType,
      reviewerMode: data.reviewerMode,
      releaseMode: data.releaseMode,
      payoutNetwork: data.payoutNetwork,
      escrowModel,
      escrowAddress,
      escrowLockCodeHash: onchainDescriptor?.lockCodeHash || null,
      escrowLockHashType: onchainDescriptor?.lockHashType || null,
      escrowLockArgs: onchainDescriptor?.lockArgs || null,
      agreementDigest,
      milestoneDigest,
      settlementStatus: 'UNFUNDED',
      status: 'DRAFT',
      milestones: {
        create: normalizedMilestones.map((milestone) => ({
          id: uuid(),
          title: milestone.title,
          description: milestone.description,
          amount: milestone.amount,
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

  return agreement;
}

export async function fundAgreement(agreementId: string, txHash: string) {
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

  await prisma.$transaction(async (tx) => {
    await tx.agreement.update({
      where: { id: agreementId },
      data: {
        ckbTxHashFund: txHash,
        escrowAddress,
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
    message: `Funding transaction submitted for on-chain verification: ${txHash}`,
    metadata: {
      txHash,
      escrowAddress,
      agreementDigest: agreement.agreementDigest,
      milestoneDigest: agreement.milestoneDigest,
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
  }>
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
        verification.totalMatchedCapacity >= BigInt(agreement.amount) &&
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
        matchedOutputIndexes: matchedMilestoneOutputs.map((output) => output?.outputIndex ?? null),
      },
    });

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

  if (milestone.status !== 'ACTIVE') {
    throw new Error('Proof can only be submitted for the active milestone');
  }

  const revision = (milestone.proofs?.length || 0) + 1;
  const serializedContent = serializeProofBundle({
    summary: options?.summary,
    primaryText: content,
    artifacts: options?.artifacts,
    revision,
  });
  const hash = contentHash || computeContentHash(serializedContent);

  const proof = await prisma.proof.create({
    data: {
      id: uuid(),
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

  if (params.direction === 'PAYOUT') {
    if (!['UNDER_REVIEW', 'DISPUTED'].includes(milestone.status)) {
      throw new Error('Milestone is not ready for payout settlement');
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
  const milestone = agreement.milestones.find((item: any) => item.id === milestoneId);

  if (!milestone) {
    throw new Error('Milestone not found');
  }

  if (milestone.disputes.some((item: any) => !item.resolvedAt)) {
    throw new Error('This milestone already has an open dispute');
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

  if (!['UNDER_REVIEW', 'DISPUTED'].includes(milestone.status)) {
    throw new Error('Current milestone is not ready for approval');
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

  const workerAmountValue = BigInt(workerAmount);
  const milestoneAmountValue = BigInt(milestone.amount);
  if (workerAmountValue <= BigInt(0) || workerAmountValue >= milestoneAmountValue) {
    throw new Error('Split settlement worker amount must be greater than zero and less than the milestone amount.');
  }

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
    const clientRefundAmount = (milestoneAmountValue - workerAmountValue).toString();
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
  const milestone = getCurrentMilestoneFromAgreement(agreement);

  if (!milestone) {
    throw new Error('No active milestone available to split-settle');
  }

  if (!['DISPUTED', 'UNDER_REVIEW', 'PROOF_SUBMITTED'].includes(milestone.status)) {
    throw new Error('Current milestone cannot be split-settled');
  }

  const workerAmountValue = BigInt(workerAmount);
  const milestoneAmountValue = BigInt(milestone.amount);
  if (workerAmountValue <= BigInt(0) || workerAmountValue >= milestoneAmountValue) {
    throw new Error('Split settlement worker amount must be greater than zero and less than the milestone amount.');
  }

  const clientRefundAmount = (milestoneAmountValue - workerAmountValue).toString();

  await resolveOpenMilestoneDisputes(milestone.id);
  await transitionMilestoneStatus(milestone.id, 'APPROVED');
  await transitionStatus(agreementId, 'APPROVED');

  const payoutTxHash = await sendTreasuryTransfer(agreement.workerAddress, workerAmountValue.toString());
  const refundTxHash = await sendTreasuryTransfer(agreement.clientAddress, clientRefundAmount);

  await createSettlementRecord({
    agreementId,
    milestoneId: milestone.id,
    direction: 'PAYOUT',
    network: 'CKB',
    amount: workerAmountValue.toString(),
    txHash: payoutTxHash,
    status: 'PENDING',
  });

  await createSettlementRecord({
    agreementId,
    milestoneId: milestone.id,
    direction: 'REFUND',
    network: 'CKB',
    amount: clientRefundAmount,
    txHash: refundTxHash,
    status: 'PENDING',
  });

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

  const refundTxHash = await sendTreasuryTransfer(agreement.clientAddress, milestone.amount);
  await recordMilestoneSettlementAttempt({
    agreementId,
    milestoneId: milestone.id,
    direction: 'REFUND',
    network: 'CKB',
    amount: milestone.amount,
    txHash: refundTxHash,
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
    const retryTxHash = await sendTreasuryTransfer(destinationAddress, settlement.amount);
    await createSettlementRecord({
      agreementId,
      milestoneId: settlement.milestoneId,
      direction: settlement.direction,
      network: 'CKB',
      amount: settlement.amount,
      txHash: retryTxHash,
      status: 'PENDING',
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
    await setAgreementSettlementState(agreementId, {
      settlementStatus: options?.finalSettlementStatus || 'PAYOUT_CONFIRMED',
      lastSettlementError: null,
    });
  }

  return getAgreementById(agreementId);
}

export async function getAgreements(address?: string) {
  const agreements = await prisma.agreement.findMany({
    where: address
      ? {
          OR: [
            { clientAddress: address },
            { workerAddress: address },
          ],
        }
      : undefined,
    orderBy: { createdAt: 'desc' },
    include: agreementListInclude,
  });

  const hydrated = await Promise.all(agreements.map((agreement) => ensureAgreementMilestones(agreement)));
  return hydrated.map((agreement) => toJsonSafe(agreement));
}

export async function getAgreementById(id: string) {
  const agreement = await prisma.agreement.findUnique({
    where: { id },
    include: agreementDetailInclude,
  });

  if (!agreement) {
    return null;
  }

  const hydratedAgreement = await ensureAgreementMilestones(agreement);
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
    },
  });
}
