import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../../db';
import { config } from '../../config';
import { tenantContext } from '../../common/tenancy/tenant-context';
import { conflict, invalidRequest, notFound } from '../../common/errors/app-error';
import {
  assertCurrencyMatchesAgreement,
  assertEscrowAmountWithinScope,
} from '../../common/amounts/financial-invariants';
import { assertLifecycleCompareAndSwap } from '../../common/lifecycle/compare-and-swap';
import { activeScopeConflicts, ckbBroadcastFailures, ckbReorgs } from '../../common/observability/metrics';
import {
  clearPendingIdempotentRequest,
  getIdempotencyReplay,
  idempotentTransactionOptions,
  isUniqueConstraintError,
  reserveIdempotentRequest,
  storeIdempotentResponse,
  type IdempotencyContext,
} from '../../common/idempotency/idempotency.service';
import { createInfrastructureAuditLog } from '../audit-logs/audit-log.repository';
import { findAgreementForApp, transitionAgreementStatus } from '../agreements/agreement.repository';
import { canTransitionAgreement, isAgreementStatus, type InfrastructureAgreementStatus } from '../agreements/agreement.state-machine';
import { MILESTONE_EVENTS } from '../milestones/milestone.events';
import { findMilestoneForApp, transitionMilestoneStatus } from '../milestones/milestone.repository';
import { canTransitionMilestone, isMilestoneStatus } from '../milestones/milestone.state-machine';
import { createEvent } from '../events/event.repository';
import { createTransaction, updateTransaction } from '../transactions/transaction.repository';
import { findResolvedReleaseDisputeForEscrowScope } from '../disputes/dispute.repository';
import { enqueueJob } from '../../services/jobQueueService';
import { serializeEscrow, type EscrowRecord } from './escrow.model';
import { ESCROW_EVENTS } from './escrow.events';
import {
  assertEscrowTransition,
  isEscrowStatus,
  type EscrowStatus,
} from './escrow.state-machine';
import { getEscrowAdapter } from './adapters';
import type { EscrowAdapterResult } from './adapters/escrow-adapter.interface';
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

  await transitionMilestoneStatus(
    tenantContext(params.appId), params.milestoneId, milestone.status, params.toStatus, params.tx,
  );

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
    await transitionAgreementStatus(
      tenantContext(params.appId), params.agreementId, agreement.status, 'release_pending', params.tx,
    );
    await transitionAgreementStatus(
      tenantContext(params.appId), params.agreementId, 'release_pending', 'released', params.tx,
    );
    return;
  }

  if (canTransitionAgreement(agreement.status, targetStatus)) {
    await transitionAgreementStatus(
      tenantContext(params.appId), params.agreementId, agreement.status, targetStatus, params.tx,
    );
  }
}

async function transitionFundingScope(params: {
  appId: string;
  escrow: EscrowRecord;
  tx: Prisma.TransactionClient;
}) {
  await createEvent(tenantContext(params.appId), {type: ESCROW_EVENTS.funded,
    agreementId: params.escrow.agreementId,
    milestoneId: params.escrow.milestoneId,
    escrowId: params.escrow.id,
    payload: { escrow: serializeEscrow(params.escrow) },
  }, params.tx);
  const agreement = await findAgreementForApp(tenantContext(params.appId), params.escrow.agreementId, params.tx);
  if (agreement && isAgreementStatus(agreement.status) && agreement.status === 'funding_required') {
    await transitionAgreementStatus(
      tenantContext(params.appId), params.escrow.agreementId, agreement.status, 'funded', params.tx,
    );
  }
  if (params.escrow.milestoneId) {
    const milestone = await findMilestoneForApp(tenantContext(params.appId), params.escrow.milestoneId, params.tx);
    if (milestone && ['pending', 'funding_required'].includes(milestone.status)) {
      await transitionMilestoneStatus(
        tenantContext(params.appId), params.escrow.milestoneId, milestone.status, 'funded', params.tx,
      );
      await createEvent(tenantContext(params.appId), {type: MILESTONE_EVENTS.funded,
        agreementId: params.escrow.agreementId,
        milestoneId: params.escrow.milestoneId,
        escrowId: params.escrow.id,
        payload: { milestoneId: params.escrow.milestoneId, escrowId: params.escrow.id },
      }, params.tx);
    }
  }
}

async function assertEscrowAgreementScope(appId: string, input: CreateEscrowInput, tx: Prisma.TransactionClient) {
  const agreement = await findAgreementForApp(tenantContext(appId), input.agreementId, tx);
  if (!agreement) {
    throw notFound('Agreement not found.', 'agreement_not_found');
  }

  let scopeAmount = agreement.amount;
  let scope: 'agreement' | 'milestone' = 'agreement';
  let milestone: Awaited<ReturnType<typeof findMilestoneForApp>> = null;
  if (input.milestoneId) {
    milestone = await findMilestoneForApp(tenantContext(appId), input.milestoneId, tx);
    if (!milestone || milestone.agreementId !== agreement.id) {
      throw notFound('Milestone not found for agreement.', 'milestone_not_found');
    }
    scopeAmount = milestone.amount;
    scope = 'milestone';
  }

  assertCurrencyMatchesAgreement(input.currency, agreement.currency);
  assertEscrowAmountWithinScope({
    escrowAmount: input.amount,
    scopeAmount,
    scope,
    exact: input.rail === 'ckb',
  });

  return { agreement, milestone };
}

function escrowAdapterContext(escrow: {
  id: string;
  amount: string;
  currency: string;
  network: string;
  lockTxHash: string | null;
  lockOutputIndex: number | null;
  lockScriptJson: string | null;
  clientLockScriptJson: string | null;
  workerLockScriptJson: string | null;
  cellData: string | null;
  refundTimeoutSince: string | null;
}) {
  return {
    escrowId: escrow.id,
    amount: escrow.amount,
    currency: escrow.currency,
    network: escrow.network,
    lockTxHash: escrow.lockTxHash,
    lockOutputIndex: escrow.lockOutputIndex,
    lockScriptJson: escrow.lockScriptJson,
    clientLockScriptJson: escrow.clientLockScriptJson,
    workerLockScriptJson: escrow.workerLockScriptJson,
    cellData: escrow.cellData,
    refundTimeoutSince: escrow.refundTimeoutSince,
  };
}

function enqueueCkbReconciliation(
  tx: Prisma.TransactionClient,
  escrow: { appId: string; agreementId: string; rail: string },
  transactionId: string,
) {
  if (escrow.rail !== 'ckb') return Promise.resolve(null);
  return enqueueJob({
    appId: escrow.appId,
    agreementId: escrow.agreementId,
    kind: 'CKB_RECONCILE_TRANSACTION',
    payload: { transactionId },
    dedupeKey: `CKB_RECONCILE_TRANSACTION:${transactionId}`,
    maxAttempts: 100,
  }, tx);
}

type ReservedEscrowCreation = {
  created: EscrowRecord;
  milestoneIndex: number | null;
  transactionId: string;
};

async function reserveEscrowCreation(params: {
  appId: string;
  input: CreateEscrowInput;
  idempotencyContext: IdempotencyContext;
}): Promise<ReservedEscrowCreation> {
  return prisma.$transaction(async (tx) => {
    await reserveIdempotentRequest(params.appId, params.idempotencyContext, tx);
    const scope = await assertEscrowAgreementScope(params.appId, params.input, tx);
    const terminalEscrow = params.input.milestoneId
      ? await escrowRepository.findTerminalEscrowForMilestone(tenantContext(params.appId), params.input.milestoneId, tx)
      : await escrowRepository.findTerminalEscrowForAgreement(tenantContext(params.appId), params.input.agreementId, tx);
    if (terminalEscrow) {
      throw invalidRequest('Cannot create a new escrow after the escrow scope reached a terminal state.', 'escrow_terminal_state_exists');
    }

    const activeEscrow = await escrowRepository.findActiveEscrowForScope(
      tenantContext(params.appId), params.input.agreementId, params.input.milestoneId ?? null, tx,
    );
    if (activeEscrow) {
      activeScopeConflicts.inc({ resource: 'escrow' });
      throw conflict('An active escrow already exists for this settlement scope.', 'active_escrow_exists');
    }

    let created: Awaited<ReturnType<typeof escrowRepository.createEscrow>>;
    try {
      created = await escrowRepository.createEscrow(tenantContext(params.appId), params.input, tx);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        activeScopeConflicts.inc({ resource: 'escrow' });
        throw conflict('An active escrow already exists for this settlement scope.', 'active_escrow_exists');
      }
      throw error;
    }
    const transaction = await createTransaction(tenantContext(params.appId), {
      agreementId: created.agreementId,
      milestoneId: created.milestoneId,
      escrowId: created.id,
      type: 'lock',
      rail: created.rail,
      network: created.network,
      status: 'pending',
      operationId: `escrow:${created.id}:lock`,
      amount: created.amount,
      currency: created.currency,
      rawPayload: { operation: 'createEscrowLock', status: 'reserved' },
    }, tx);
    return { created, milestoneIndex: scope.milestone?.sortOrder ?? null, transactionId: transaction.id };
  }, idempotentTransactionOptions);
}

async function discardEscrowCreation(
  appId: string,
  reserved: ReservedEscrowCreation,
  context: IdempotencyContext,
) {
  await prisma.$transaction(async (tx) => {
    await tx.transaction.deleteMany({ where: { id: reserved.transactionId, appId } });
    await tx.escrow.deleteMany({ where: { id: reserved.created.id, appId, status: 'not_created' } });
    await tx.idempotencyKey.deleteMany({
      where: { appId, key: context.key, requestHash: context.requestHash, status: 'pending' },
    });
  }, idempotentTransactionOptions);
}

async function finalizeEscrowCreation(params: {
  req: Request;
  appId: string;
  reserved: ReservedEscrowCreation;
  idempotencyContext: IdempotencyContext;
  adapterResult: EscrowAdapterResult;
}) {
  return prisma.$transaction(async (tx) => {
    const nextStatus = assertStatus(params.adapterResult.status);
    assertEscrowTransition('not_created', nextStatus);
    const created = params.reserved.created;
    const transition = await escrowRepository.transitionEscrowStatus(tenantContext(params.appId), created.id, 'not_created', {
      status: nextStatus,
      lockAddress: params.adapterResult.lockAddress ?? null,
      lockTxHash: params.adapterResult.txHash ?? null,
      lockOutputIndex: params.adapterResult.lockOutputIndex ?? null,
      lockScriptJson: params.adapterResult.lockScript ? JSON.stringify(params.adapterResult.lockScript) : null,
      clientLockScriptJson: params.adapterResult.clientLockScript
        ? JSON.stringify(params.adapterResult.clientLockScript)
        : created.clientLockScriptJson,
      workerLockScriptJson: params.adapterResult.workerLockScript
        ? JSON.stringify(params.adapterResult.workerLockScript)
        : created.workerLockScriptJson,
      cellData: params.adapterResult.cellData ?? null,
      contractVersion: params.adapterResult.contractVersion ?? null,
      refundTimeoutSince: params.adapterResult.refundTimeoutSince ?? created.refundTimeoutSince,
    }, tx);
    assertLifecycleCompareAndSwap({
      resource: 'escrow',
      affectedRows: transition.count,
      expectedStatus: 'not_created',
      nextStatus,
    });
    const updated = await escrowRepository.findEscrowForApp(tenantContext(params.appId), created.id, tx);
    if (!updated) throw notFound('Escrow not found after lock creation.', 'escrow_not_found');
    const serialized = serializeEscrow(updated);
    const immediateConfirmation = confirmedForRail(updated.rail, updated.network);

    await updateTransaction(tenantContext(params.appId), params.reserved.transactionId, {
      status: nextStatus === 'reconciliation_required'
        ? 'reconciliation_required'
        : immediateConfirmation ? 'confirmed' : 'broadcast',
      txHash: updated.lockTxHash,
      broadcastAt: updated.lockTxHash ? new Date() : null,
      confirmedAt: immediateConfirmation ? new Date() : null,
      rawPayloadJson: JSON.stringify(params.adapterResult.rawPayload ?? null),
    }, tx);
    await enqueueCkbReconciliation(tx, updated, params.reserved.transactionId);
    await createEvent(tenantContext(params.appId), {type: ESCROW_EVENTS.created,
      agreementId: updated.agreementId,
      milestoneId: updated.milestoneId,
      escrowId: updated.id,
      payload: { escrow: serialized },
    }, tx);
    await auditEscrow(tx, params.req, {
      appId: params.appId,
      agreementId: updated.agreementId,
      escrowId: updated.id,
      action: 'escrow.created',
      after: serialized,
    });
    await storeIdempotentResponse({
      appId: params.appId,
      context: params.idempotencyContext,
      statusCode: 201,
      body: { data: serialized, requestId: params.req.requestId },
    }, tx);
    return serialized;
  }, idempotentTransactionOptions);
}

export async function createEscrowForApp(req: Request, appId: string, input: CreateEscrowInput) {
  const { context, replay } = await getIdempotencyReplay<{ data: ReturnType<typeof serializeEscrow>; requestId: string }>(
    req,
    appId,
  );
  if (replay) return replay.body.data;

  const adapter = getEscrowAdapter(input.rail);
  let reserved: ReservedEscrowCreation | null = null;
  let adapterCompleted = false;
  try {
    reserved = await reserveEscrowCreation({ appId, input, idempotencyContext: context });
    const adapterResult = await adapter.createEscrowLock({
      escrowId: reserved.created.id,
      appId: reserved.created.appId,
      agreementId: reserved.created.agreementId,
      milestoneId: reserved.created.milestoneId,
      amount: reserved.created.amount,
      currency: reserved.created.currency,
      rail: reserved.created.rail,
      network: reserved.created.network,
      milestoneIndex: reserved.milestoneIndex,
      clientLockScript: input.clientLockScript,
      workerLockScript: input.workerLockScript,
      refundTimeoutSince: input.refundTimeoutSince ?? null,
    });
    adapterCompleted = true;
    try {
      return await finalizeEscrowCreation({ req, appId, reserved, idempotencyContext: context, adapterResult });
    } catch (finalizationError) {
      try {
        return await finalizeEscrowCreation({ req, appId, reserved, idempotencyContext: context, adapterResult });
      } catch {
        try {
          const { replay: replayAfterFinalize } = await getIdempotencyReplay<{
            data: ReturnType<typeof serializeEscrow>;
            requestId: string;
          }>(req, appId);
          if (replayAfterFinalize) return replayAfterFinalize.body.data;
        } catch {
          // Preserve the original finalization error while the durable reservation remains for reconciliation.
        }
        throw finalizationError;
      }
    }
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const { replay: replayAfterRace } = await getIdempotencyReplay<{ data: ReturnType<typeof serializeEscrow>; requestId: string }>(
        req,
        appId,
      );
      if (replayAfterRace) return replayAfterRace.body.data;
    }
    if (reserved && !adapterCompleted) await discardEscrowCreation(appId, reserved, context);
    throw error;
  }
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
  const { context, replay } = await getIdempotencyReplay<{ data: ReturnType<typeof serializeEscrow>; requestId: string }>(
    req,
    appId,
  );
  if (replay) return replay.body.data;

  let reserved = false;
  try {
    const before = await prisma.$transaction(async (tx) => {
      await reserveIdempotentRequest(appId, context, tx);
      const escrow = await escrowRepository.findEscrowForApp(tenantContext(appId), escrowId, tx);
      if (!escrow) throw notFound('Escrow not found.', 'escrow_not_found');
      const status = assertStatus(escrow.status);
      if (status === 'not_created') {
        throw invalidRequest('Escrow must be created before it can be marked funded.', 'escrow_not_created');
      }
      if (status === 'funded') {
        const serialized = serializeEscrow(escrow);
        await storeIdempotentResponse({
          appId,
          context,
          statusCode: 200,
          body: { data: serialized, requestId: req.requestId },
        }, tx);
      }
      return escrow;
    }, idempotentTransactionOptions);
    reserved = true;
    if (before.status === 'funded') return serializeEscrow(before);

    const adapterResult = await getEscrowAdapter(before.rail).markFunded({
      ...escrowAdapterContext(before),
      txHash: input.txHash,
    });
    return finalizeEscrowFunding({ req, appId, before, idempotencyContext: context, adapterResult });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const { replay: replayAfterRace } = await getIdempotencyReplay<{ data: ReturnType<typeof serializeEscrow>; requestId: string }>(
        req,
        appId,
      );
      if (replayAfterRace) return replayAfterRace.body.data;
    }
    if (reserved) await clearPendingIdempotentRequest(appId, context).catch(() => undefined);
    throw error;
  }
}

async function finalizeEscrowFunding(params: {
  req: Request;
  appId: string;
  before: EscrowRecord;
  idempotencyContext: IdempotencyContext;
  adapterResult: EscrowAdapterResult;
}) {
  return prisma.$transaction(async (tx) => {
    const current = await escrowRepository.findEscrowForApp(tenantContext(params.appId), params.before.id, tx);
    if (!current) throw notFound('Escrow not found.', 'escrow_not_found');
    if (current.status === 'funded') {
      const serialized = serializeEscrow(current);
      await storeIdempotentResponse({
        appId: params.appId,
        context: params.idempotencyContext,
        statusCode: 200,
        body: { data: serialized, requestId: params.req.requestId },
      }, tx);
      return serialized;
    }

    const fromStatus = assertStatus(current.status);
    const nextStatus = assertStatus(params.adapterResult.status);
    if (!['funding_detected', 'funded'].includes(nextStatus)) {
      throw invalidRequest('Funding verification returned an invalid lifecycle status.', 'invalid_funding_status');
    }
    if (fromStatus !== nextStatus) {
      assertEscrowTransition(fromStatus, nextStatus);
      const updateResult = await escrowRepository.transitionEscrowStatus(
        tenantContext(params.appId), current.id, fromStatus,
        { status: nextStatus, lockTxHash: params.adapterResult.txHash ?? current.lockTxHash }, tx,
      );
      assertLifecycleCompareAndSwap({
        resource: 'escrow',
        affectedRows: updateResult.count,
        expectedStatus: fromStatus,
        nextStatus,
      });
    }
    const updated = await escrowRepository.findEscrowForApp(tenantContext(params.appId), current.id, tx);
    if (!updated) throw notFound('Escrow not found after funding.', 'escrow_not_found');
    const serializedBefore = serializeEscrow(current);
    const serializedAfter = serializeEscrow(updated);

    const lockTransaction = await escrowRepository.findTransactionForEscrowType(
      tenantContext(params.appId), updated.id, 'lock', tx,
    );
    if (lockTransaction) {
      await updateTransaction(tenantContext(params.appId), lockTransaction.id, {
        status: nextStatus === 'funded' ? 'confirmed' : 'committed',
        txHash: updated.lockTxHash,
        confirmations: params.adapterResult.confirmations ?? 0,
        blockHash: params.adapterResult.blockHash ?? null,
        blockNumber: params.adapterResult.blockNumber ?? null,
        lastCheckedAt: new Date(),
        confirmedAt: nextStatus === 'funded' ? new Date() : null,
        rawPayloadJson: JSON.stringify(params.adapterResult.rawPayload ?? null),
      }, tx);
    }

    if (nextStatus === 'funded') {
      await transitionFundingScope({ appId: params.appId, escrow: updated, tx });
    }

    await auditEscrow(tx, params.req, {
      appId: params.appId,
      agreementId: updated.agreementId,
      escrowId: updated.id,
      action: nextStatus === 'funded' ? 'escrow.marked_funded' : 'escrow.funding_detected',
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
      operationId: `escrow:${pending.id}:${params.operation}`,
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
    const transition = await escrowRepository.transitionEscrowStatus(
      tenantContext(params.appId), current.id, pendingStatus, { status: 'failed' }, tx,
    );
    assertLifecycleCompareAndSwap({
      resource: 'escrow',
      affectedRows: transition.count,
      expectedStatus: pendingStatus,
      nextStatus: 'failed',
    });
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
    const nextStatus = adapterStatus === 'reconciliation_required'
      ? 'reconciliation_required'
      : immediateConfirmation && adapterStatus === terminalStatus
        ? terminalStatus
        : pendingStatus;

    if (nextStatus !== current.status) {
      assertEscrowTransition(assertStatus(current.status), nextStatus);
    }

    const hashField = settlementHashField(params.operation);
    const transition = await escrowRepository.transitionEscrowStatus(
      tenantContext(params.appId),
      current.id,
      pendingStatus,
      {
        status: nextStatus,
        [hashField]: params.adapterResult.txHash ?? null,
      },
      tx,
    );
    assertLifecycleCompareAndSwap({
      resource: 'escrow',
      affectedRows: transition.count,
      expectedStatus: pendingStatus,
      nextStatus,
    });
    const updated = await escrowRepository.findEscrowForApp(tenantContext(params.appId), current.id, tx);
    if (!updated) throw notFound('Escrow not found after settlement finalization.', 'escrow_not_found');

    const serializedBefore = serializeEscrow(params.reserved.before);
    const serializedAfter = serializeEscrow(updated);

    await updateTransaction(tenantContext(params.appId), params.reserved.transactionId, {
      status: nextStatus === 'reconciliation_required'
        ? 'reconciliation_required'
        : immediateConfirmation ? 'confirmed' : 'broadcast',
      txHash: params.adapterResult.txHash ?? null,
      broadcastAt: params.adapterResult.txHash ? new Date() : null,
      rawPayloadJson: JSON.stringify(params.adapterResult.rawPayload ?? null),
    }, tx);
    await enqueueCkbReconciliation(tx, updated, params.reserved.transactionId);

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
  try {
    reserved = await reserveEscrowSettlement({
      req,
      appId,
      escrowId,
      operation,
      idempotencyContext: context,
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
    throw error;
  }

  const adapter = getEscrowAdapter(reserved.pending.rail);
  let adapterResult: AdapterSettlementResult;
  try {
    adapterResult = operation === 'release'
      ? await adapter.release({ ...escrowAdapterContext(reserved.pending) })
      : await adapter.refund({ ...escrowAdapterContext(reserved.pending) });
  } catch (error) {
    await finalizeFailedEscrowSettlement({
      req,
      appId,
      operation,
      reserved,
      idempotencyContext: context,
      error,
    });
    throw error;
  }

  const finalization = { req, appId, operation, reserved, idempotencyContext: context, adapterResult };
  try {
    return await finalizeSuccessfulEscrowSettlement(finalization);
  } catch (finalizationError) {
    try {
      return await finalizeSuccessfulEscrowSettlement(finalization);
    } catch {
      try {
        const { replay: replayAfterFinalize } = await getIdempotencyReplay<{
          data: ReturnType<typeof serializeEscrow>;
          requestId: string;
        }>(req, appId);
        if (replayAfterFinalize) return replayAfterFinalize.body.data;
      } catch {
        // The pending reservation deliberately remains durable for operator reconciliation.
      }
      throw finalizationError;
    }
  }
}

export function releaseEscrow(req: Request, appId: string, escrowId: string) {
  return executeEscrowSettlement(req, appId, escrowId, 'release');
}

export function refundEscrow(req: Request, appId: string, escrowId: string) {
  return executeEscrowSettlement(req, appId, escrowId, 'refund');
}

type ReconciliationObservation = {
  status: string;
  confirmations?: number;
  blockHash?: string | null;
  blockNumber?: string | null;
  rawPayload?: unknown;
};

function reconciliationEscrowStatus(
  transactionType: string,
  currentStatus: EscrowStatus,
  observationStatus: string,
  reorg: boolean,
): EscrowStatus {
  if (reorg || observationStatus === 'unknown') return 'reconciliation_required';
  if (observationStatus === 'rejected') return 'failed';
  if (transactionType === 'lock') {
    if (observationStatus === 'confirmed') return 'funded';
    if (observationStatus === 'committed') return 'funding_detected';
    return currentStatus === 'reconciliation_required' ? 'awaiting_funding' : currentStatus;
  }
  if (observationStatus === 'confirmed') return transactionType === 'release' ? 'released' : 'refunded';
  if (currentStatus === 'reconciliation_required') {
    return transactionType === 'release' ? 'release_pending' : 'refund_pending';
  }
  return currentStatus;
}

export async function reconcileCkbTransaction(transactionId: string) {
  const snapshot = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: { escrow: true },
  });
  if (!snapshot || snapshot.rail !== 'ckb' || !snapshot.escrow || !snapshot.txHash) {
    throw new Error(`CKB reconciliation transaction ${transactionId} is incomplete.`);
  }
  if (!['lock', 'release', 'refund'].includes(snapshot.type)) {
    throw new Error(`Unsupported CKB reconciliation transaction type: ${snapshot.type}.`);
  }

  const adapter = getEscrowAdapter('ckb');
  const observation: ReconciliationObservation = await adapter.getTransactionStatus({ txHash: snapshot.txHash });
  if (snapshot.type === 'lock' && ['committed', 'confirmed'].includes(observation.status)) {
    await adapter.checkFundingStatus(escrowAdapterContext(snapshot.escrow));
  } else if (['release', 'refund'].includes(snapshot.type) && ['committed', 'confirmed'].includes(observation.status)) {
    await adapter.checkSettlementStatus({
      ...escrowAdapterContext(snapshot.escrow),
      operation: snapshot.type as 'release' | 'refund',
      txHash: snapshot.txHash,
    });
  }

  return prisma.$transaction(async (tx) => {
    const currentTransaction = await tx.transaction.findFirst({
      where: { id: snapshot.id, appId: snapshot.appId },
    });
    const currentEscrow = await escrowRepository.findEscrowForApp(
      tenantContext(snapshot.appId), snapshot.escrow!.id, tx,
    );
    if (!currentTransaction || !currentEscrow) {
      throw new Error(`CKB reconciliation transaction ${transactionId} disappeared.`);
    }
    if (currentTransaction.txHash?.toLowerCase() !== snapshot.txHash!.toLowerCase()) {
      throw conflict('CKB transaction hash changed during reconciliation.', 'ckb_reconciliation_conflict');
    }

    const fromStatus = assertStatus(currentEscrow.status);
    const wasConfirmed = currentTransaction.status === 'confirmed'
      || ['released', 'refunded'].includes(fromStatus);
    const reorg = (wasConfirmed || currentTransaction.status === 'reorged')
      && !['confirmed', 'committed'].includes(observation.status);
    const nextEscrowStatus = reconciliationEscrowStatus(
      currentTransaction.type,
      fromStatus,
      observation.status,
      reorg,
    );
    if (nextEscrowStatus !== fromStatus) {
      assertEscrowTransition(fromStatus, nextEscrowStatus);
      const transition = await escrowRepository.transitionEscrowStatus(
        tenantContext(snapshot.appId), currentEscrow.id, fromStatus, { status: nextEscrowStatus }, tx,
      );
      assertLifecycleCompareAndSwap({
        resource: 'escrow',
        affectedRows: transition.count,
        expectedStatus: fromStatus,
        nextStatus: nextEscrowStatus,
      });
    }

    const transactionStatus = reorg
      ? 'reorged'
      : observation.status === 'unknown' ? 'reconciliation_required' : observation.status;
    const observationPayload = observation.rawPayload && typeof observation.rawPayload === 'object'
      ? observation.rawPayload as { reason?: unknown }
      : null;
    await updateTransaction(tenantContext(snapshot.appId), currentTransaction.id, {
      status: transactionStatus,
      confirmations: observation.confirmations ?? 0,
      blockHash: observation.blockHash ?? null,
      blockNumber: observation.blockNumber ?? null,
      lastCheckedAt: new Date(),
      confirmedAt: observation.status === 'confirmed'
        ? currentTransaction.confirmedAt ?? new Date()
        : reorg ? null : currentTransaction.confirmedAt,
      reconciliationError: typeof observationPayload?.reason === 'string'
        ? observationPayload.reason
        : observation.status === 'unknown' ? 'Transaction was not returned by the configured CKB node.' : null,
      rawPayloadJson: JSON.stringify(observation.rawPayload ?? null),
    }, tx);

    const updatedEscrow = await escrowRepository.findEscrowForApp(
      tenantContext(snapshot.appId), currentEscrow.id, tx,
    );
    if (!updatedEscrow) throw new Error(`Escrow ${currentEscrow.id} disappeared during reconciliation.`);
    const before = serializeEscrow(currentEscrow);
    const after = serializeEscrow(updatedEscrow);

    if (reorg && currentTransaction.status !== 'reorged') {
      ckbReorgs.inc({ type: currentTransaction.type });
      await createEvent(tenantContext(snapshot.appId), {type: ESCROW_EVENTS.reorgDetected,
        agreementId: updatedEscrow.agreementId,
        milestoneId: updatedEscrow.milestoneId,
        escrowId: updatedEscrow.id,
        payload: { transactionId, txHash: currentTransaction.txHash, before, after },
      }, tx);
    } else if (nextEscrowStatus === 'reconciliation_required' && nextEscrowStatus !== fromStatus) {
      await createEvent(tenantContext(snapshot.appId), {type: ESCROW_EVENTS.reconciliationRequired,
        agreementId: updatedEscrow.agreementId,
        milestoneId: updatedEscrow.milestoneId,
        escrowId: updatedEscrow.id,
        payload: { transactionId, txHash: currentTransaction.txHash, before, after },
      }, tx);
    } else if (nextEscrowStatus === 'failed' && nextEscrowStatus !== fromStatus) {
      ckbBroadcastFailures.inc({ outcome: 'rejected' });
      await createEvent(tenantContext(snapshot.appId), {type: ESCROW_EVENTS.failed,
        agreementId: updatedEscrow.agreementId,
        milestoneId: updatedEscrow.milestoneId,
        escrowId: updatedEscrow.id,
        payload: { transactionId, txHash: currentTransaction.txHash, before, after },
      }, tx);
    } else if (nextEscrowStatus === 'funded' && nextEscrowStatus !== fromStatus) {
      await transitionFundingScope({ appId: snapshot.appId, escrow: updatedEscrow, tx });
    } else if (['released', 'refunded'].includes(nextEscrowStatus) && nextEscrowStatus !== fromStatus) {
      const terminalStatus = nextEscrowStatus as 'released' | 'refunded';
      await createEvent(tenantContext(snapshot.appId), {type: terminalStatus === 'released'
        ? ESCROW_EVENTS.released
        : ESCROW_EVENTS.refunded,
      agreementId: updatedEscrow.agreementId,
      milestoneId: updatedEscrow.milestoneId,
      escrowId: updatedEscrow.id,
      payload: { transactionId, txHash: currentTransaction.txHash, escrow: after },
      }, tx);
      if (updatedEscrow.milestoneId) {
        await transitionMilestoneIfAllowed({
          appId: snapshot.appId,
          agreementId: updatedEscrow.agreementId,
          milestoneId: updatedEscrow.milestoneId,
          toStatus: terminalStatus,
          escrowId: updatedEscrow.id,
          tx,
        });
      }
      await transitionAgreementWhenAllEscrowsTerminal({
        appId: snapshot.appId,
        agreementId: updatedEscrow.agreementId,
        toStatus: terminalStatus,
        tx,
      });
    }

    if (nextEscrowStatus !== fromStatus || currentTransaction.status !== transactionStatus) {
      await createInfrastructureAuditLog({
        appId: snapshot.appId,
        agreementId: updatedEscrow.agreementId,
        actorType: 'system',
        actorId: 'ckb-reconciliation-worker',
        action: reorg ? 'escrow.ckb_reorg_detected' : 'escrow.ckb_reconciled',
        targetType: 'escrow',
        targetId: updatedEscrow.id,
        before,
        after,
      }, tx);
    }

    const reorgMonitoringDepth = config.ckbConfirmations + 20;
    const complete = observation.status === 'rejected'
      || (observation.status === 'confirmed' && (observation.confirmations ?? 0) >= reorgMonitoringDepth);
    return { complete, status: transactionStatus, confirmations: observation.confirmations ?? 0 };
  }, idempotentTransactionOptions);
}
