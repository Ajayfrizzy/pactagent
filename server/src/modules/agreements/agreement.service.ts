import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../../db';
import { invalidRequest, notFound } from '../../common/errors/app-error';
import { runIdempotentTransaction } from '../../common/idempotency/idempotency.service';
import { createInfrastructureAuditLog } from '../audit-logs/audit-log.repository';
import { createEvent } from '../events/event.repository';
import { serializeAgreement } from './agreement.model';
import * as agreementRepository from './agreement.repository';
import type { AgreementListQuery, CreateAgreementInput } from './agreement.validation';
import {
  assertAgreementTransition,
  isAgreementStatus,
  type InfrastructureAgreementStatus,
} from './agreement.state-machine';
import { AGREEMENT_EVENTS, eventTypeForAgreementStatus } from './agreement.events';
import { tenantContext } from '../../common/tenancy/tenant-context';

function assertInfrastructureStatus(status: string): InfrastructureAgreementStatus {
  if (!isAgreementStatus(status)) {
    throw invalidRequest(
      `Agreement is not managed by the infrastructure lifecycle: ${status}.`,
      'invalid_state_transition',
    );
  }

  return status;
}

function auditLifecycleChange(tx: Prisma.TransactionClient, req: Request, params: {
  appId: string;
  agreementId: string;
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
    targetType: 'agreement',
    targetId: params.agreementId,
    before: params.before,
    after: params.after,
    ipAddress: req.ip,
    userAgent: req.header('user-agent') ?? null,
    requestId: req.requestId,
  }, tx);
}

export async function createAgreementForApp(req: Request, appId: string, input: CreateAgreementInput) {
  return runIdempotentTransaction({
    req,
    appId,
    statusCode: 201,
    responseBody: (agreement) => ({
      data: agreement,
      requestId: req.requestId,
    }),
    run: async (tx) => {
      const created = await agreementRepository.createAgreement(tenantContext(appId), input, tx);
      const serialized = serializeAgreement(created);

      await createEvent(tenantContext(appId), {type: AGREEMENT_EVENTS.created,
        agreementId: created.id,
        payload: {
          agreement: serialized,
        },
      }, tx);

      await auditLifecycleChange(tx, req, {
        appId,
        agreementId: created.id,
        action: 'agreement.created',
        after: serialized,
      });

      return serialized;
    },
  });
}

export async function listAgreementsForApp(appId: string, query: AgreementListQuery) {
  const agreements = await agreementRepository.listAgreementsForApp(tenantContext(appId), query);
  const hasMore = agreements.length > query.limit;
  const data = agreements.slice(0, query.limit);

  return {
    data: data.map(serializeAgreement),
    pagination: {
      limit: query.limit,
      cursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    },
  };
}

export async function getAgreementForApp(appId: string, agreementId: string) {
  const agreement = await agreementRepository.findAgreementForApp(tenantContext(appId), agreementId);
  if (!agreement) {
    throw notFound('Agreement not found.', 'agreement_not_found');
  }

  return serializeAgreement(agreement);
}

async function transitionAgreement(req: Request, appId: string, agreementId: string, toStatus: InfrastructureAgreementStatus) {
  const agreement = await prisma.$transaction(async (tx) => {
    const before = await agreementRepository.findAgreementForApp(tenantContext(appId), agreementId, tx);
    if (!before) {
      throw notFound('Agreement not found.', 'agreement_not_found');
    }

    const fromStatus = assertInfrastructureStatus(before.status);
    assertAgreementTransition(fromStatus, toStatus);

    const after = await agreementRepository.updateAgreementStatus(tenantContext(appId), agreementId, toStatus, tx);
    const eventType = eventTypeForAgreementStatus(toStatus);
    const serializedBefore = serializeAgreement(before);
    const serializedAfter = serializeAgreement(after);

    if (eventType) {
      await createEvent(tenantContext(appId), {type: eventType,
        agreementId,
        payload: {
          previousStatus: fromStatus,
          agreement: serializedAfter,
        },
      }, tx);
    }

    await auditLifecycleChange(tx, req, {
      appId,
      agreementId,
      action: 'agreement.status_changed',
      before: serializedBefore,
      after: serializedAfter,
    });

    return after;
  });

  return serializeAgreement(agreement);
}

export async function acceptAgreement(req: Request, appId: string, agreementId: string) {
  return prisma.$transaction(async (tx) => {
    const before = await agreementRepository.findAgreementForApp(tenantContext(appId), agreementId, tx);
    if (!before) {
      throw notFound('Agreement not found.', 'agreement_not_found');
    }

    const fromStatus = assertInfrastructureStatus(before.status);
    assertAgreementTransition(fromStatus, 'pending_acceptance');
    assertAgreementTransition('pending_acceptance', 'accepted');

    await agreementRepository.updateAgreementStatus(tenantContext(appId), agreementId, 'pending_acceptance', tx);
    const accepted = await agreementRepository.updateAgreementStatus(tenantContext(appId), agreementId, 'accepted', tx);
    const serializedBefore = serializeAgreement(before);
    const serializedAfter = serializeAgreement(accepted);

    await createEvent(tenantContext(appId), {type: AGREEMENT_EVENTS.accepted,
      agreementId,
      payload: {
        previousStatus: fromStatus,
        agreement: serializedAfter,
      },
    }, tx);

    await auditLifecycleChange(tx, req, {
      appId,
      agreementId,
      action: 'agreement.status_changed',
      before: serializedBefore,
      after: serializedAfter,
    });

    return serializedAfter;
  });
}

export async function cancelAgreement(req: Request, appId: string, agreementId: string) {
  return transitionAgreement(req, appId, agreementId, 'cancelled');
}

export async function moveAgreementToFundingRequired(req: Request, appId: string, agreementId: string) {
  return transitionAgreement(req, appId, agreementId, 'funding_required');
}
