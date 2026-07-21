import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../../db';
import { tenantContext } from '../../common/tenancy/tenant-context';
import { conflict, invalidRequest, notFound } from '../../common/errors/app-error';
import { parsePositiveIntegerAmount } from '../../common/amounts/integer-amount';
import {
  clearPendingIdempotentRequest,
  getIdempotencyReplay,
  idempotentTransactionOptions,
  isUniqueConstraintError,
  reserveIdempotentRequest,
  runIdempotentTransaction,
  storeIdempotentResponse,
  type IdempotencyContext,
} from '../../common/idempotency/idempotency.service';
import { createInfrastructureAuditLog } from '../audit-logs/audit-log.repository';
import { findAgreementForApp, updateAgreementStatus } from '../agreements/agreement.repository';
import { canTransitionAgreement, isAgreementStatus, type InfrastructureAgreementStatus } from '../agreements/agreement.state-machine';
import { MILESTONE_EVENTS } from '../milestones/milestone.events';
import { findMilestoneForApp, updateMilestoneStatus } from '../milestones/milestone.repository';
import { canTransitionMilestone, isMilestoneStatus } from '../milestones/milestone.state-machine';
import { createEvent } from '../events/event.repository';
import { createTransaction, updateTransaction } from '../transactions/transaction.repository';
import { findResolvedReleaseDisputeForEscrowScope } from '../disputes/dispute.repository';
import { serializeEscrow, type EscrowRecord } from './escrow.model';
import { ESCROW_EVENTS } from './escrow.events';
import {
  assertEscrowTransition,
  isEscrowStatus,
  type EscrowStatus,
} from './escrow.state-machine';
import { getEscrowAdapter } from './adapters';
import * as escrowRepository from './escrow.repository';
import type { CreateEscrowInput, EscrowListQuery, MarkFundedInput } from './escrow.validation';

function assertStatus(status: string): EscrowStatus {
  if (!isEscrowStatus(status)) {
    throw invalidRequest(`Unknown escrow status: ${status}.`, 'invalid_escrow_status');
  }

  return status;
}

function confirmedForRail(rail: string, network: string) {
  return (rail === 'mock' || rail === 'manual') && network === 'sandbox';
}

function auditEscrow(tx: Prisma.TransactionClient, req: Request, params: {
  appId: string;
  agreementId: string;
  escrowId: string;
  action: string;
  before?: unknown;
  after?: unknown;
}) {
  return createInfrastructureAuditLog({
    appId: params.appId,
    agreementId: params.agreementId,
    actorType: 'api_key',
    actorId: req.apiKey?.id ?? null,
    action: params.action,
    targetType: 'escrow',
    targetId: params.escrowId,
    before: params.before,
    after: params.after,
    ipAddress: req.ip,
    userAgent: req.header('user-agent') ?? null,
    requestId: req.requestId,
  }, tx);
}

async function transitionMilestoneIfAllowed(params: {
  appId: string;
  agreementId: string;
  milestoneId: string;
  toStatus: 'released' | 'refunded';
  escrowId: string;
  tx: Prisma.TransactionClient;
}) {
  const milestone = await findMilestoneForApp(tenantContext(params.appId), params.milestoneId, params.tx);
  if (!milestone || !isMilestoneStatus(milestone.status)) {
    return;
  }

  if (milestone.status === params.toStatus) {
    return;
  }

  if (!canTransitionMilestone(milestone.status, params.toStatus)) {
    return;
  }

  await updateMilestoneStatus(tenantContext(params.appId), params.milestoneId, params.toStatus, params.tx);

  if (params.toStatus === 'released') {
    await createEvent(tenantContext(params.appId), {type: MILESTONE_EVENTS.released,
      agreementId: params.agreementId,
      milestoneId: params.milestoneId,
      escrowId: params.escrowId,
      payload: {
        milestoneId: params.milestoneId,
        escrowId: params.escrowId,
      },
    }, params.tx);
  }
}

async function transitionAgreementWhenAllEscrowsTerminal(params: {
  appId: string;
  agreementId: string;
  toStatus: Extract<InfrastructureAgreementStatus, 'released' | 'refunded'>;
  tx: Prisma.TransactionClient;
}) {
  const agreement = await findAgreementForApp(tenantContext(params.appId), params.agreementId, params.tx);
  if (!agreement || !isAgreementStatus(agreement.status)) {
    return;
  }

  if (agreement.status === params.toStatus) {
    return;
  }

  const escrows = await escrowRepository.listEscrowsForAgreement(tenantContext(params.appId), params.agreementId, params.tx);
  if (escrows.length === 0 || escrows.some((escrow) => !['released', 'refunded'].includes(escrow.status))) {
    return;
  }

  const allReleased = escrows.every((escrow) => escrow.status === 'released');
  const allRefunded = escrows.every((escrow) => escrow.status === 'refunded');
  const targetStatus = params.toStatus === 'released' && allReleased
    ? 'released'
    : params.toStatus === 'refunded' && allRefunded
      ? 'refunded'
      : null;

  if (!targetStatus) {
    return;
  }

  if (canTransitionAgreement(agreement.status, 'release_pending') && targetStatus === 'released') {
    await updateAgreementStatus(tenantContext(params.appId), params.agreementId, 'release_pending', params.tx);
    await updateAgreementStatus(tenantContext(params.appId), params.agreementId, 'released', params.tx);
    return;
  }

  if (canTransitionAgreement(agreement.status, targetStatus)) {
    await updateAgreementStatus(tenantContext(params.appId), params.agreementId, targetStatus, params.tx);
  }
}

async function assertEscrowAgreementScope(appId: string, input: CreateEscrowInput, tx: Prisma.TransactionClient) {
  const agreement = await findAgreementForApp(tenantContext(appId), input.agreementId, tx);
  if (!agreement) {
    throw notFound('Agreement not found.', 'agreement_not_found');
  }

  if (input.milestoneId) {
    const milestone = await findMilestoneForApp(tenantContext(appId), input.milestoneId, tx);
    if (!milestone || milestone.agreementId !== agreement.id) {
      throw notFound('Milestone not found for agreement.', 'milestone_not_found');
    }
  }

  if (parsePositiveIntegerAmount(input.amount, 'amount') > parsePositiveIntegerAmount(agreement.amount, 'agreement.totalAmount')) {
    throw invalidRequest('Escrow amount cannot exceed agreement totalAmount.', 'escrow_amount_exceeds_agreement');
  }

  return agreement;
}

export async function createEscrowForApp(req: Request, appId: string, input: CreateEscrowInput) {
  return runIdempotentTransaction({
    req,
    appId,
    statusCode: 201,
    responseBody: (result) => ({ data: result, requestId: req.requestId }),
    run: async (tx) => {
    const agreement = await assertEscrowAgreementScope(appId, input, tx);
    const terminalEscrow = input.milestoneId
      ? await escrowRepository.findTerminalEscrowForMilestone(tenantContext(appId), input.milestoneId, tx)
      : await escrowRepository.findTerminalEscrowForAgreement(tenantContext(appId), input.agreementId, tx);
    if (terminalEscrow) {
      throw invalidRequest('Cannot create a new escrow after the escrow scope reached a terminal state.', 'escrow_terminal_state_exists');
    }

    const created = await escrowRepository.createEscrow(tenantContext(appId), input, tx);
    const adapter = getEscrowAdapter(created.rail);
    const adapterResult = await adapter.createEscrowLock({
      escrowId: created.id,
      appId: created.appId,
      agreementId: created.agreementId,
      milestoneId: created.milestoneId,
      amount: created.amount,
      currency: created.currency,
      rail: created.rail,
      network: created.network,
    });
    assertEscrowTransition('not_created', adapterResult.status as EscrowStatus);

    const updated = await escrowRepository.updateEscrow(tenantContext(appId), created.id, {
      status: adapterResult.status,
      lockAddress: adapterResult.lockAddress ?? null,
      lockTxHash: adapterResult.txHash ?? null,
    }, tx);
    const serialized = serializeEscrow(updated);

    await createTransaction(tenantContext(appId), { agreementId: updated.agreementId,
      milestoneId: updated.milestoneId,
      escrowId: updated.id,
      type: 'lock',
      rail: updated.rail,
      network: updated.network,
      status: confirmedForRail(updated.rail, updated.network) ? 'confirmed' : 'pending',
      txHash: updated.lockTxHash,
      amount: updated.amount,
      currency: updated.currency,
      rawPayload: adapterResult.rawPayload,
    }, tx);

    await createEvent(tenantContext(appId), {type: ESCROW_EVENTS.created,
      agreementId: updated.agreementId,
      milestoneId: updated.milestoneId,
      escrowId: updated.id,
      payload: { escrow: serialized },
    }, tx);

    await auditEscrow(tx, req, {
      appId,
      agreementId: updated.agreementId,
      escrowId: updated.id,
      action: 'escrow.created',
      after: serialized,
    });

    return serialized;
    },
  });
}

export async function listEscrowsForApp(appId: string, query: EscrowListQuery) {
  const escrows = await escrowRepository.listEscrowsForApp(tenantContext(appId), query);
  const hasMore = escrows.length > query.limit;
  const data = escrows.slice(0, query.limit);

  return {
    data: data.map(serializeEscrow),
    pagination: {
      limit: query.limit,
      cursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    },
  };
}

export async function getEscrowForApp(appId: string, escrowId: string) {
  const escrow = await escrowRepository.findEscrowForApp(tenantContext(appId), escrowId);
  if (!escrow) {
    throw notFound('Escrow not found.', 'escrow_not_found');
  }

  return serializeEscrow(escrow);
}

export async function markEscrowFunded(req: Request, appId: string, escrowId: string, input: MarkFundedInput) {
  const escrow = await prisma.$transaction(async (tx) => {
    const before = await escrowRepository.findEscrowForApp(tenantContext(appId), escrowId, tx);
    if (!before) {
      throw notFound('Escrow not found.', 'escrow_not_found');
    }

    const fromStatus = assertStatus(before.status);
    if (fromStatus === 'funded') {
      return before;
    }

    if (fromStatus === 'not_created') {
      throw invalidRequest('Escrow must be created before it can be marked funded.', 'escrow_not_created');
    }

    assertEscrowTransition(fromStatus, 'funded');

    const adapter = getEscrowAdapter(before.rail);
    const adapterResult = await adapter.markFunded({ escrowId, txHash: input.txHash });
    const updated = await escrowRepository.updateEscrow(tenantContext(appId), escrowId, {
      status: 'funded',
      lockTxHash: adapterResult.txHash ?? before.lockTxHash,
    }, tx);
    const serializedBefore = serializeEscrow(before);
    const serializedAfter = serializeEscrow(updated);

    await createTransaction(tenantContext(appId), { agreementId: updated.agreementId,
      milestoneId: updated.milestoneId,
      escrowId: updated.id,
      type: 'manual_adjustment',
      rail: updated.rail,
      network: updated.network,
      status: confirmedForRail(updated.rail, updated.network) ? 'confirmed' : 'pending',
      txHash: updated.lockTxHash,
      amount: updated.amount,
      currency: updated.currency,
      rawPayload: adapterResult.rawPayload,
    }, tx);

    await createEvent(tenantContext(appId), {type: ESCROW_EVENTS.funded,
      agreementId: updated.agreementId,
      milestoneId: updated.milestoneId,
      escrowId: updated.id,
      payload: { escrow: serializedAfter },
    }, tx);

    const agreement = await findAgreementForApp(tenantContext(appId), updated.agreementId, tx);
    if (agreement && isAgreementStatus(agreement.status) && agreement.status === 'funding_required') {
      await updateAgreementStatus(tenantContext(appId), updated.agreementId, 'funded', tx);
    }

    if (updated.milestoneId) {
      const milestone = await findMilestoneForApp(tenantContext(appId), updated.milestoneId, tx);
      if (milestone && ['pending', 'funding_required'].includes(milestone.status)) {
        await updateMilestoneStatus(tenantContext(appId), updated.milestoneId, 'funded', tx);
        await createEvent(tenantContext(appId), {type: MILESTONE_EVENTS.funded,
          agreementId: updated.agreementId,
          milestoneId: updated.milestoneId,
          escrowId: updated.id,
          payload: {
            milestoneId: updated.milestoneId,
            escrowId: updated.id,
          },
        }, tx);
      }
    }

    await auditEscrow(tx, req, {
      appId,
      agreementId: updated.agreementId,
      escrowId,
      action: 'escrow.marked_funded',
      before: serializedBefore,
      after: serializedAfter,
    });

    return updated;
  });

  return serializeEscrow(escrow);
}

async function assertReleaseAllowed(
  appId: string,
  escrow: { status: string; agreementId: string; milestoneId: string | null },
  agreement: { status: string } | null,
  milestone: { status: string } | null,
  tx: Prisma.TransactionClient,
) {
  if (escrow.status !== 'funded') {
    throw invalidRequest('Escrow release requires funded status.', 'escrow_not_funded');
  }

  if (!agreement || !isAgreementStatus(agreement.status)) {
    throw invalidRequest('Escrow release requires an infrastructure agreement.', 'agreement_not_infrastructure_managed');
  }

  if (agreement.status === 'approved' && (!escrow.milestoneId || milestone?.status === 'approved')) {
    return;
  }

  if (agreement.status === 'disputed') {
    const resolvedReleaseDispute = await findResolvedReleaseDisputeForEscrowScope(
      appId,
      escrow.agreementId,
      escrow.milestoneId,
      tx,
    );
    if (resolvedReleaseDispute) {
      return;
    }
  }

  if (agreement.status === 'released') {
    throw invalidRequest('Escrow has already been released.', 'escrow_already_released');
  }

  if (agreement.status === 'refunded') {
    throw invalidRequest('Escrow release is forbidden after refund.', 'escrow_already_refunded');
  }

  throw invalidRequest('Escrow release requires proof approval or dispute resolution.', 'escrow_release_not_allowed');
}

function assertRefundAllowed(escrow: { status: string }, agreement: { status: string } | null) {
  if (escrow.status === 'released' || escrow.status === 'release_pending') {
    throw invalidRequest('Escrow refund is forbidden after release.', 'escrow_already_released');
  }

  if (escrow.status !== 'funded') {
    throw invalidRequest('Escrow refund requires funded status.', 'escrow_not_funded');
  }

  if (agreement?.status === 'released') {
    throw invalidRequest('Escrow refund is forbidden after agreement release.', 'agreement_already_released');
  }
}

type EscrowSettlementOperation = 'release' | 'refund';

type ReservedEscrowSettlement = {
  before: EscrowRecord;
  pending: EscrowRecord;
  transactionId: string;
};

type AdapterSettlementResult = {
  status: string;
  txHash?: string | null;
  rawPayload?: unknown;
};

function settlementPendingStatus(operation: EscrowSettlementOperation) {
  return operation === 'release' ? 'release_pending' : 'refund_pending';
}

function settlementTerminalStatus(operation: EscrowSettlementOperation) {
  return operation === 'release' ? 'released' : 'refunded';
}

function settlementPendingEvent(operation: EscrowSettlementOperation) {
  return operation === 'release' ? ESCROW_EVENTS.releasePending : ESCROW_EVENTS.refundPending;
}

function settlementTerminalEvent(operation: EscrowSettlementOperation) {
  return operation === 'release' ? ESCROW_EVENTS.released : ESCROW_EVENTS.refunded;
}

function settlementHashField(operation: EscrowSettlementOperation) {
  return operation === 'release' ? 'releaseTxHash' : 'refundTxHash';
}

function settlementAuditAction(operation: EscrowSettlementOperation) {
  return operation === 'release' ? 'escrow.released' : 'escrow.refunded';
}

function serializeErrorPayload(error: unknown) {
  if (error && typeof error === 'object') {
    const named = error as { name?: unknown; code?: unknown; message?: unknown };
    return {
      name: typeof named.name === 'string' ? named.name : 'Error',
      code: typeof named.code === 'string' ? named.code : undefined,
      message: typeof named.message === 'string' ? named.message : 'Escrow adapter operation failed.',
    };
  }

  return {
    name: 'Error',
    message: 'Escrow adapter operation failed.',
  };
}

async function reserveEscrowSettlement(params: {
  req: Request;
  appId: string;
  escrowId: string;
  operation: EscrowSettlementOperation;
  idempotencyContext: IdempotencyContext;
}) {
  return prisma.$transaction(async (tx) => {
    await reserveIdempotentRequest(params.appId, params.idempotencyContext, tx);

    const before = await escrowRepository.findEscrowForApp(tenantContext(params.appId), params.escrowId, tx);
    if (!before) {
      throw notFound('Escrow not found.', 'escrow_not_found');
    }

    const agreement = await findAgreementForApp(tenantContext(params.appId), before.agreementId, tx);
    if (params.operation === 'release') {
      const milestone = before.milestoneId ? await findMilestoneForApp(tenantContext(params.appId), before.milestoneId, tx) : null;
      await assertReleaseAllowed(params.appId, before, agreement, milestone, tx);
    } else {
      assertRefundAllowed(before, agreement);
    }

    const pendingStatus = settlementPendingStatus(params.operation);
    assertEscrowTransition(assertStatus(before.status), pendingStatus);

    const updateResult = await escrowRepository.transitionEscrowStatus(tenantContext(params.appId), params.escrowId, before.status, {
      status: pendingStatus,
    }, tx);
    if (updateResult.count !== 1) {
      throw conflict(`Escrow ${params.operation} is already processing.`, `escrow_${params.operation}_in_progress`);
    }

    const pending = await escrowRepository.findEscrowForApp(tenantContext(params.appId), params.escrowId, tx);
    if (!pending) {
      throw notFound('Escrow not found after settlement reservation.', 'escrow_not_found');
    }

    const transaction = await createTransaction(tenantContext(params.appId), {agreementId: pending.agreementId,
      milestoneId: pending.milestoneId,
      escrowId: pending.id,
      type: params.operation,
      rail: pending.rail,
      network: pending.network,
      status: 'pending',
      txHash: null,
      amount: pending.amount,
      currency: pending.currency,
      rawPayload: {
        operation: params.operation,
        status: pendingStatus,
        idempotencyKey: params.idempotencyContext.key,
      },
    }, tx);

    const serializedBefore = serializeEscrow(before);
    const serializedPending = serializeEscrow(pending);

    await createEvent(tenantContext(params.appId), {type: settlementPendingEvent(params.operation),
      agreementId: pending.agreementId,
      milestoneId: pending.milestoneId,
      escrowId: pending.id,
      payload: {
        escrow: serializedPending,
        operation: params.operation,
        transactionId: transaction.id,
      },
    }, tx);

    await auditEscrow(tx, params.req, {
      appId: params.appId,
      agreementId: pending.agreementId,
      escrowId: pending.id,
      action: `escrow.${pendingStatus}`,
      before: serializedBefore,
      after: serializedPending,
    });

    return {
      before,
      pending,
      transactionId: transaction.id,
    };
  }, idempotentTransactionOptions);
}

async function finalizeFailedEscrowSettlement(params: {
  req: Request;
  appId: string;
  operation: EscrowSettlementOperation;
  reserved: ReservedEscrowSettlement;
  idempotencyContext: IdempotencyContext;
  error: unknown;
}) {
  return prisma.$transaction(async (tx) => {
    const current = await escrowRepository.findEscrowForApp(tenantContext(params.appId), params.reserved.pending.id, tx);
    if (!current) {
      throw notFound('Escrow not found.', 'escrow_not_found');
    }

    const pendingStatus = settlementPendingStatus(params.operation);
    if (current.status !== pendingStatus) {
      throw conflict(`Escrow ${params.operation} state changed before failure finalization.`, `escrow_${params.operation}_state_changed`);
    }

    assertEscrowTransition(assertStatus(current.status), 'failed');
    await escrowRepository.transitionEscrowStatus(tenantContext(params.appId), current.id, pendingStatus, { status: 'failed' }, tx);
    const failed = await escrowRepository.findEscrowForApp(tenantContext(params.appId), current.id, tx);
    if (!failed) {
      throw notFound('Escrow not found after failure finalization.', 'escrow_not_found');
    }

    const serializedBefore = serializeEscrow(params.reserved.before);
    const serializedAfter = serializeEscrow(failed);
    const errorPayload = serializeErrorPayload(params.error);

    await updateTransaction(tenantContext(params.appId), params.reserved.transactionId, {
      status: 'failed',
      rawPayloadJson: JSON.stringify({
        operation: params.operation,
        adapterError: errorPayload,
      }),
    }, tx);

    await createEvent(tenantContext(params.appId), {type: ESCROW_EVENTS.failed,
      agreementId: failed.agreementId,
      milestoneId: failed.milestoneId,
      escrowId: failed.id,
      payload: {
        escrow: serializedAfter,
        operation: params.operation,
        transactionId: params.reserved.transactionId,
        error: errorPayload,
      },
    }, tx);

    await auditEscrow(tx, params.req, {
      appId: params.appId,
      agreementId: failed.agreementId,
      escrowId: failed.id,
      action: `escrow.${params.operation}_failed`,
      before: serializedBefore,
      after: serializedAfter,
    });

    await storeIdempotentResponse({
      appId: params.appId,
      context: params.idempotencyContext,
      statusCode: 200,
      body: { data: serializedAfter, requestId: params.req.requestId },
    }, tx);

    return serializedAfter;
  }, idempotentTransactionOptions);
}

async function finalizeSuccessfulEscrowSettlement(params: {
  req: Request;
  appId: string;
  operation: EscrowSettlementOperation;
  reserved: ReservedEscrowSettlement;
  idempotencyContext: IdempotencyContext;
  adapterResult: AdapterSettlementResult;
}) {
  return prisma.$transaction(async (tx) => {
    const current = await escrowRepository.findEscrowForApp(tenantContext(params.appId), params.reserved.pending.id, tx);
    if (!current) {
      throw notFound('Escrow not found.', 'escrow_not_found');
    }

    const pendingStatus = settlementPendingStatus(params.operation);
    if (current.status !== pendingStatus) {
      throw conflict(`Escrow ${params.operation} state changed before settlement finalization.`, `escrow_${params.operation}_state_changed`);
    }

    const terminalStatus = settlementTerminalStatus(params.operation);
    const immediateConfirmation = confirmedForRail(current.rail, current.network);
    const adapterStatus = assertStatus(params.adapterResult.status);
    const nextStatus = immediateConfirmation && adapterStatus === terminalStatus
      ? terminalStatus
      : pendingStatus;

    if (nextStatus !== current.status) {
      assertEscrowTransition(assertStatus(current.status), nextStatus);
    }

    const hashField = settlementHashField(params.operation);
    const updated = nextStatus === current.status
      ? await escrowRepository.updateEscrow(tenantContext(params.appId), current.id, {
          [hashField]: params.adapterResult.txHash ?? null,
        }, tx)
      : await escrowRepository.updateEscrow(tenantContext(params.appId), current.id, {
          status: nextStatus,
          [hashField]: params.adapterResult.txHash ?? null,
        }, tx);

    const serializedBefore = serializeEscrow(params.reserved.before);
    const serializedAfter = serializeEscrow(updated);

    await updateTransaction(tenantContext(params.appId), params.reserved.transactionId, {
      status: immediateConfirmation ? 'confirmed' : 'pending',
      txHash: params.adapterResult.txHash ?? null,
      rawPayloadJson: JSON.stringify(params.adapterResult.rawPayload ?? null),
    }, tx);

    if (nextStatus === terminalStatus) {
      await createEvent(tenantContext(params.appId), {type: settlementTerminalEvent(params.operation),
        agreementId: updated.agreementId,
        milestoneId: updated.milestoneId,
        escrowId: updated.id,
        payload: {
          escrow: serializedAfter,
          operation: params.operation,
          transactionId: params.reserved.transactionId,
        },
      }, tx);

      if (updated.milestoneId) {
        await transitionMilestoneIfAllowed({
          appId: params.appId,
          agreementId: updated.agreementId,
          milestoneId: updated.milestoneId,
          toStatus: terminalStatus,
          escrowId: updated.id,
          tx,
        });
      }

      await transitionAgreementWhenAllEscrowsTerminal({
        appId: params.appId,
        agreementId: updated.agreementId,
        toStatus: terminalStatus,
        tx,
      });
    }

    await auditEscrow(tx, params.req, {
      appId: params.appId,
      agreementId: updated.agreementId,
      escrowId: updated.id,
      action: settlementAuditAction(params.operation),
      before: serializedBefore,
      after: serializedAfter,
    });

    await storeIdempotentResponse({
      appId: params.appId,
      context: params.idempotencyContext,
      statusCode: 200,
      body: { data: serializedAfter, requestId: params.req.requestId },
    }, tx);

    return serializedAfter;
  }, idempotentTransactionOptions);
}

async function executeEscrowSettlement(req: Request, appId: string, escrowId: string, operation: EscrowSettlementOperation) {
  const { context, replay } = await getIdempotencyReplay<{ data: ReturnType<typeof serializeEscrow>; requestId: string }>(
    req,
    appId,
  );
  if (replay) {
    return replay.body.data;
  }

  let reserved: ReservedEscrowSettlement | null = null;
  let adapterAttempted = false;
  try {
    reserved = await reserveEscrowSettlement({
      req,
      appId,
      escrowId,
      operation,
      idempotencyContext: context,
    });

    const adapter = getEscrowAdapter(reserved.pending.rail);
    adapterAttempted = true;
    const adapterResult = operation === 'release'
      ? await adapter.release({
          escrowId,
          amount: reserved.pending.amount,
          currency: reserved.pending.currency,
        })
      : await adapter.refund({
          escrowId,
          amount: reserved.pending.amount,
          currency: reserved.pending.currency,
        });

    return finalizeSuccessfulEscrowSettlement({
      req,
      appId,
      operation,
      reserved,
      idempotencyContext: context,
      adapterResult,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const { replay: replayAfterRace } = await getIdempotencyReplay<{ data: ReturnType<typeof serializeEscrow>; requestId: string }>(
        req,
        appId,
      );
      if (replayAfterRace) {
        return replayAfterRace.body.data;
      }
    }

    if (reserved && adapterAttempted) {
      await finalizeFailedEscrowSettlement({
        req,
        appId,
        operation,
        reserved,
        idempotencyContext: context,
        error,
      });
    } else if (reserved) {
      await clearPendingIdempotentRequest(appId, context).catch(() => undefined);
    }

    throw error;
  }
}

export function releaseEscrow(req: Request, appId: string, escrowId: string) {
  return executeEscrowSettlement(req, appId, escrowId, 'release');
}

export function refundEscrow(req: Request, appId: string, escrowId: string) {
  return executeEscrowSettlement(req, appId, escrowId, 'refund');
}
