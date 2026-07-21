import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../../db';
import { parsePositiveIntegerAmount, sumIntegerAmounts } from '../../common/amounts/integer-amount';
import { invalidRequest, notFound } from '../../common/errors/app-error';
import { createInfrastructureAuditLog } from '../audit-logs/audit-log.repository';
import { findAgreementForApp } from '../agreements/agreement.repository';
import { createEvent } from '../events/event.repository';
import { MILESTONE_EVENTS } from './milestone.events';
import { serializeMilestone } from './milestone.model';
import * as milestoneRepository from './milestone.repository';
import type { CreateMilestoneInput, MilestoneListQuery } from './milestone.validation';
import { tenantContext } from '../../common/tenancy/tenant-context';

function auditMilestoneCreate(tx: Prisma.TransactionClient, req: Request, params: {
  appId: string;
  agreementId: string;
  milestoneId: string;
  after: unknown;
}) {
  return createInfrastructureAuditLog({
    appId: params.appId,
    agreementId: params.agreementId,
    actorType: 'api_key',
    actorId: req.apiKey?.id ?? null,
    action: 'milestone.created',
    targetType: 'milestone',
    targetId: params.milestoneId,
    after: params.after,
    ipAddress: req.ip,
    userAgent: req.header('user-agent') ?? null,
    requestId: req.requestId,
  }, tx);
}

export async function createMilestoneForAgreement(
  req: Request,
  appId: string,
  agreementId: string,
  input: CreateMilestoneInput,
) {
  const milestone = await prisma.$transaction(async (tx) => {
    const agreement = await findAgreementForApp(tenantContext(appId), agreementId, tx);
    if (!agreement) {
      throw notFound('Agreement not found.', 'agreement_not_found');
    }

    const existingMilestones = await milestoneRepository.getMilestoneAmountSumForAgreement(tenantContext(appId), agreementId, tx);
    const existingTotal = sumIntegerAmounts(existingMilestones.map((item) => item.amount));
    const newAmount = parsePositiveIntegerAmount(input.amount, 'amount');
    const agreementTotal = parsePositiveIntegerAmount(agreement.amount, 'agreement.totalAmount');

    if (existingTotal + newAmount > agreementTotal) {
      throw invalidRequest(
        'The sum of milestone amounts cannot exceed the agreement totalAmount.',
        'milestone_total_exceeds_agreement',
      );
    }

    const lastMilestone = await milestoneRepository.getNextMilestoneOrder(tenantContext(appId), agreementId, tx);
    const order = input.order ?? ((lastMilestone?.sortOrder ?? 0) + 1);
    const currency = input.currency ?? agreement.currency;

    const created = await milestoneRepository.createMilestone(tenantContext(appId), agreementId, {
      ...input,
      order,
      currency,
    }, tx);
    const serialized = serializeMilestone(created);

    await createEvent(tenantContext(appId), {type: MILESTONE_EVENTS.created,
      agreementId,
      milestoneId: created.id,
      payload: {
        milestone: serialized,
      },
    }, tx);

    await auditMilestoneCreate(tx, req, {
      appId,
      agreementId,
      milestoneId: created.id,
      after: serialized,
    });

    return created;
  });

  return serializeMilestone(milestone);
}

export async function listMilestonesForAgreement(appId: string, agreementId: string, query: MilestoneListQuery) {
  const agreement = await findAgreementForApp(tenantContext(appId), agreementId);
  if (!agreement) {
    throw notFound('Agreement not found.', 'agreement_not_found');
  }

  const milestones = await milestoneRepository.listMilestonesForAgreement(tenantContext(appId), agreementId, query);
  const hasMore = milestones.length > query.limit;
  const data = milestones.slice(0, query.limit);

  return {
    data: data.map(serializeMilestone),
    pagination: {
      limit: query.limit,
      cursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    },
  };
}

export async function listMilestonesForApp(appId: string, query: MilestoneListQuery) {
  const milestones = await milestoneRepository.listMilestonesForApp(tenantContext(appId), query);
  const hasMore = milestones.length > query.limit;
  const data = milestones.slice(0, query.limit);

  return {
    data: data.map(serializeMilestone),
    pagination: {
      limit: query.limit,
      cursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    },
  };
}

export async function getMilestoneForApp(appId: string, milestoneId: string) {
  const milestone = await milestoneRepository.findMilestoneForApp(tenantContext(appId), milestoneId);
  if (!milestone) {
    throw notFound('Milestone not found.', 'milestone_not_found');
  }

  return serializeMilestone(milestone);
}
