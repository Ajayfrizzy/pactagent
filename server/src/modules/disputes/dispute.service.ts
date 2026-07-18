import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../../db';
import { runIdempotentTransaction } from '../../common/idempotency/idempotency.service';
import { invalidRequest, notFound } from '../../common/errors/app-error';
import { createInfrastructureAuditLog } from '../audit-logs/audit-log.repository';
import { findAgreementForApp, updateAgreementStatus } from '../agreements/agreement.repository';
import {
  assertAgreementTransition,
  isAgreementStatus,
  type InfrastructureAgreementStatus,
} from '../agreements/agreement.state-machine';
import { createEvent } from '../events/event.repository';
import { findMilestoneForApp, updateMilestoneStatus } from '../milestones/milestone.repository';
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
    await updateAgreementStatus(appId, agreementId, toStatus, tx);
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
    await updateMilestoneStatus(appId, milestoneId, toStatus, tx);
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
  return prisma.$transaction(async (tx) => {
    const agreement = await findAgreementForApp(appId, input.agreementId, tx);
    if (!agreement) {
      throw notFound('Agreement not found.', 'agreement_not_found');
    }

    const milestone = await findMilestoneForApp(appId, input.milestoneId, tx);
    if (!milestone || milestone.agreementId !== agreement.id) {
      throw notFound('Milestone not found for agreement.', 'milestone_not_found');
    }

    const agreementStatus = assertInfrastructureAgreementStatus(agreement.status);
    const milestoneStatus = assertInfrastructureMilestoneStatus(milestone.status);
    const agreementPath = agreementPathForDisputeOpen(agreementStatus);
    const milestonePath = milestonePathForDisputeOpen(milestoneStatus);
    const created = await disputeRepository.createDispute(appId, input, tx);
    const serialized = serializeDispute(created);

    await advanceAgreement(appId, agreement.id, agreementStatus, agreementPath, tx);
    await advanceMilestone(appId, milestone.id, milestoneStatus, milestonePath, tx);

    await createEvent({
      appId,
      type: DISPUTE_EVENTS.opened,
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
  return runIdempotentTransaction({
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

    const agreement = await findAgreementForApp(appId, dispute.agreementId, tx);
    if (!agreement) {
      throw notFound('Agreement not found.', 'agreement_not_found');
    }

    const milestone = await findMilestoneForApp(appId, dispute.milestoneId, tx);
    if (!milestone || milestone.agreementId !== agreement.id) {
      throw notFound('Milestone not found for dispute.', 'milestone_not_found');
    }

    const agreementStatus = assertInfrastructureAgreementStatus(agreement.status);
    const milestoneStatus = assertInfrastructureMilestoneStatus(milestone.status);
    const agreementPath = agreementPathForDisputeResolution(agreementStatus, input.resolutionType);
    const milestonePath = milestonePathForDisputeResolution(milestoneStatus, input.resolutionType);
    const resolved = await disputeRepository.resolveDisputeForApp(appId, disputeId, input, tx);
    const serializedBefore = serializeDispute(dispute);
    const serializedAfter = serializeDispute(resolved);

    await advanceAgreement(appId, agreement.id, agreementStatus, agreementPath, tx);
    await advanceMilestone(appId, milestone.id, milestoneStatus, milestonePath, tx);

    await createEvent({
      appId,
      type: DISPUTE_EVENTS.resolved,
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
