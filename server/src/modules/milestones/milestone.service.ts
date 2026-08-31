import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { sumIntegerAmounts } from '../../common/amounts/integer-amount';
import {
  assertCurrencyMatchesAgreement,
  assertMilestoneAllocationWithinAgreement,
} from '../../common/amounts/financial-invariants';
import { conflict, invalidRequest, notFound } from '../../common/errors/app-error';
import { isUniqueConstraintError, runIdempotentTransaction } from '../../common/idempotency/idempotency.service';
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
  return runIdempotentTransaction({
    req,
    appId,
    statusCode: 201,
    responseBody: (result) => ({ data: result, requestId: req.requestId }),
    run: async (tx) => {
    const locked = await milestoneRepository.lockAgreementForMilestoneAllocation(
      tenantContext(appId), agreementId, tx,
    );
    if (!locked) {
      throw notFound('Agreement not found.', 'agreement_not_found');
    }
    const agreement = await findAgreementForApp(tenantContext(appId), agreementId, tx);
    if (!agreement) {
      throw notFound('Agreement not found.', 'agreement_not_found');
    }

    if (['funded', 'in_progress', 'proof_submitted', 'under_review', 'approved', 'release_pending', 'released', 'refunded', 'disputed'].includes(agreement.status)) {
      throw invalidRequest(
        'Funded agreement terms are immutable; milestones can no longer be added.',
        'funded_agreement_immutable',
      );
    }

    const existingMilestones = await milestoneRepository.getMilestoneAmountSumForAgreement(tenantContext(appId), agreementId, tx);
    const existingTotal = sumIntegerAmounts(existingMilestones.map((item) => item.amount));
    assertMilestoneAllocationWithinAgreement({
      existingTotal,
      proposedAmount: input.amount,
      agreementAmount: agreement.amount,
    });

    const lastMilestone = await milestoneRepository.getNextMilestoneOrder(tenantContext(appId), agreementId, tx);
    const order = input.order ?? ((lastMilestone?.sortOrder ?? 0) + 1);
    const currency = input.currency ?? agreement.currency;
    assertCurrencyMatchesAgreement(currency, agreement.currency);

    let created: Awaited<ReturnType<typeof milestoneRepository.createMilestone>>;
    try {
      created = await milestoneRepository.createMilestone(tenantContext(appId), agreementId, {
        ...input,
        order,
        currency,
      }, tx);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw conflict(
          'A milestone with this externalReferenceId or order already exists for the agreement.',
          'milestone_already_exists',
        );
      }
      throw error;
    }
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

    return serialized;
    },
  });
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
