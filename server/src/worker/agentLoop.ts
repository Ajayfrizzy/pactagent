import { prisma } from '../db';
import { createLog } from '../services/logService';
import {
  activateNextMilestone,
  approveCurrentMilestone,
  completeApprovedMilestone,
  confirmFundingIfReady,
  confirmPendingSettlementIfReady,
  recordMilestoneSettlementAttempt,
  refundCurrentMilestone,
  reconcileAgreementSettlement,
  transitionMilestoneStatus,
  transitionStatus,
} from '../services/agreementService';
import { sendTreasuryTransfer } from '../services/ckbService';
import {
  evaluateRecommendationReadiness,
  generateRecommendation,
  saveRecommendation,
} from '../services/disputeService';
import { attemptFiberPayout } from '../services/fiberService';
import {
  claimAvailableJobs,
  completeJob,
  enqueueAgreementJob,
  failJob,
  parseJobPayload,
  releaseStaleLocks,
} from '../services/jobQueueService';

let cycleInProgress = false;
const workerId = `embedded-worker:${process.pid}`;

function getCurrentMilestone(agreement: any) {
  const activeStatuses = ['ACTIVE', 'PROOF_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'DISPUTED'];
  return (
    agreement.milestones.find((milestone: any) => activeStatuses.includes(milestone.status)) ||
    agreement.milestones.find((milestone: any) => milestone.status === 'PENDING') ||
    null
  );
}

function getOpenDispute(currentMilestone: any) {
  return currentMilestone?.disputes.find((dispute: any) => !dispute.resolvedAt) ?? null;
}

function isPendingSettlementStatus(status: string) {
  return ['FUNDING_PENDING', 'PAYOUT_PENDING', 'REFUND_PENDING', 'SPLIT_PENDING'].includes(status);
}

function buildProcessKey(agreement: any, now: Date) {
  const parts = [
    agreement.id,
    agreement.status,
    agreement.settlementStatus,
    agreement.updatedAt.toISOString(),
  ];

  if (agreement.status === 'DRAFT' || agreement.status === 'FUNDED') {
    parts.push(`deadlinePassed:${now > new Date(agreement.deadlineAt)}`);
  }

  if (agreement.status === 'DISPUTED') {
    const currentMilestone = getCurrentMilestone(agreement);
    const openDispute = getOpenDispute(currentMilestone);

    if (openDispute) {
      const readiness = evaluateRecommendationReadiness({
        dispute: openDispute,
        agreement,
        now,
      });

      parts.push(`recommendationReady:${readiness.ready}`);
      parts.push(`counterpartyReply:${readiness.hasCounterpartyReply}`);
      parts.push(`responseWindowExpired:${readiness.responseWindowExpired}`);
      parts.push(`replyCount:${openDispute.evidenceEntries?.length || 0}`);
      parts.push(`aiRecommendation:${openDispute.aiRecommendation ? 'present' : 'missing'}`);
    }
  }

  const latestSettlement = agreement.settlements?.[0];
  if (latestSettlement) {
    parts.push(`settlement:${latestSettlement.id}:${latestSettlement.status}`);
  }

  return parts.join(':');
}

export async function runAgentCycle(): Promise<void> {
  if (cycleInProgress) {
    return;
  }

  cycleInProgress = true;

  try {
    await releaseStaleLocks();
    await scheduleSystemJobs();
    const claimedJobs = await claimAvailableJobs(workerId, 12);

    for (const job of claimedJobs) {
      try {
        await processJob(job);
        await completeJob(job.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        await failJob(job, msg);
        if (job.agreementId) {
          await createLog({
            agreementId: job.agreementId,
            level: 'ERROR',
            eventType: 'ERROR',
            message: `Agent job ${job.kind} failed: ${msg}`,
            metadata: {
              jobId: job.id,
              attempts: job.attempts,
            },
          });
        }
      }
    }
  } catch (err) {
    console.error('[AGENT] Cycle error:', err);
  } finally {
    cycleInProgress = false;
  }
}

async function scheduleSystemJobs() {
  const agreements = await prisma.agreement.findMany({
    where: {
      OR: [
        {
          status: {
            in: ['PROOF_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'FUNDED', 'DRAFT', 'DISPUTED'],
          },
        },
        {
          settlementStatus: {
            in: ['FUNDING_PENDING', 'PAYOUT_PENDING', 'REFUND_PENDING', 'SPLIT_PENDING', 'FAILED'],
          },
        },
      ],
    },
    include: {
      milestones: {
        orderBy: { sortOrder: 'asc' },
        include: {
          disputes: {
            orderBy: { createdAt: 'desc' },
            include: {
              evidenceEntries: { orderBy: { createdAt: 'asc' } },
            },
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
    },
  });

  const now = new Date();

  for (const agreement of agreements) {
    await enqueueAgreementJob({
      agreementId: agreement.id,
      kind: 'AGREEMENT_CONTINUE',
      dedupeSuffix: `${agreement.status}:${agreement.updatedAt.toISOString()}`,
    });

    if (agreement.ckbTxHashFund && ['FUNDING_PENDING', 'FAILED'].includes(agreement.settlementStatus)) {
      await enqueueAgreementJob({
        agreementId: agreement.id,
        kind: 'VERIFY_FUNDING',
        dedupeSuffix: agreement.ckbTxHashFund,
      });
    }

    if (['PAYOUT_PENDING', 'REFUND_PENDING', 'SPLIT_PENDING', 'FAILED'].includes(agreement.settlementStatus)) {
      const latestSettlement = agreement.settlements[0];
      await enqueueAgreementJob({
        agreementId: agreement.id,
        kind: 'RECONCILE_SETTLEMENT',
        dedupeSuffix: latestSettlement?.id || agreement.settlementStatus,
      });
    }

    const deadline = new Date(agreement.deadlineAt);
    const hoursUntilDeadline = (deadline.getTime() - now.getTime()) / (60 * 60 * 1000);
    if (hoursUntilDeadline <= 24 && hoursUntilDeadline > 0) {
      await enqueueAgreementJob({
        agreementId: agreement.id,
        kind: 'REMINDER_DEADLINE',
        dedupeSuffix: `${deadline.toISOString().slice(0, 13)}`,
      });
    }

    const currentMilestone = getCurrentMilestone(agreement);
    const openDispute = getOpenDispute(currentMilestone);
    if (openDispute) {
      const readiness = evaluateRecommendationReadiness({
        dispute: openDispute,
        agreement,
        now,
      });

      if (!readiness.ready) {
        const hoursUntilReplyDeadline =
          (readiness.responseDeadlineAt.getTime() - now.getTime()) / (60 * 60 * 1000);
        if (hoursUntilReplyDeadline <= 6) {
          await enqueueAgreementJob({
            agreementId: agreement.id,
            kind: 'REMINDER_DISPUTE_RESPONSE',
            payload: {
              agreementId: agreement.id,
              disputeId: openDispute.id,
            },
            dedupeSuffix: `${openDispute.id}:${readiness.responseDeadlineAt.toISOString().slice(0, 13)}`,
          });
        }
      }
    }
  }
}

async function processJob(job: {
  id: string;
  agreementId: string | null;
  kind: string;
  payloadJson: string | null;
}) {
  const payload = parseJobPayload(job.payloadJson);

  switch (job.kind) {
    case 'VERIFY_FUNDING':
      if (job.agreementId) {
        await confirmFundingIfReady(job.agreementId);
      }
      return;
    case 'RECONCILE_SETTLEMENT':
      if (job.agreementId) {
        await reconcileAgreementSettlement(job.agreementId);
      }
      return;
    case 'REMINDER_DEADLINE':
      if (job.agreementId) {
        await createLog({
          agreementId: job.agreementId,
          level: 'WARN',
          eventType: 'RULE_CHECK_STARTED',
          message: 'Reminder: agreement deadline is approaching',
        });
      }
      return;
    case 'REMINDER_DISPUTE_RESPONSE':
      if (job.agreementId) {
        await createLog({
          agreementId: job.agreementId,
          level: 'WARN',
          eventType: 'DISPUTE_OPENED',
          message: 'Reminder: dispute response window is approaching its deadline',
          metadata: {
            disputeId: payload.disputeId || null,
          },
        });
      }
      return;
    case 'AGREEMENT_CONTINUE':
    default:
      if (!job.agreementId) {
        return;
      }

      const agreement = await prisma.agreement.findUnique({
        where: { id: job.agreementId },
        include: {
          milestones: {
            orderBy: { sortOrder: 'asc' },
            include: {
              proofs: { orderBy: { submittedAt: 'desc' } },
              disputes: {
                orderBy: { createdAt: 'desc' },
                include: {
                  evidenceEntries: { orderBy: { createdAt: 'asc' } },
                },
              },
              settlements: {
                orderBy: { createdAt: 'desc' },
              },
            },
          },
          proofs: { orderBy: { submittedAt: 'desc' } },
          disputes: {
            orderBy: { createdAt: 'desc' },
            include: {
              evidenceEntries: { orderBy: { createdAt: 'asc' } },
            },
          },
          settlements: {
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!agreement) {
        return;
      }

      await processAgreement(agreement);
      return;
  }
}

async function processAgreement(agreement: any): Promise<void> {
  const now = new Date();
  const deadline = new Date(agreement.deadlineAt);
  const currentMilestone = getCurrentMilestone(agreement);

  if (
    agreement.status === 'DRAFT' &&
    agreement.ckbTxHashFund &&
    ['FUNDING_PENDING', 'FAILED'].includes(agreement.settlementStatus)
  ) {
    await confirmFundingIfReady(agreement.id);
  }

  if (['PAYOUT_PENDING', 'REFUND_PENDING', 'SPLIT_PENDING'].includes(agreement.settlementStatus)) {
    const confirmed = await confirmPendingSettlementIfReady(agreement.id);
    if (confirmed) {
      return;
    }
  }

  switch (agreement.status) {
    case 'DRAFT': {
      if (agreement.settlementStatus === 'FUNDING_PENDING') {
        break;
      }

      if (now > deadline) {
        await createLog({
          agreementId: agreement.id,
          level: 'WARN',
          eventType: 'RULE_CHECK_STARTED',
          message: 'Agent detected: DRAFT agreement past deadline',
          metadata: { deadline: deadline.toISOString() },
        });
        await transitionStatus(agreement.id, 'EXPIRED');
        await createLog({
          agreementId: agreement.id,
          level: 'INFO',
          eventType: 'RULE_CHECK_PASSED',
          message: 'Agreement expired because the funding deadline passed',
        });
      }
      break;
    }

    case 'FUNDED': {
      if (!currentMilestone) {
        await transitionStatus(agreement.id, 'PAID');
        break;
      }

      if (currentMilestone.status === 'PENDING') {
        await activateNextMilestone(agreement.id);
        break;
      }

      if (now > deadline) {
        await createLog({
          agreementId: agreement.id,
          level: 'WARN',
          eventType: 'RULE_CHECK_STARTED',
          message: 'Agent detected: funded agreement past deadline without proof',
          metadata: {
            deadline: deadline.toISOString(),
            milestoneId: currentMilestone.id,
            milestoneTitle: currentMilestone.title,
          },
        });
        await refundCurrentMilestone(agreement.id);
      }
      break;
    }

    case 'PROOF_SUBMITTED': {
      if (!currentMilestone || currentMilestone.status !== 'PROOF_SUBMITTED') {
        break;
      }

      await createLog({
        agreementId: agreement.id,
        level: 'INFO',
        eventType: 'RULE_CHECK_STARTED',
        message: 'Agent starting rule check on submitted milestone proof',
        metadata: {
          milestoneId: currentMilestone.id,
          milestoneTitle: currentMilestone.title,
          reviewerMode: agreement.reviewerMode,
        },
      });

      const latestProof = currentMilestone.proofs[0];
      const proofValid = latestProof && latestProof.content && latestProof.content.length > 0;
      const deadlineOk = now <= deadline;

      if (!proofValid) {
        await createLog({
          agreementId: agreement.id,
          level: 'WARN',
          eventType: 'RULE_CHECK_FAILED',
          message: 'Milestone proof validation failed because the content is empty or missing',
          metadata: { milestoneId: currentMilestone.id },
        });
        break;
      }

      if (!deadlineOk) {
        await createLog({
          agreementId: agreement.id,
          level: 'WARN',
          eventType: 'RULE_CHECK_FAILED',
          message: 'Milestone proof was submitted after the agreement deadline',
          metadata: {
            milestoneId: currentMilestone.id,
            deadline: deadline.toISOString(),
          },
        });
        break;
      }

      await transitionMilestoneStatus(currentMilestone.id, 'UNDER_REVIEW');
      await transitionStatus(agreement.id, 'UNDER_REVIEW');

      await createLog({
        agreementId: agreement.id,
        level: 'SUCCESS',
        eventType: 'RULE_CHECK_PASSED',
        message: `Milestone proof validated: ${currentMilestone.title}`,
        metadata: {
          milestoneId: currentMilestone.id,
          milestoneTitle: currentMilestone.title,
          proofId: latestProof.id,
        },
      });
      break;
    }

    case 'UNDER_REVIEW': {
      if (!currentMilestone || currentMilestone.status !== 'UNDER_REVIEW') {
        break;
      }

      if (agreement.reviewerMode === 'AUTO') {
        await createLog({
          agreementId: agreement.id,
          level: 'INFO',
          eventType: 'RULE_CHECK_STARTED',
          message: 'AUTO mode: agent evaluating milestone for automatic approval',
          metadata: {
            milestoneId: currentMilestone.id,
            milestoneTitle: currentMilestone.title,
          },
        });

        const hasOpenDispute = currentMilestone.disputes.some((dispute: any) => !dispute.resolvedAt);
        if (hasOpenDispute) {
          await createLog({
            agreementId: agreement.id,
            level: 'WARN',
            eventType: 'RULE_CHECK_FAILED',
            message: 'Cannot auto-approve because an open dispute exists for the active milestone',
            metadata: { milestoneId: currentMilestone.id },
          });
          break;
        }

        await approveCurrentMilestone(agreement.id);

        await createLog({
          agreementId: agreement.id,
          level: 'SUCCESS',
          eventType: 'RULE_CHECK_PASSED',
          message: `Milestone auto-approved by agent: ${currentMilestone.title}`,
          metadata: { milestoneId: currentMilestone.id },
        });
      } else if (agreement.reviewerMode === 'HYBRID') {
        await createLog({
          agreementId: agreement.id,
          level: 'INFO',
          eventType: 'RULE_CHECK_STARTED',
          message: 'HYBRID mode: milestone recommendation ready, awaiting user confirmation',
          metadata: { milestoneId: currentMilestone.id },
        });
      }
      break;
    }

    case 'APPROVED': {
      if (!currentMilestone || currentMilestone.status !== 'APPROVED') {
        break;
      }

      if (agreement.escrowModel !== 'TREASURY_BRIDGE') {
        if (agreement.settlementStatus === 'PAYOUT_PENDING') {
          break;
        }

        await createLog({
          agreementId: agreement.id,
          level: 'INFO',
          eventType: 'RELEASE_PREPARED',
          message: 'Awaiting manual on-chain settlement transaction for the approved escrow milestone',
          metadata: {
            milestoneId: currentMilestone.id,
            escrowModel: agreement.escrowModel,
          },
        });
        break;
      }

      const pendingPayout = agreement.settlements.find(
        (settlement: any) =>
          settlement.direction === 'PAYOUT' &&
          settlement.milestoneId === currentMilestone.id &&
          settlement.status === 'PENDING'
      );
      if (pendingPayout) {
        await confirmPendingSettlementIfReady(agreement.id);
        break;
      }

      const existingConfirmedPayout = agreement.settlements.find(
        (settlement: any) =>
          settlement.direction === 'PAYOUT' &&
          settlement.milestoneId === currentMilestone.id &&
          settlement.status === 'CONFIRMED'
      );
      if (existingConfirmedPayout) {
        await completeApprovedMilestone(agreement.id);
        break;
      }

      const claimResult = await prisma.agreement.updateMany({
        where: {
          id: agreement.id,
          status: 'APPROVED',
          updatedAt: agreement.updatedAt,
          settlementStatus: {
            not: 'PAYOUT_PENDING',
          },
        },
        data: { updatedAt: new Date() },
      });

      if (claimResult.count === 0) {
        await createLog({
          agreementId: agreement.id,
          level: 'INFO',
          eventType: 'RELEASE_PREPARED',
          message: `Skipping duplicate payout attempt for milestone ${currentMilestone.sortOrder}: ${currentMilestone.title}`,
          metadata: {
            milestoneId: currentMilestone.id,
            reason: 'SETTLEMENT_ALREADY_CLAIMED',
          },
        });
        break;
      }

      await createLog({
        agreementId: agreement.id,
        level: 'INFO',
        eventType: 'RELEASE_PREPARED',
        message: `Preparing payout for milestone ${currentMilestone.sortOrder}: ${currentMilestone.title}`,
        metadata: {
          milestoneId: currentMilestone.id,
          milestoneAmount: currentMilestone.amount,
          payoutNetwork: agreement.payoutNetwork,
        },
      });

      if (agreement.payoutNetwork === 'FIBER' || agreement.releaseMode === 'PARTIAL') {
        const fiberResult = await attemptFiberPayout(
          agreement.id,
          agreement.workerFiberPubkey || agreement.workerAddress,
          currentMilestone.amount
        );

        await createLog({
          agreementId: agreement.id,
          level: fiberResult.route === 'FIBER' ? 'SUCCESS' : 'INFO',
          eventType: 'RELEASE_SENT',
          message:
            fiberResult.route === 'FIBER'
              ? `Milestone payment released via Fiber: ${currentMilestone.title}`
              : `Milestone payment released on CKB fallback: ${currentMilestone.title}`,
          metadata: {
            milestoneId: currentMilestone.id,
            milestoneTitle: currentMilestone.title,
            ...fiberResult,
          },
        });

        if (fiberResult.route === 'FIBER' && fiberResult.paymentReference) {
          await recordMilestoneSettlementAttempt({
            agreementId: agreement.id,
            milestoneId: currentMilestone.id,
            direction: 'PAYOUT',
            network: 'FIBER',
            amount: currentMilestone.amount,
            paymentReference: fiberResult.paymentReference,
            status: 'CONFIRMED',
            confirmedAt: new Date(),
          });

          const updatedAgreement = await completeApprovedMilestone(agreement.id);
          await createLog({
            agreementId: agreement.id,
            level: 'SUCCESS',
            eventType: 'SETTLEMENT_CONFIRMED',
            message: `Milestone settled on Fiber: ${currentMilestone.title}`,
            metadata: {
              milestoneId: currentMilestone.id,
              milestoneTitle: currentMilestone.title,
              finalAgreementStatus: updatedAgreement?.status,
            },
          });
        } else {
          const payoutTxHash = await sendTreasuryTransfer(
            agreement.workerAddress,
            currentMilestone.amount
          );
          await recordMilestoneSettlementAttempt({
            agreementId: agreement.id,
            milestoneId: currentMilestone.id,
            direction: 'PAYOUT',
            network: 'CKB',
            amount: currentMilestone.amount,
            txHash: payoutTxHash,
          });
        }
      } else {
        const payoutTxHash = await sendTreasuryTransfer(
          agreement.workerAddress,
          currentMilestone.amount
        );
        await recordMilestoneSettlementAttempt({
          agreementId: agreement.id,
          milestoneId: currentMilestone.id,
          direction: 'PAYOUT',
          network: 'CKB',
          amount: currentMilestone.amount,
          txHash: payoutTxHash,
        });

        await createLog({
          agreementId: agreement.id,
          level: 'INFO',
          eventType: 'RELEASE_SENT',
          message: `Milestone payment prepared on CKB: ${currentMilestone.title}`,
          metadata: {
            milestoneId: currentMilestone.id,
            milestoneTitle: currentMilestone.title,
            amount: currentMilestone.amount,
            route: 'CKB',
          },
        });
      }
      break;
    }

    case 'DISPUTED': {
      if (!currentMilestone || currentMilestone.status !== 'DISPUTED') {
        break;
      }

      const openDispute = currentMilestone.disputes.find(
        (dispute: any) => !dispute.resolvedAt && !dispute.aiRecommendation
      );
      if (!openDispute) {
        break;
      }

      const readiness = evaluateRecommendationReadiness({
        dispute: openDispute,
        agreement,
        now,
      });

      if (!readiness.ready) {
        await createLog({
          agreementId: agreement.id,
          level: 'INFO',
          eventType: 'RULE_CHECK_STARTED',
          message: 'AI recommendation is waiting for a counterparty reply or dispute window expiry',
          metadata: {
            milestoneId: currentMilestone.id,
            disputeId: openDispute.id,
            responseDeadlineAt: readiness.responseDeadlineAt.toISOString(),
          },
        });
        break;
      }

      const proof = currentMilestone.proofs[0];

      const recommendation = await generateRecommendation(agreement.id, {
        agreementTitle: agreement.title,
        agreementAmount: currentMilestone.amount,
        milestoneTitle: currentMilestone.title,
        proofContent: proof?.content || null,
        proofType: proof?.proofType || null,
        disputeReason: openDispute.reason,
        evidenceNotes: openDispute.evidenceNotes,
        evidenceTimeline: (openDispute.evidenceEntries || []).map((entry: any) => ({
          submittedBy: entry.submittedBy,
          content: entry.content,
          createdAt: entry.createdAt.toISOString(),
        })),
        deadlineAt: agreement.deadlineAt.toISOString(),
        status: agreement.status,
      });

      await saveRecommendation(openDispute.id, recommendation);

      if (agreement.reviewerMode === 'AUTO' && recommendation.confidence >= 75) {
        if (recommendation.recommendation === 'APPROVE_PAYOUT') {
          await approveCurrentMilestone(agreement.id);
          await createLog({
            agreementId: agreement.id,
            level: 'SUCCESS',
            eventType: 'RULE_CHECK_PASSED',
            message: `Dispute resolved in favor of payout for ${currentMilestone.title}`,
            metadata: { milestoneId: currentMilestone.id },
          });
        } else if (recommendation.recommendation === 'REFUND_CLIENT') {
          await createLog({
            agreementId: agreement.id,
            level: 'INFO',
            eventType: 'AI_RECOMMENDATION_READY',
            message: `Refund recommendation recorded for ${currentMilestone.title}; mutual client and worker approval is still required`,
            metadata: {
              milestoneId: currentMilestone.id,
              recommendation: recommendation.recommendation,
              confidence: recommendation.confidence,
            },
          });
        }
      }
      break;
    }
  }
}
