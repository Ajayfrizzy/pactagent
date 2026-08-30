import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { tenantContext } from '../../common/tenancy/tenant-context';
import { runIdempotentTransaction } from '../../common/idempotency/idempotency.service';
import { isUniqueConstraintError } from '../../common/idempotency/idempotency.service';
import { assertSettlementSplit } from '../../common/amounts/financial-invariants';
import { conflict, invalidRequest, notFound } from '../../common/errors/app-error';
import { activeScopeConflicts } from '../../common/observability/metrics';
import { createInfrastructureAuditLog } from '../audit-logs/audit-log.repository';
import { findAgreementForApp, transitionAgreementStatus } from '../agreements/agreement.repository';
import {
  assertAgreementTransition,
  isAgreementStatus,
  type InfrastructureAgreementStatus,
} from '../agreements/agreement.state-machine';
import { createEvent } from '../events/event.repository';
import { findMilestoneForApp, transitionMilestoneStatus } from '../milestones/milestone.repository';
import { findActiveEscrowForScope } from '../escrows/escrow.repository';
import {
  assertMilestoneTransition,
  isMilestoneStatus,
  type InfrastructureMilestoneStatus,
} from '../milestones/milestone.state-machine';
import { DISPUTE_EVENTS } from './dispute.events';
import { serializeDispute } from './dispute.model';
import * as disputeRepository from './dispute.repository';
import {
  agreementPathForDisputeOpen,
  agreementPathForDisputeResolution,
  assertDisputeResolvable,
  milestonePathForDisputeOpen,
  milestonePathForDisputeResolution,
} from './dispute.state-machine';
import type { CreateDisputeInput, DisputeListQuery, ResolveDisputeInput } from './dispute.validation';

function assertInfrastructureAgreementStatus(status: string): InfrastructureAgreementStatus {
  if (!isAgreementStatus(status)) {
    throw invalidRequest(
      `Agreement is not managed by the infrastructure lifecycle: ${status}.`,
      'invalid_state_transition',
    );
  }

  return status;
}

function assertInfrastructureMilestoneStatus(status: string): InfrastructureMilestoneStatus {
  if (!isMilestoneStatus(status)) {
    throw invalidRequest(
      `Milestone is not managed by the infrastructure lifecycle: ${status}.`,
      'invalid_state_transition',
    );
  }

  return status;
}

async function advanceAgreement(
  appId: string,
  agreementId: string,
  fromStatus: InfrastructureAgreementStatus,
  path: InfrastructureAgreementStatus[],
  tx: Prisma.TransactionClient,
) {
  let current = fromStatus;

  for (const toStatus of path) {
    assertAgreementTransition(current, toStatus);
    await transitionAgreementStatus(tenantContext(appId), agreementId, current, toStatus, tx);
    current = toStatus;
  }
}

async function advanceMilestone(
  appId: string,
  milestoneId: string,
  fromStatus: InfrastructureMilestoneStatus,
  path: InfrastructureMilestoneStatus[],
  tx: Prisma.TransactionClient,
) {
  let current = fromStatus;

  for (const toStatus of path) {
    assertMilestoneTransition(current, toStatus);
    await transitionMilestoneStatus(tenantContext(appId), milestoneId, current, toStatus, tx);
    current = toStatus;
  }
}

function auditDispute(tx: Prisma.TransactionClient, req: Request, params: {
  appId: string;
  agreementId: string;
  disputeId: string;
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
    targetType: 'dispute',
    targetId: params.disputeId,
    before: params.before,
    after: params.after,
    ipAddress: req.ip,
    userAgent: req.header('user-agent') ?? null,
    requestId: req.requestId,
  }, tx);
}

export async function createDisputeForApp(req: Request, appId: string, input: CreateDisputeInput) {
  return runIdempotentTransaction<ReturnType<typeof serializeDispute>>({
    req,
    appId,
    statusCode: 201,
    responseBody: (result) => ({ data: result, requestId: req.requestId }),
    run: async (tx) => {
    const agreement = await findAgreementForApp(tenantContext(appId), input.agreementId, tx);
    if (!agreement) {
      throw notFound('Agreement not found.', 'agreement_not_found');
    }

    const milestone = await findMilestoneForApp(tenantContext(appId), input.milestoneId, tx);
    if (!milestone || milestone.agreementId !== agreement.id) {
      throw notFound('Milestone not found for agreement.', 'milestone_not_found');
    }

    const existing = await disputeRepository.findUnresolvedDisputeForScope(
      appId, agreement.id, milestone.id, tx,
    );
    if (existing) {
      activeScopeConflicts.inc({ resource: 'dispute' });
      throw conflict('An unresolved dispute already exists for this settlement scope.', 'active_dispute_exists');
    }

    const agreementStatus = assertInfrastructureAgreementStatus(agreement.status);
    const milestoneStatus = assertInfrastructureMilestoneStatus(milestone.status);
    const agreementPath = agreementPathForDisputeOpen(agreementStatus);
    const milestonePath = milestonePathForDisputeOpen(milestoneStatus);

    let created: Awaited<ReturnType<typeof disputeRepository.createDispute>>;
    try {
      created = await disputeRepository.createDispute(appId, input, tx);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        activeScopeConflicts.inc({ resource: 'dispute' });
        throw conflict('An unresolved dispute already exists for this settlement scope.', 'active_dispute_exists');
      }
      throw error;
    }
    const serialized = serializeDispute(created);

    await advanceAgreement(appId, agreement.id, agreementStatus, agreementPath, tx);
    await advanceMilestone(appId, milestone.id, milestoneStatus, milestonePath, tx);

    await createEvent(tenantContext(appId), {type: DISPUTE_EVENTS.opened,
      agreementId: agreement.id,
      milestoneId: milestone.id,
      disputeId: created.id,
      payload: {
        dispute: serialized,
      },
    }, tx);

    await auditDispute(tx, req, {
      appId,
      agreementId: agreement.id,
      disputeId: created.id,
      action: 'dispute.opened',
      after: serialized,
    });

    return serialized;
    },
  });
}

export async function listDisputesForApp(appId: string, query: DisputeListQuery) {
  const disputes = await disputeRepository.listDisputesForApp(appId, query);
  const hasMore = disputes.length > query.limit;
  const data = disputes.slice(0, query.limit);

  return {
    data: data.map(serializeDispute),
    pagination: {
      limit: query.limit,
      cursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    },
  };
}

export async function getDisputeForApp(appId: string, disputeId: string) {
  const dispute = await disputeRepository.findDisputeForApp(appId, disputeId);
  if (!dispute) {
    throw notFound('Dispute not found.', 'dispute_not_found');
  }

  return serializeDispute(dispute);
}

export async function resolveDisputeForApp(req: Request, appId: string, disputeId: string, input: ResolveDisputeInput) {
  return runIdempotentTransaction<ReturnType<typeof serializeDispute>>({
    req,
    appId,
    statusCode: 200,
    responseBody: (result) => ({ data: result, requestId: req.requestId }),
    run: async (tx) => {
    const dispute = await disputeRepository.findDisputeForApp(appId, disputeId, tx);
    if (!dispute) {
      throw notFound('Dispute not found.', 'dispute_not_found');
    }

    assertDisputeResolvable(dispute.status);

    const agreement = await findAgreementForApp(tenantContext(appId), dispute.agreementId, tx);
    if (!agreement) {
      throw notFound('Agreement not found.', 'agreement_not_found');
    }

    const milestone = await findMilestoneForApp(tenantContext(appId), dispute.milestoneId, tx);
    if (!milestone || milestone.agreementId !== agreement.id) {
      throw notFound('Milestone not found for dispute.', 'milestone_not_found');
    }

    if (input.resolutionType === 'split') {
      const escrow = await findActiveEscrowForScope(
        tenantContext(appId), agreement.id, milestone.id, tx,
      );
      if (!escrow || escrow.status !== 'funded') {
        throw invalidRequest(
          'Split resolution requires one funded escrow for the disputed milestone.',
          'dispute_funded_escrow_required',
        );
      }
      assertSettlementSplit({
        workerAmount: input.workerAmount!,
        clientAmount: input.clientAmount!,
        settlementAmount: escrow.amount,
      });
    }

    const agreementStatus = assertInfrastructureAgreementStatus(agreement.status);
    const milestoneStatus = assertInfrastructureMilestoneStatus(milestone.status);
    const agreementPath = agreementPathForDisputeResolution(agreementStatus, input.resolutionType);
    const milestonePath = milestonePathForDisputeResolution(milestoneStatus, input.resolutionType);
    const resolved = await disputeRepository.resolveDisputeForApp(appId, disputeId, dispute.status, input, tx);
    const serializedBefore = serializeDispute(dispute);
    const serializedAfter = serializeDispute(resolved);

    await advanceAgreement(appId, agreement.id, agreementStatus, agreementPath, tx);
    await advanceMilestone(appId, milestone.id, milestoneStatus, milestonePath, tx);

    await createEvent(tenantContext(appId), {type: DISPUTE_EVENTS.resolved,
      agreementId: dispute.agreementId,
      milestoneId: dispute.milestoneId,
      disputeId: dispute.id,
      payload: {
        dispute: serializedAfter,
      },
    }, tx);

    await auditDispute(tx, req, {
      appId,
      agreementId: dispute.agreementId,
      disputeId: dispute.id,
      action: 'dispute.resolved',
      before: serializedBefore,
      after: serializedAfter,
    });

    return serializedAfter;
    },
  });
}
