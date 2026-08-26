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
import { MILESTONE_EVENTS } from '../milestones/milestone.events';
import { findMilestoneForApp, updateMilestoneStatus } from '../milestones/milestone.repository';
import {
  assertMilestoneTransition,
  isMilestoneStatus,
  type InfrastructureMilestoneStatus,
} from '../milestones/milestone.state-machine';
import { eventTypeForReviewDecision, PROOF_EVENTS } from './proof.events';
import {
  agreementPathForProofSubmission,
  agreementPathForReviewDecision,
  milestonePathForProofSubmission,
  milestonePathForReviewDecision,
  proofStatusForReviewDecision,
} from './proof.lifecycle';
import { serializeProof } from './proof.model';
import * as proofRepository from './proof.repository';
import * as reviewRepository from '../reviews/review.repository';
import { serializeReview } from '../reviews/review.model';
import type { CreateProofInput, ProofListQuery, ReviewProofInput } from './proof.validation';
import { tenantContext } from '../../common/tenancy/tenant-context';

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
  let updated = null;

  for (const toStatus of path) {
    assertAgreementTransition(current, toStatus);
    updated = await updateAgreementStatus(tenantContext(appId), agreementId, toStatus, tx);
    current = toStatus;
  }

  return updated;
}

async function advanceMilestone(
  appId: string,
  milestoneId: string,
  fromStatus: InfrastructureMilestoneStatus,
  path: InfrastructureMilestoneStatus[],
  tx: Prisma.TransactionClient,
) {
  let current = fromStatus;
  let updated = null;

  for (const toStatus of path) {
    assertMilestoneTransition(current, toStatus);
    updated = await updateMilestoneStatus(tenantContext(appId), milestoneId, toStatus, tx);
    current = toStatus;
  }

  return updated;
}

function auditProof(tx: Prisma.TransactionClient, req: Request, params: {
  appId: string;
  agreementId: string;
  proofId: string;
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
    targetType: 'proof',
    targetId: params.proofId,
    before: params.before,
    after: params.after,
    ipAddress: req.ip,
    userAgent: req.header('user-agent') ?? null,
    requestId: req.requestId,
  }, tx);
}

export async function createProofForApp(req: Request, appId: string, input: CreateProofInput) {
  return runIdempotentTransaction({
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

    const agreementStatus = assertInfrastructureAgreementStatus(agreement.status);
    const milestoneStatus = assertInfrastructureMilestoneStatus(milestone.status);
    const agreementPath = agreementPathForProofSubmission(agreementStatus);
    const milestonePath = milestonePathForProofSubmission(milestoneStatus);
    const created = await proofRepository.createProof(tenantContext(appId), input, tx);

    await advanceAgreement(appId, agreement.id, agreementStatus, agreementPath, tx);
    await advanceMilestone(appId, milestone.id, milestoneStatus, milestonePath, tx);

    const serialized = serializeProof(created);

    await createEvent(tenantContext(appId), {type: PROOF_EVENTS.submitted,
      agreementId: agreement.id,
      milestoneId: milestone.id,
      proofSubmissionId: created.id,
      payload: {
        proof: serialized,
      },
    }, tx);

    await createEvent(tenantContext(appId), {type: MILESTONE_EVENTS.proofSubmitted,
      agreementId: agreement.id,
      milestoneId: milestone.id,
      proofSubmissionId: created.id,
      payload: {
        milestoneId: milestone.id,
        proofSubmissionId: created.id,
      },
    }, tx);

    await auditProof(tx, req, {
      appId,
      agreementId: agreement.id,
      proofId: created.id,
      action: 'proof.submitted',
      after: serialized,
    });

    return serialized;
    },
  });
}

export async function listProofsForApp(appId: string, query: ProofListQuery) {
  const proofs = await proofRepository.listProofsForApp(tenantContext(appId), query);
  const hasMore = proofs.length > query.limit;
  const data = proofs.slice(0, query.limit);

  return {
    data: data.map(serializeProof),
    pagination: {
      limit: query.limit,
      cursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    },
  };
}

export async function getProofForApp(appId: string, proofId: string) {
  const proof = await proofRepository.findProofForApp(tenantContext(appId), proofId);
  if (!proof) {
    throw notFound('Proof submission not found.', 'proof_not_found');
  }

  return serializeProof(proof);
}

export async function reviewProofForApp(req: Request, appId: string, proofId: string, input: ReviewProofInput) {
  return prisma.$transaction(async (tx) => {
    const proof = await proofRepository.findProofForApp(tenantContext(appId), proofId, tx);
    if (!proof) {
      throw notFound('Proof submission not found.', 'proof_not_found');
    }

    if (!['submitted', 'under_review'].includes(proof.status)) {
      throw invalidRequest('Proof submission has already been reviewed.', 'proof_already_reviewed');
    }

    const agreement = await findAgreementForApp(tenantContext(appId), proof.agreementId, tx);
    if (!agreement) {
      throw notFound('Agreement not found.', 'agreement_not_found');
    }

    const milestone = await findMilestoneForApp(tenantContext(appId), proof.milestoneId, tx);
    if (!milestone || milestone.agreementId !== agreement.id) {
      throw notFound('Milestone not found for proof.', 'milestone_not_found');
    }

    const agreementStatus = assertInfrastructureAgreementStatus(agreement.status);
    const milestoneStatus = assertInfrastructureMilestoneStatus(milestone.status);
    const agreementPath = agreementPathForReviewDecision(agreementStatus, input.decision);
    const milestonePath = milestonePathForReviewDecision(milestoneStatus, input.decision);

    if (agreementPath[0] === 'under_review' || milestonePath[0] === 'under_review') {
      await proofRepository.updateProofStatus(tenantContext(appId), proof.id, {
        status: 'under_review',
      }, tx);

      await createEvent(tenantContext(appId), {type: PROOF_EVENTS.underReview,
        agreementId: proof.agreementId,
        milestoneId: proof.milestoneId,
        proofSubmissionId: proof.id,
        payload: { proofSubmissionId: proof.id },
      }, tx);
    }

    await advanceAgreement(appId, agreement.id, agreementStatus, agreementPath, tx);
    await advanceMilestone(appId, milestone.id, milestoneStatus, milestonePath, tx);

    const reviewedProof = await proofRepository.updateProofStatus(tenantContext(appId), proof.id, {
      status: proofStatusForReviewDecision(input.decision),
    }, tx);
    const review = await reviewRepository.createReview(tenantContext(appId), {
      ...input,
      agreementId: proof.agreementId,
      milestoneId: proof.milestoneId,
      proofSubmissionId: proof.id,
    }, tx);
    const serializedProofBefore = serializeProof(proof);
    const serializedProofAfter = serializeProof(reviewedProof);
    const serializedReview = serializeReview(review);
    const eventType = eventTypeForReviewDecision(input.decision);

    if (eventType) {
      await createEvent(tenantContext(appId), {type: eventType,
        agreementId: proof.agreementId,
        milestoneId: proof.milestoneId,
        proofSubmissionId: proof.id,
        payload: {
          proof: serializedProofAfter,
          review: serializedReview,
        },
      }, tx);
    }

    if (input.decision === 'approved') {
      await createEvent(tenantContext(appId), {type: MILESTONE_EVENTS.approved,
        agreementId: proof.agreementId,
        milestoneId: proof.milestoneId,
        proofSubmissionId: proof.id,
        payload: {
          milestoneId: proof.milestoneId,
          proofSubmissionId: proof.id,
          reviewId: review.id,
        },
      }, tx);
    }

    await auditProof(tx, req, {
      appId,
      agreementId: proof.agreementId,
      proofId: proof.id,
      action: 'proof.reviewed',
      before: serializedProofBefore,
      after: {
        proof: serializedProofAfter,
        review: serializedReview,
      },
    });

    return {
      proof: serializedProofAfter,
      review: serializedReview,
    };
  });
}
