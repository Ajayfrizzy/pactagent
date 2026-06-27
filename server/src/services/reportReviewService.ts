import { randomUUID } from 'crypto';
import { prisma } from '../db';
import { createAuditLog } from './auditLogService';
import { createLog } from './logService';
import { parseProofBundle } from './richPayloadService';
import { canUseOpenAI, generateStructuredAiOutput } from './aiStructuredService';

export type ProofCheckChecklistStatus = 'PRESENT' | 'MISSING' | 'PARTIAL' | 'NOT_APPLICABLE';
export type ProofCheckStatus = 'READY_FOR_HUMAN_REVIEW' | 'NEEDS_MORE_INFO';
export type PersistedProofReviewStatus =
  | 'UNREVIEWED'
  | 'CHECKING'
  | 'ISSUES_FOUND'
  | 'READY_FOR_HUMAN_REVIEW'
  | 'NEEDS_MORE_INFO';

export type ProofCheckChecklistItem = {
  key: 'links' | 'tx_hash' | 'screenshots' | 'scope';
  label: string;
  status: ProofCheckChecklistStatus;
  detail: string;
  warning: string | null;
};

export type ProofCheckResult = {
  agreementId: string;
  milestoneId: string;
  proofId: string;
  checkedAt: string;
  status: ProofCheckStatus;
  lifecycleStatus?: PersistedProofReviewStatus;
  summary: string;
  issueCount: number;
  warningCount: number;
  warnings: string[];
  checklist: ProofCheckChecklistItem[];
};

type ProofCheckAiOutput = {
  summary: string;
  status: ProofCheckStatus;
  checklist: ProofCheckChecklistItem[];
};

type SerializedProofCheckRecord = {
  id: string;
  agreementId: string;
  milestoneId: string;
  proofId: string;
  status: Exclude<PersistedProofReviewStatus, 'UNREVIEWED'>;
  issueCount: number;
  warningCount: number;
  summary: string;
  warnings: string[];
  checklist: ProofCheckChecklistItem[];
  triggeredByAddress: string | null;
  triggeredByType: 'USER' | 'SYSTEM';
  asyncJobId: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into',
  'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'with', 'your',
  'their', 'will', 'can', 'must', 'should', 'after', 'before', 'about', 'over',
  'under', 'than', 'then', 'them', 'they', 'you', 'was', 'were', 'have', 'has',
]);

function extractUrls(value: string) {
  return value.match(/https?:\/\/[^\s)]+/gi) || [];
}

function extractTxHashes(value: string) {
  return value.match(/\b0x[a-fA-F0-9]{64}\b/g) || [];
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function safeParseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function buildChecklistItem(params: {
  key: ProofCheckChecklistItem['key'];
  label: string;
  status: ProofCheckChecklistStatus;
  detail: string;
  warning?: string;
}): ProofCheckChecklistItem {
  return {
    key: params.key,
    label: params.label,
    status: params.status,
    detail: params.detail,
    warning: params.warning || null,
  };
}

function computeScopeChecklist(params: {
  milestoneTitle: string;
  milestoneDescription: string;
  proofText: string;
}) {
  const expectedKeywords = unique(
    tokenize(`${params.milestoneTitle} ${params.milestoneDescription}`)
  ).slice(0, 8);
  const proofTokens = new Set(tokenize(params.proofText));
  const matchedKeywords = expectedKeywords.filter((token) => proofTokens.has(token));

  if (!expectedKeywords.length) {
    return buildChecklistItem({
      key: 'scope',
      label: 'Milestone scope matched',
      status: 'PARTIAL',
      detail: 'The milestone does not include enough descriptive keywords to judge scope confidently.',
      warning: 'Add more milestone-specific detail or proof notes so the scope match is easier to verify.',
    });
  }

  if (matchedKeywords.length >= Math.min(2, expectedKeywords.length)) {
    return buildChecklistItem({
      key: 'scope',
      label: 'Milestone scope matched',
      status: 'PRESENT',
      detail: `Proof references milestone-specific terms like ${matchedKeywords.slice(0, 3).join(', ')}.`,
    });
  }

  if (matchedKeywords.length === 1) {
    return buildChecklistItem({
      key: 'scope',
      label: 'Milestone scope matched',
      status: 'PARTIAL',
      detail: `Only one milestone keyword was clearly matched: ${matchedKeywords[0]}.`,
      warning: 'Add more milestone-specific context so a reviewer can verify the work against the agreed scope quickly.',
    });
  }

  return buildChecklistItem({
    key: 'scope',
    label: 'Milestone scope matched',
    status: 'MISSING',
    detail: 'The proof does not clearly echo the milestone title or description.',
    warning: 'Explain how this delivery maps to the milestone scope before asking for review.',
  });
}

function mapProofCheckStatusToPersisted(status: ProofCheckStatus): 'READY_FOR_HUMAN_REVIEW' | 'ISSUES_FOUND' {
  if (status === 'READY_FOR_HUMAN_REVIEW') {
    return 'READY_FOR_HUMAN_REVIEW';
  }

  return 'ISSUES_FOUND';
}

export function evaluateProofCompleteness(input: {
  agreementId: string;
  milestoneId: string;
  proofId: string;
  milestoneTitle: string;
  milestoneDescription: string;
  proofContent: string;
  supplementalTexts?: string[];
}) {
  const parsedProof = parseProofBundle(input.proofContent);
  const artifactUrls = parsedProof.artifacts
    .filter((artifact) => artifact.kind === 'URL')
    .map((artifact) => artifact.content);
  const artifactImages = parsedProof.artifacts.filter((artifact) =>
    artifact.kind === 'IMAGE' || artifact.mimeType?.startsWith('image/')
  );
  const textBlocks = [
    parsedProof.summary,
    parsedProof.primaryText,
    ...(input.supplementalTexts || []),
    ...parsedProof.artifacts
      .filter((artifact) => artifact.kind === 'TEXT')
      .map((artifact) => artifact.content),
    ...artifactUrls,
  ].filter(Boolean);
  const combinedProofText = textBlocks.join('\n');
  const urls = unique([
    ...artifactUrls,
    ...extractUrls(parsedProof.summary),
    ...extractUrls(parsedProof.primaryText),
  ]);
  const txHashes = unique(extractTxHashes(`${combinedProofText}\n${input.milestoneTitle}\n${input.milestoneDescription}`));
  const screenshotExpected = /ui|ux|design|frontend|screen|demo|landing|page|visual|mockup/i.test(
    `${input.milestoneTitle} ${input.milestoneDescription}`
  );
  const txHashExpected = /deploy|transaction|tx|hash|wallet|ckb|fiber|payment|transfer|onchain|on-chain/i.test(
    `${input.milestoneTitle} ${input.milestoneDescription} ${combinedProofText}`
  );

  const checklist: ProofCheckChecklistItem[] = [
    buildChecklistItem({
      key: 'links',
      label: 'Links present',
      status: urls.length ? 'PRESENT' : 'MISSING',
      detail: urls.length
        ? `${urls.length} link${urls.length === 1 ? '' : 's'} included in the proof bundle.`
        : 'No link evidence was found in the summary, notes, or URL artifacts.',
      warning: urls.length ? undefined : 'Add at least one shareable link to the delivered work, repo, document, or demo.',
    }),
    txHashExpected
      ? buildChecklistItem({
          key: 'tx_hash',
          label: txHashes.length ? 'Tx hash present' : 'Tx hash optional',
          status: txHashes.length ? 'PRESENT' : 'NOT_APPLICABLE',
          detail: txHashes.length
            ? `${txHashes.length} transaction hash${txHashes.length === 1 ? '' : 'es'} detected.`
            : 'No transaction hash was included. Transaction hashes are optional unless the reviewer specifically requests one.',
        })
      : buildChecklistItem({
          key: 'tx_hash',
          label: 'Tx hash optional',
          status: 'NOT_APPLICABLE',
          detail: 'No transaction hash is required for this proof submission.',
        }),
    screenshotExpected
      ? buildChecklistItem({
          key: 'screenshots',
          label: 'Screenshots present',
          status: artifactImages.length ? 'PRESENT' : 'MISSING',
          detail: artifactImages.length
            ? `${artifactImages.length} screenshot${artifactImages.length === 1 ? '' : 's'} or image attachments included.`
            : 'No screenshot or image evidence was attached for a milestone that looks visual in nature.',
          warning: artifactImages.length ? undefined : 'Attach screenshots or visual evidence so the reviewer can verify the delivered result faster.',
        })
      : buildChecklistItem({
          key: 'screenshots',
          label: 'Screenshots present',
          status: artifactImages.length ? 'PRESENT' : 'NOT_APPLICABLE',
          detail: artifactImages.length
            ? `${artifactImages.length} screenshot${artifactImages.length === 1 ? '' : 's'} or image attachments included.`
            : 'No visual evidence was expected for this milestone.',
        }),
    computeScopeChecklist({
      milestoneTitle: input.milestoneTitle,
      milestoneDescription: input.milestoneDescription,
      proofText: combinedProofText,
    }),
  ];

  const warnings = checklist
    .filter((item) => item.status === 'MISSING' || item.status === 'PARTIAL')
    .map((item) => item.warning)
    .filter((warning): warning is string => Boolean(warning));
  const issueCount = checklist.filter((item) => item.status === 'MISSING').length;
  const warningCount = checklist.filter((item) => item.status === 'PARTIAL').length;
  const status: ProofCheckStatus = issueCount > 0 || warningCount > 0
    ? 'NEEDS_MORE_INFO'
    : 'READY_FOR_HUMAN_REVIEW';

  return {
    agreementId: input.agreementId,
    milestoneId: input.milestoneId,
    proofId: input.proofId,
    checkedAt: new Date().toISOString(),
    status,
    lifecycleStatus: mapProofCheckStatusToPersisted(status),
    summary:
      status === 'READY_FOR_HUMAN_REVIEW'
        ? 'The submitted proof covers the expected basics and looks ready for a human reviewer.'
        : 'The submitted proof is missing some evidence or context before human review will be efficient.',
    issueCount,
    warningCount,
    warnings,
    checklist,
  } satisfies ProofCheckResult;
}

async function evaluateProofCompletenessWithAI(input: {
  agreementId: string;
  milestoneId: string;
  proofId: string;
  milestoneTitle: string;
  milestoneDescription: string;
  proofContent: string;
  supplementalTexts?: string[];
  reviewRequests?: Array<{
    id: string;
    status: string;
    note: string | null;
    questions: string[];
    responseContent: string | null;
    respondedAt: string | null;
  }>;
}) {
  const parsedProof = parseProofBundle(input.proofContent);
  const heuristic = evaluateProofCompleteness(input);

  if (!canUseOpenAI()) {
    return heuristic;
  }

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string' },
      status: {
        type: 'string',
        enum: ['READY_FOR_HUMAN_REVIEW', 'NEEDS_MORE_INFO'],
      },
      checklist: {
        type: 'array',
        minItems: 4,
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            key: {
              type: 'string',
              enum: ['links', 'tx_hash', 'screenshots', 'scope'],
            },
            label: { type: 'string' },
            status: {
              type: 'string',
              enum: ['PRESENT', 'MISSING', 'PARTIAL', 'NOT_APPLICABLE'],
            },
            detail: { type: 'string' },
            warning: {
              anyOf: [
                { type: 'string' },
                { type: 'null' },
              ],
            },
          },
          required: ['key', 'label', 'status', 'detail', 'warning'],
        },
      },
    },
    required: ['summary', 'status', 'checklist'],
  };

  const systemPrompt = [
    'You are a careful proof completeness reviewer for milestone-based work agreements.',
    'Assess whether the submitted proof is complete enough for a human reviewer to efficiently review it.',
    'Be conservative and only mark READY_FOR_HUMAN_REVIEW when the proof clearly covers the basics.',
    'You must return exactly four checklist items with keys links, tx_hash, screenshots, and scope.',
    'A missing transaction hash must not block readiness. Mark tx_hash NOT_APPLICABLE when no transaction hash is supplied unless one is already present.',
    'Use NOT_APPLICABLE only when that evidence truly does not matter for this milestone.',
    'Warnings should be actionable and short.',
  ].join(' ');

  try {
    const aiOutput = await generateStructuredAiOutput<ProofCheckAiOutput>({
      schemaName: 'proof_completeness_review',
      schema,
      systemPrompt,
      userPayload: {
        agreementId: input.agreementId,
        milestoneId: input.milestoneId,
        proofId: input.proofId,
        milestoneTitle: input.milestoneTitle,
        milestoneDescription: input.milestoneDescription,
        proofBundle: parsedProof,
        supplementalTexts: input.supplementalTexts || [],
        reviewRequests: input.reviewRequests || [],
        heuristicBaseline: heuristic,
      },
    });

    const warnings = aiOutput.checklist
      .filter((item) => item.status === 'MISSING' || item.status === 'PARTIAL')
      .map((item) => item.warning)
      .filter((warning): warning is string => Boolean(warning));
    const issueCount = aiOutput.checklist.filter((item) => item.status === 'MISSING').length;
    const warningCount = aiOutput.checklist.filter((item) => item.status === 'PARTIAL').length;

    return {
      agreementId: input.agreementId,
      milestoneId: input.milestoneId,
      proofId: input.proofId,
      checkedAt: new Date().toISOString(),
      status: aiOutput.status,
      lifecycleStatus: mapProofCheckStatusToPersisted(aiOutput.status),
      summary: aiOutput.summary,
      issueCount,
      warningCount,
      warnings,
      checklist: aiOutput.checklist,
    } satisfies ProofCheckResult;
  } catch (error) {
    console.warn(
      `[AI] Falling back to heuristic proof checker: ${error instanceof Error ? error.message : String(error)}`
    );
    return heuristic;
  }
}

function serializeProofCheckRecord(record: {
  id: string;
  agreementId: string;
  milestoneId: string;
  proofId: string;
  status: string;
  issueCount: number;
  warningCount: number;
  summary: string;
  warningsJson: string | null;
  checklistJson: string | null;
  triggeredByAddress: string | null;
  triggeredByType: string;
  asyncJobId: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): SerializedProofCheckRecord {
  return {
    id: record.id,
    agreementId: record.agreementId,
    milestoneId: record.milestoneId,
    proofId: record.proofId,
    status: record.status as SerializedProofCheckRecord['status'],
    issueCount: record.issueCount,
    warningCount: record.warningCount,
    summary: record.summary,
    warnings: safeParseJson<string[]>(record.warningsJson, []),
    checklist: safeParseJson<ProofCheckChecklistItem[]>(record.checklistJson, []),
    triggeredByAddress: record.triggeredByAddress,
    triggeredByType: record.triggeredByType as 'USER' | 'SYSTEM',
    asyncJobId: record.asyncJobId,
    completedAt: record.completedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

async function getAgreementMilestoneProofOrThrow(agreementId: string, milestoneId: string) {
  const agreement = await prisma.agreement.findUnique({
    where: { id: agreementId },
    include: {
      milestones: {
        orderBy: { sortOrder: 'asc' },
        include: {
          proofs: {
            orderBy: { submittedAt: 'desc' },
          },
        },
      },
    },
  });

  if (!agreement) {
    throw new Error('Agreement not found');
  }

  const milestone = agreement.milestones.find((item) => item.id === milestoneId);
  if (!milestone) {
    throw new Error('Milestone not found');
  }

  const latestProof = milestone.proofs[0];
  if (!latestProof) {
    throw new Error('No submitted proof is available for this milestone yet');
  }

  const infoRequests = await prisma.infoRequest.findMany({
    where: {
      agreementId,
      milestoneId,
      OR: [
        { proofId: latestProof.id },
        { proofId: null },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return {
    agreement,
    milestone,
    latestProof,
    priorProofs: milestone.proofs.slice(1),
    infoRequests,
  };
}

export async function getLatestProofCheckForMilestone(agreementId: string, milestoneId: string) {
  const record = await prisma.proofCheck.findFirst({
    where: { agreementId, milestoneId },
    orderBy: [{ createdAt: 'desc' }],
  });

  return record ? serializeProofCheckRecord(record) : null;
}

export async function startProofReview(params: {
  agreementId: string;
  milestoneId: string;
  triggeredByAddress?: string | null;
  triggeredByType?: 'USER' | 'SYSTEM';
  asyncJobId?: string | null;
}) {
  const { latestProof } = await getAgreementMilestoneProofOrThrow(params.agreementId, params.milestoneId);

  const created = await prisma.$transaction(async (tx) => {
    await tx.proof.update({
      where: { id: latestProof.id },
      data: {
        reviewStatus: 'CHECKING',
      },
    });

    return tx.proofCheck.create({
      data: {
        id: randomUUID(),
        agreementId: params.agreementId,
        milestoneId: params.milestoneId,
        proofId: latestProof.id,
        status: 'CHECKING',
        issueCount: 0,
        warningCount: 0,
        summary: 'Proof check has been queued and is now running.',
        warningsJson: JSON.stringify([]),
        checklistJson: JSON.stringify([]),
        triggeredByAddress: params.triggeredByAddress ?? null,
        triggeredByType: params.triggeredByType || 'USER',
        asyncJobId: params.asyncJobId ?? null,
      },
    });
  });

  return serializeProofCheckRecord(created);
}

export async function completeProofReview(params: {
  agreementId: string;
  milestoneId: string;
  proofCheckId?: string | null;
  triggeredByAddress?: string | null;
  triggeredByType?: 'USER' | 'SYSTEM';
  skipAudit?: boolean;
}) {
  const { milestone, latestProof, priorProofs, infoRequests } = await getAgreementMilestoneProofOrThrow(params.agreementId, params.milestoneId);
  const priorProofTexts = priorProofs.flatMap((proof) => {
    const parsed = parseProofBundle(proof.content);
    return [
      parsed.summary,
      parsed.primaryText,
      ...parsed.artifacts
        .filter((artifact) => artifact.kind === 'TEXT' || artifact.kind === 'URL')
        .map((artifact) => artifact.content),
    ].filter(Boolean);
  });
  const supplementalTexts = infoRequests
    .map((request) => request.responseContent?.trim())
    .filter((value): value is string => Boolean(value));
  const result = await evaluateProofCompletenessWithAI({
    agreementId: params.agreementId,
    milestoneId: params.milestoneId,
    proofId: latestProof.id,
    milestoneTitle: milestone.title,
    milestoneDescription: milestone.description,
    proofContent: latestProof.content,
    supplementalTexts: [...priorProofTexts, ...supplementalTexts],
    reviewRequests: infoRequests.map((request) => ({
      id: request.id,
      status: request.status,
      note: request.note,
      questions: safeParseJson<string[]>(request.questionsJson, []),
      responseContent: request.responseContent,
      respondedAt: request.respondedAt?.toISOString() ?? null,
    })),
  });

  const hasOpenInfoRequest = infoRequests.some((request) => request.status === 'OPEN');
  const persistedStatus: Exclude<PersistedProofReviewStatus, 'UNREVIEWED' | 'CHECKING'> =
    result.status === 'READY_FOR_HUMAN_REVIEW'
      ? 'READY_FOR_HUMAN_REVIEW'
      : hasOpenInfoRequest
        ? 'NEEDS_MORE_INFO'
        : 'ISSUES_FOUND';
  const completedAt = new Date(result.checkedAt);
  const finalizedResult: ProofCheckResult = {
    ...result,
    lifecycleStatus: persistedStatus,
  };

  const proofCheckRecord = await prisma.$transaction(async (tx) => {
    let proofCheck = params.proofCheckId
      ? await tx.proofCheck.findUnique({
          where: { id: params.proofCheckId },
        })
      : null;

    if (!proofCheck) {
      proofCheck = await tx.proofCheck.create({
        data: {
          id: randomUUID(),
          agreementId: params.agreementId,
          milestoneId: params.milestoneId,
          proofId: latestProof.id,
          status: 'CHECKING',
          issueCount: 0,
          warningCount: 0,
          summary: 'Proof check started.',
          warningsJson: JSON.stringify([]),
          checklistJson: JSON.stringify([]),
          triggeredByAddress: params.triggeredByAddress ?? null,
          triggeredByType: params.triggeredByType || 'USER',
        },
      });
    }

    await tx.proof.update({
      where: { id: latestProof.id },
      data: {
        reviewStatus: persistedStatus,
        lastCheckedAt: completedAt,
      },
    });

    return tx.proofCheck.update({
      where: { id: proofCheck.id },
      data: {
        proofId: latestProof.id,
        status: persistedStatus,
        issueCount: finalizedResult.issueCount,
        warningCount: finalizedResult.warningCount,
        summary: finalizedResult.summary,
        warningsJson: JSON.stringify(finalizedResult.warnings),
        checklistJson: JSON.stringify(finalizedResult.checklist),
        triggeredByAddress: proofCheck.triggeredByAddress || params.triggeredByAddress || null,
        triggeredByType: proofCheck.triggeredByType || params.triggeredByType || 'USER',
        completedAt,
      },
    });
  });

  await createLog({
    agreementId: params.agreementId,
    level: finalizedResult.status === 'READY_FOR_HUMAN_REVIEW' ? 'SUCCESS' : 'WARN',
    eventType: finalizedResult.status === 'READY_FOR_HUMAN_REVIEW' ? 'RULE_CHECK_PASSED' : 'RULE_CHECK_FAILED',
    message:
      finalizedResult.status === 'READY_FOR_HUMAN_REVIEW'
        ? `Proof completeness check passed for milestone ${milestone.sortOrder}: ${milestone.title}`
        : persistedStatus === 'NEEDS_MORE_INFO'
          ? `Proof completeness check is waiting on requested follow-up information for milestone ${milestone.sortOrder}: ${milestone.title}`
          : `Proof completeness check found missing context for milestone ${milestone.sortOrder}: ${milestone.title}`,
    metadata: {
      ...finalizedResult,
      proofCheckId: proofCheckRecord.id,
      persistedStatus,
    },
  });

  if (!params.skipAudit) {
    await createAuditLog({
      agreementId: params.agreementId,
      actorAddress: params.triggeredByAddress ?? null,
      actorType: params.triggeredByType || 'USER',
      action: 'PROOF_CHECK_COMPLETED',
      resourceType: 'PROOF',
      resourceId: latestProof.id,
      metadata: {
        ...finalizedResult,
        proofCheckId: proofCheckRecord.id,
        lifecycleStatus: persistedStatus,
      },
    });
  }

  return {
    result: finalizedResult,
    proofCheck: serializeProofCheckRecord(proofCheckRecord),
  };
}

export async function markProofNeedsMoreInfo(params: {
  agreementId: string;
  milestoneId: string;
  proofId?: string | null;
  summary?: string | null;
}) {
  const { latestProof } = await getAgreementMilestoneProofOrThrow(params.agreementId, params.milestoneId);
  const proofId = params.proofId || latestProof.id;

  const latestProofCheck = await prisma.proofCheck.findFirst({
    where: {
      agreementId: params.agreementId,
      milestoneId: params.milestoneId,
      proofId,
    },
    orderBy: { createdAt: 'desc' },
  });

  await prisma.proof.update({
    where: { id: proofId },
    data: {
      reviewStatus: 'NEEDS_MORE_INFO',
    },
  });

  if (!latestProofCheck || latestProofCheck.status === 'CHECKING') {
    return latestProofCheck ? serializeProofCheckRecord(latestProofCheck) : null;
  }

  const updated = await prisma.proofCheck.update({
    where: { id: latestProofCheck.id },
    data: {
      status: 'NEEDS_MORE_INFO',
      summary: params.summary?.trim() || latestProofCheck.summary,
    },
  });

  return serializeProofCheckRecord(updated);
}

export async function reviewSubmittedProof(
  agreementId: string,
  milestoneId: string,
  options?: {
    triggeredByAddress?: string | null;
    triggeredByType?: 'USER' | 'SYSTEM';
    proofCheckId?: string | null;
    skipAudit?: boolean;
  }
) {
  const { result } = await completeProofReview({
    agreementId,
    milestoneId,
    proofCheckId: options?.proofCheckId,
    triggeredByAddress: options?.triggeredByAddress,
    triggeredByType: options?.triggeredByType,
    skipAudit: options?.skipAudit,
  });

  return result;
}
