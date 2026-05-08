import { prisma } from '../db';
import { createLog } from './logService';
import { config } from '../config';
import { broadcastAgreementUpdateById } from './agreementService';
import { canUseOpenAI, generateStructuredAiOutput } from './aiStructuredService';

/**
 * AI Dispute Recommendation Service
 * 
 * Pluggable interface: swap AI provider by changing config.
 * - If AI_ENABLED=true and OPENAI_API_KEY set → uses real LLM (future)
 * - Otherwise → deterministic mock engine with identical output shape
 * 
 * IMPORTANT: Recommendations are advisory only. They never directly release funds.
 */

interface RecommendationInput {
  agreementTitle: string;
  agreementAmount: string;
  milestoneTitle?: string | null;
  proofContent: string | null;
  proofType: string | null;
  disputeReason: string;
  evidenceNotes: string | null;
  evidenceTimeline?: Array<{
    submittedBy: string;
    content: string;
    createdAt: string;
  }>;
  deadlineAt: string;
  status: string;
  statusHistory?: string[];
}

interface RecommendationOutput {
  summary: string;
  recommendation: 'APPROVE_PAYOUT' | 'REFUND_CLIENT' | 'REQUEST_MORE_EVIDENCE' | 'ESCALATE_MANUAL_REVIEW';
  confidence: number;
  rationale: string;
}

type RecommendationReadinessInput = {
  dispute: {
    openedBy: string;
    createdAt: Date | string;
    evidenceEntries?: Array<{
      submittedBy: string;
    }>;
  };
  agreement: {
    clientAddress: string;
    workerAddress: string;
    disputeWindowSecs: number;
  };
  now?: Date;
};

export function evaluateRecommendationReadiness(input: RecommendationReadinessInput) {
  const openedAt = new Date(input.dispute.createdAt);
  const responseDeadlineAt = new Date(openedAt.getTime() + (input.agreement.disputeWindowSecs * 1000));
  const currentTime = input.now ?? new Date();
  const counterpartyAddress =
    input.dispute.openedBy === input.agreement.clientAddress
      ? input.agreement.workerAddress
      : input.dispute.openedBy === input.agreement.workerAddress
        ? input.agreement.clientAddress
        : null;
  const hasCounterpartyReply = counterpartyAddress
    ? (input.dispute.evidenceEntries || []).some((entry) => entry.submittedBy === counterpartyAddress)
    : (input.dispute.evidenceEntries || []).some((entry) => entry.submittedBy !== input.dispute.openedBy);
  const responseWindowExpired = currentTime >= responseDeadlineAt;

  return {
    ready: hasCounterpartyReply || responseWindowExpired,
    counterpartyAddress,
    hasCounterpartyReply,
    responseWindowExpired,
    responseDeadlineAt,
  };
}

/**
 * Generate dispute recommendation using the configured provider.
 */
export async function generateRecommendation(
  agreementId: string,
  input: RecommendationInput
): Promise<RecommendationOutput> {
  await createLog({
    agreementId,
    level: 'INFO',
    eventType: 'RULE_CHECK_STARTED',
    message: 'Agent evaluating dispute for recommendation...',
    metadata: { disputeReason: input.disputeReason },
  });

  let result: RecommendationOutput;

  if (canUseOpenAI()) {
    result = await callAIProvider(input);
  } else {
    // Deterministic mock engine
    result = runMockEngine(input);
  }

  await createLog({
    agreementId,
    level: 'SUCCESS',
    eventType: 'AI_RECOMMENDATION_READY',
    message: `Recommendation: ${result.recommendation} (confidence: ${result.confidence}%)`,
    metadata: { ...result },
  });

  return result;
}

/**
 * Deterministic mock recommendation engine.
 * Uses rule-based heuristics to generate a recommendation.
 */
function runMockEngine(input: RecommendationInput): RecommendationOutput {
  const hasProof = !!input.proofContent && input.proofContent.length > 0;
  const proofLength = input.proofContent?.length || 0;
  const evidenceEntryCount = input.evidenceTimeline?.length || 0;
  const hasEvidence =
    (!!input.evidenceNotes && input.evidenceNotes.length > 0) ||
    evidenceEntryCount > 0;
  const deadlinePassed = new Date(input.deadlineAt) < new Date();
  const disputeReasonLength = input.disputeReason.length;

  // Rule 1: No proof at all → likely refund
  if (!hasProof) {
    return {
      summary: `No proof was submitted for ${input.milestoneTitle || 'this agreement milestone'} in "${input.agreementTitle}". The dispute appears valid.`,
      recommendation: 'REFUND_CLIENT',
      confidence: 85,
      rationale: 'No proof of work was provided. Client dispute has strong basis for refund.',
    };
  }

  // Rule 2: Deadline passed with minimal proof → refund
  if (deadlinePassed && proofLength < 20) {
    return {
      summary: `Deadline has passed and proof is minimal for ${input.milestoneTitle || 'the current milestone'} in "${input.agreementTitle}".`,
      recommendation: 'REFUND_CLIENT',
      confidence: 75,
      rationale: 'Deadline exceeded with insufficient proof of work completion.',
    };
  }

  // Rule 3: Strong proof exists and dispute reason is short → approve payout
  if (hasProof && proofLength > 50 && disputeReasonLength < 50) {
    return {
      summary: `Proof appears substantial for ${input.milestoneTitle || 'the current milestone'} in "${input.agreementTitle}". Dispute reason is brief.`,
      recommendation: 'APPROVE_PAYOUT',
      confidence: 70,
      rationale: 'Proof of work is detailed. Dispute reason lacks specificity. Recommending payout.',
    };
  }

  // Rule 4: Both sides have evidence → request more
  if (hasProof && hasEvidence) {
    return {
      summary: `Both proof and dispute evidence exist for ${input.milestoneTitle || 'the current milestone'} in "${input.agreementTitle}". More context needed.`,
      recommendation: 'REQUEST_MORE_EVIDENCE',
      confidence: 55,
      rationale: 'Both parties have submitted evidence. Additional documentation needed for fair resolution.',
    };
  }

  // Default: escalate for manual review
  return {
    summary: `Dispute for ${input.milestoneTitle || 'the current milestone'} in "${input.agreementTitle}" requires human review.`,
    recommendation: 'ESCALATE_MANUAL_REVIEW',
    confidence: 40,
    rationale: 'Case complexity exceeds automated assessment capability. Manual review recommended.',
  };
}

/**
 * Placeholder for real AI provider integration.
 * Implements the same interface as the mock engine.
 */
async function callAIProvider(input: RecommendationInput): Promise<RecommendationOutput> {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string' },
      recommendation: {
        type: 'string',
        enum: ['APPROVE_PAYOUT', 'REFUND_CLIENT', 'REQUEST_MORE_EVIDENCE', 'ESCALATE_MANUAL_REVIEW'],
      },
      confidence: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
      },
      rationale: { type: 'string' },
    },
    required: ['summary', 'recommendation', 'confidence', 'rationale'],
  };

  const systemPrompt = [
    'You are a neutral dispute reviewer for a milestone payment agreement.',
    'Return only the structured result requested.',
    'Be conservative: do not recommend payout unless the proof appears materially credible and the dispute reason is weak.',
    'Never assume facts not present in the case record.',
    'If evidence is mixed or unclear, prefer REQUEST_MORE_EVIDENCE or ESCALATE_MANUAL_REVIEW.',
    'This recommendation is advisory only and must not instruct funds to be released automatically.',
  ].join(' ');

  const userPrompt = JSON.stringify({
    agreementTitle: input.agreementTitle,
    agreementAmount: input.agreementAmount,
    milestoneTitle: input.milestoneTitle || null,
    proofType: input.proofType || null,
    proofContent: input.proofContent || null,
    disputeReason: input.disputeReason,
    evidenceNotes: input.evidenceNotes || null,
    evidenceTimeline: input.evidenceTimeline || [],
    deadlineAt: input.deadlineAt,
    status: input.status,
    statusHistory: input.statusHistory || [],
  });

  try {
    const parsed = await generateStructuredAiOutput<RecommendationOutput>({
      schemaName: 'dispute_recommendation',
      schema,
      systemPrompt,
      userPayload: JSON.parse(userPrompt) as Record<string, unknown>,
    });
    return {
      summary: parsed.summary,
      recommendation: parsed.recommendation,
      confidence: parsed.confidence,
      rationale: parsed.rationale,
    };
  } catch (error) {
    console.warn(
      `[AI] Falling back to mock dispute engine: ${error instanceof Error ? error.message : String(error)}`
    );
    return runMockEngine(input);
  }
}

/**
 * Save recommendation results to a dispute record.
 */
export async function saveRecommendation(
  disputeId: string,
  result: RecommendationOutput
) {
  const updated = await prisma.dispute.update({
    where: { id: disputeId },
    data: {
      aiSummary: result.summary,
      aiRecommendation: result.recommendation,
      aiConfidence: result.confidence,
      aiRationale: result.rationale,
    },
  });

  await broadcastAgreementUpdateById(updated.agreementId);

  return updated;
}
