import { prisma } from '../db';
import { createLog } from './logService';
import { config } from '../config';

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

  if (config.aiEnabled && config.openaiApiKey) {
    // Future: real AI provider integration
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
  const hasEvidence = !!input.evidenceNotes && input.evidenceNotes.length > 0;
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
  // TODO: Integrate with OpenAI or other LLM provider
  // For now, falls back to mock engine
  console.log('[AI] Would call AI provider with input:', input.agreementTitle);
  return runMockEngine(input);
}

/**
 * Save recommendation results to a dispute record.
 */
export async function saveRecommendation(
  disputeId: string,
  result: RecommendationOutput
) {
  return prisma.dispute.update({
    where: { id: disputeId },
    data: {
      aiSummary: result.summary,
      aiRecommendation: result.recommendation,
      aiConfidence: result.confidence,
      aiRationale: result.rationale,
    },
  });
}
