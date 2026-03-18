import { prisma } from '../db';
import { createLog } from '../services/logService';
import {
  activateNextMilestone,
  approveCurrentMilestone,
  completeApprovedMilestone,
  recordSettlementReference,
  refundCurrentMilestone,
  transitionMilestoneStatus,
  transitionStatus,
} from '../services/agreementService';
import { sendTreasuryTransfer } from '../services/ckbService';
import { generateRecommendation, saveRecommendation } from '../services/disputeService';
import { attemptFiberPayout } from '../services/fiberService';

const processedSet = new Set<string>();
let cycleInProgress = false;

function getCurrentMilestone(agreement: any) {
  const activeStatuses = ['ACTIVE', 'PROOF_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'DISPUTED'];
  return (
    agreement.milestones.find((milestone: any) => activeStatuses.includes(milestone.status)) ||
    agreement.milestones.find((milestone: any) => milestone.status === 'PENDING') ||
    null
  );
}

export async function runAgentCycle(): Promise<void> {
  if (cycleInProgress) {
    return;
  }

  cycleInProgress = true;

  try {
    const agreements = await prisma.agreement.findMany({
      where: {
        status: {
          in: ['PROOF_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'FUNDED', 'DRAFT', 'DISPUTED'],
        },
      },
      include: {
        milestones: {
          orderBy: { sortOrder: 'asc' },
          include: {
            proofs: { orderBy: { submittedAt: 'desc' } },
            disputes: { orderBy: { createdAt: 'desc' } },
          },
        },
        proofs: { orderBy: { submittedAt: 'desc' } },
        disputes: { orderBy: { createdAt: 'desc' } },
      },
    });

    for (const agreement of agreements) {
      const processKey = `${agreement.id}:${agreement.status}:${agreement.updatedAt.toISOString()}`;
      if (processedSet.has(processKey)) {
        continue;
      }

      try {
        await processAgreement(agreement);
        processedSet.add(processKey);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        await createLog({
          agreementId: agreement.id,
          level: 'ERROR',
          eventType: 'ERROR',
          message: `Agent error processing agreement: ${msg}`,
          metadata: { error: msg, status: agreement.status },
        });
      }
    }

    if (processedSet.size > 10000) {
      processedSet.clear();
    }
  } catch (err) {
    console.error('[AGENT] Cycle error:', err);
  } finally {
    cycleInProgress = false;
  }
}

async function processAgreement(agreement: any): Promise<void> {
  const now = new Date();
  const deadline = new Date(agreement.deadlineAt);
  const currentMilestone = getCurrentMilestone(agreement);

  switch (agreement.status) {
    case 'DRAFT': {
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

      const existingSettlementReference =
        agreement.fiberPaymentReference || agreement.ckbTxHashRelease;

      if (!existingSettlementReference) {
        const claimResult = await prisma.agreement.updateMany({
          where: {
            id: agreement.id,
            status: 'APPROVED',
            updatedAt: agreement.updatedAt,
            ckbTxHashRelease: null,
            fiberPaymentReference: null,
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

          if (fiberResult.route === 'FIBER') {
            await recordSettlementReference(agreement.id, {
              fiberPaymentReference: fiberResult.paymentReference,
              ckbTxHashRelease: null,
            });
          } else {
            const payoutTxHash = await sendTreasuryTransfer(
              agreement.workerAddress,
              currentMilestone.amount
            );
            await recordSettlementReference(agreement.id, {
              ckbTxHashRelease: payoutTxHash,
              fiberPaymentReference: null,
            });
          }
        } else {
          const payoutTxHash = await sendTreasuryTransfer(
            agreement.workerAddress,
            currentMilestone.amount
          );
          await recordSettlementReference(agreement.id, {
            ckbTxHashRelease: payoutTxHash,
            fiberPaymentReference: null,
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
      } else {
        await createLog({
          agreementId: agreement.id,
          level: 'INFO',
          eventType: 'RELEASE_PREPARED',
          message: `Existing settlement reference found for ${currentMilestone.title}; resuming milestone completion`,
          metadata: {
            milestoneId: currentMilestone.id,
            milestoneTitle: currentMilestone.title,
            ckbTxHashRelease: agreement.ckbTxHashRelease,
            fiberPaymentReference: agreement.fiberPaymentReference,
          },
        });
      }

      const updatedAgreement = await completeApprovedMilestone(agreement.id);
      const hasRemainingMilestones = updatedAgreement?.status === 'FUNDED';

      await createLog({
        agreementId: agreement.id,
        level: 'SUCCESS',
        eventType: 'SETTLEMENT_CONFIRMED',
        message: hasRemainingMilestones
          ? `Milestone settled and next milestone unlocked: ${currentMilestone.title}`
          : `Final milestone settled: ${currentMilestone.title}`,
        metadata: {
          milestoneId: currentMilestone.id,
          milestoneTitle: currentMilestone.title,
          amount: currentMilestone.amount,
          finalAgreementStatus: updatedAgreement?.status,
        },
      });
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

      const proof = currentMilestone.proofs[0];

      const recommendation = await generateRecommendation(agreement.id, {
        agreementTitle: agreement.title,
        agreementAmount: currentMilestone.amount,
        milestoneTitle: currentMilestone.title,
        proofContent: proof?.content || null,
        proofType: proof?.proofType || null,
        disputeReason: openDispute.reason,
        evidenceNotes: openDispute.evidenceNotes,
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
          await refundCurrentMilestone(agreement.id);
          await createLog({
            agreementId: agreement.id,
            level: 'INFO',
            eventType: 'REFUND_SENT',
            message: `Dispute resolved in favor of refund for ${currentMilestone.title}`,
            metadata: { milestoneId: currentMilestone.id },
          });
        }
      }
      break;
    }
  }
}
