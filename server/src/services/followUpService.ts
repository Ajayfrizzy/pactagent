import { randomUUID } from 'crypto';
import { prisma } from '../db';
import type { ProofCheckResult } from './reportReviewService';
import { canUseOpenAI, generateStructuredAiOutput } from './aiStructuredService';

export type FollowUpDraft = {
  milestoneId: string;
  proofId: string;
  summary: string;
  prompts: string[];
  basedOnStatus: ProofCheckResult['status'];
};

export type InfoRequestRecord = {
  requestId: string;
  milestoneId: string;
  proofId: string | null;
  requestedBy: string | null;
  questions: string[];
  note: string | null;
  createdAt: string;
  resolved: boolean;
  resolvedAt: string | null;
  responseBy: string | null;
  responsePreview: string | null;
  requestType: 'STRUCTURED_REVIEW_REQUEST' | 'MESSAGE';
  status: 'OPEN' | 'RESPONDED' | 'CLOSED';
  commentId: string | null;
  responseCommentId: string | null;
};

type LegacyAuditLogLike = {
  action: string;
  actorAddress: string | null;
  metadataJson: string | null;
  createdAt: Date | string;
};

function safeParseJson<T>(value: string | null | undefined): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function serializeInfoRequest(record: {
  id: string;
  milestoneId: string;
  proofId: string | null;
  requestedBy: string;
  note: string | null;
  questionsJson: string;
  responseContent: string | null;
  respondedBy: string | null;
  respondedAt: Date | null;
  createdAt: Date;
  requestType: string;
  status: string;
  commentId: string | null;
  responseCommentId: string | null;
}): InfoRequestRecord {
  return {
    requestId: record.id,
    milestoneId: record.milestoneId,
    proofId: record.proofId,
    requestedBy: record.requestedBy || null,
    questions: safeParseJson<string[]>(record.questionsJson) || [],
    note: record.note,
    createdAt: record.createdAt.toISOString(),
    resolved: record.status !== 'OPEN',
    resolvedAt: record.respondedAt?.toISOString() ?? null,
    responseBy: record.respondedBy || null,
    responsePreview: record.responseContent ? record.responseContent.slice(0, 240) : null,
    requestType: (record.requestType as 'STRUCTURED_REVIEW_REQUEST' | 'MESSAGE') || 'STRUCTURED_REVIEW_REQUEST',
    status: (record.status as 'OPEN' | 'RESPONDED' | 'CLOSED') || 'OPEN',
    commentId: record.commentId,
    responseCommentId: record.responseCommentId,
  };
}

export function generateFollowUpDraft(params: {
  milestoneId: string;
  milestoneTitle: string;
  proofCheck: ProofCheckResult;
}) {
  const prompts = params.proofCheck.checklist
    .filter((item) => item.status === 'MISSING' || item.status === 'PARTIAL')
    .map((item) => {
      switch (item.key) {
        case 'links':
          return `Can you share the direct links for ${params.milestoneTitle}, including the main deliverable, repo, document, or live demo?`;
        case 'tx_hash':
          return `Can you include the relevant transaction hash for ${params.milestoneTitle} so the on-chain step can be verified?`;
        case 'screenshots':
          return `Can you attach screenshots or image evidence that show the delivered result for ${params.milestoneTitle}?`;
        case 'scope':
          return `Can you explain how the submitted proof maps to the agreed milestone scope for ${params.milestoneTitle}?`;
        default:
          return item.warning || `Can you add the missing context for ${params.milestoneTitle}?`;
      }
    });

  return {
    milestoneId: params.milestoneId,
    proofId: params.proofCheck.proofId,
    summary:
      prompts.length
        ? `Ask for ${prompts.length} targeted follow-up ${prompts.length === 1 ? 'item' : 'items'} before approving this milestone.`
        : 'No follow-up prompts were generated because the proof already looks ready for human review.',
    prompts,
    basedOnStatus: params.proofCheck.status,
  } satisfies FollowUpDraft;
}

type FollowUpDraftAiOutput = {
  summary: string;
  prompts: string[];
};

export async function generateFollowUpDraftWithAI(params: {
  milestoneId: string;
  milestoneTitle: string;
  milestoneDescription?: string | null;
  proofCheck: ProofCheckResult;
}) {
  const fallback = generateFollowUpDraft({
    milestoneId: params.milestoneId,
    milestoneTitle: params.milestoneTitle,
    proofCheck: params.proofCheck,
  });

  if (!canUseOpenAI()) {
    return fallback;
  }

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string' },
      prompts: {
        type: 'array',
        minItems: 0,
        maxItems: 6,
        items: {
          type: 'string',
          minLength: 8,
          maxLength: 400,
        },
      },
    },
    required: ['summary', 'prompts'],
  };

  const systemPrompt = [
    'You draft reviewer follow-up questions for incomplete milestone proof submissions.',
    'Use the proof checker output to ask only for the missing evidence or missing explanation.',
    'Write direct, polite reviewer questions that a worker can answer concretely.',
    'Do not ask duplicate questions or request information already marked present.',
    'If the proof is already ready, return zero prompts.',
  ].join(' ');

  try {
    const aiOutput = await generateStructuredAiOutput<FollowUpDraftAiOutput>({
      schemaName: 'follow_up_draft',
      schema,
      systemPrompt,
      userPayload: {
        milestoneId: params.milestoneId,
        milestoneTitle: params.milestoneTitle,
        milestoneDescription: params.milestoneDescription || null,
        proofCheck: params.proofCheck,
        fallback,
      },
    });

    const prompts = aiOutput.prompts
      .map((prompt) => prompt.trim())
      .filter(Boolean);

    return {
      milestoneId: params.milestoneId,
      proofId: params.proofCheck.proofId,
      summary: aiOutput.summary.trim() || fallback.summary,
      prompts: prompts.length ? prompts : fallback.prompts,
      basedOnStatus: params.proofCheck.status,
    } satisfies FollowUpDraft;
  } catch (error) {
    console.warn(
      `[AI] Falling back to deterministic follow-up draft: ${error instanceof Error ? error.message : String(error)}`
    );
    return fallback;
  }
}

export function buildInfoRequestComment(params: {
  requestId: string;
  milestoneLabel: string;
  milestoneTitle: string;
  questions: string[];
  note?: string | null;
}) {
  const questionBlock = params.questions.map((question, index) => `${index + 1}. ${question}`).join('\n');
  const noteBlock = params.note?.trim() ? `\n\nReviewer note:\n${params.note.trim()}` : '';

  return [
    `Info request ${params.requestId}`,
    `${params.milestoneLabel}: ${params.milestoneTitle}`,
    '',
    questionBlock,
    noteBlock,
  ].join('\n').trim();
}

export function buildInfoResponseComment(params: {
  requestId: string;
  milestoneLabel: string;
  milestoneTitle: string;
  content: string;
}) {
  return [
    `Info response for ${params.requestId}`,
    `${params.milestoneLabel}: ${params.milestoneTitle}`,
    '',
    params.content.trim(),
  ].join('\n');
}

export function parseInfoRequestRecords(logs: LegacyAuditLogLike[]) {
  const records = new Map<string, InfoRequestRecord>();

  logs.forEach((entry) => {
    const metadata = safeParseJson<Record<string, unknown>>(entry.metadataJson);
    if (!metadata || typeof metadata.requestId !== 'string' || typeof metadata.milestoneId !== 'string') {
      return;
    }

    if (entry.action === 'INFO_REQUESTED') {
      records.set(metadata.requestId, {
        requestId: metadata.requestId,
        milestoneId: metadata.milestoneId,
        proofId: typeof metadata.proofId === 'string' ? metadata.proofId : null,
        requestedBy: entry.actorAddress,
        questions: Array.isArray(metadata.questions)
          ? metadata.questions.filter((item): item is string => typeof item === 'string')
          : [],
        note: typeof metadata.note === 'string' ? metadata.note : null,
        createdAt: new Date(entry.createdAt).toISOString(),
        resolved: false,
        resolvedAt: null,
        responseBy: null,
        responsePreview: null,
        requestType: 'STRUCTURED_REVIEW_REQUEST',
        status: 'OPEN',
        commentId: typeof metadata.commentId === 'string' ? metadata.commentId : null,
        responseCommentId: null,
      });
      return;
    }

    if (entry.action === 'INFO_RECEIVED') {
      const existing = records.get(metadata.requestId);
      if (!existing) {
        return;
      }

      existing.resolved = true;
      existing.status = 'RESPONDED';
      existing.resolvedAt = new Date(entry.createdAt).toISOString();
      existing.responseBy = entry.actorAddress;
      existing.responsePreview =
        typeof metadata.responsePreview === 'string'
          ? metadata.responsePreview
          : null;
      existing.responseCommentId =
        typeof metadata.commentId === 'string'
          ? metadata.commentId
          : null;
    }
  });

  return Array.from(records.values()).sort((left, right) =>
    new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
}

export async function createStructuredInfoRequest(params: {
  agreementId: string;
  milestoneId: string;
  proofId?: string | null;
  requestedBy: string;
  questions: string[];
  note?: string | null;
  requestType?: 'STRUCTURED_REVIEW_REQUEST' | 'MESSAGE';
  commentId?: string | null;
}) {
  const created = await prisma.infoRequest.create({
    data: {
      id: createInfoRequestId(),
      agreementId: params.agreementId,
      milestoneId: params.milestoneId,
      proofId: params.proofId ?? null,
      requestType: params.requestType || 'STRUCTURED_REVIEW_REQUEST',
      status: 'OPEN',
      requestedBy: params.requestedBy,
      note: params.note?.trim() || null,
      questionsJson: JSON.stringify(params.questions),
      commentId: params.commentId ?? null,
    },
  });

  return serializeInfoRequest(created);
}

export async function respondToStructuredInfoRequest(params: {
  agreementId: string;
  requestId: string;
  responderAddress: string;
  content: string;
  responseCommentId?: string | null;
}) {
  const updated = await prisma.infoRequest.update({
    where: { id: params.requestId },
    data: {
      status: 'RESPONDED',
      responseContent: params.content.trim(),
      respondedBy: params.responderAddress,
      respondedAt: new Date(),
      responseCommentId: params.responseCommentId ?? null,
    },
  });

  return serializeInfoRequest(updated);
}

export async function closeStructuredInfoRequest(requestId: string) {
  const updated = await prisma.infoRequest.update({
    where: { id: requestId },
    data: {
      status: 'CLOSED',
    },
  });

  return serializeInfoRequest(updated);
}

export async function getInfoRequestRecordsForAgreement(agreementId: string) {
  const records = await prisma.infoRequest.findMany({
    where: { agreementId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  if (records.length) {
    return records.map(serializeInfoRequest);
  }

  const logs = await prisma.auditLog.findMany({
    where: {
      agreementId,
      action: {
        in: ['INFO_REQUESTED', 'INFO_RECEIVED'],
      },
    },
    take: 100,
    orderBy: { createdAt: 'asc' },
  });

  return parseInfoRequestRecords(logs);
}

export async function findInfoRequestRecord(agreementId: string, requestId: string) {
  const record = await prisma.infoRequest.findUnique({
    where: { id: requestId },
  });

  if (record && record.agreementId === agreementId) {
    return serializeInfoRequest(record);
  }

  const records = await getInfoRequestRecordsForAgreement(agreementId);
  return records.find((item: any) => item.requestId === requestId) || null;
}

export function createInfoRequestId() {
  return `req_${randomUUID().slice(0, 8)}`;
}
