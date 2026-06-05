'use client';
import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ccc } from '@ckb-ccc/connector-react';
import { WalletConnect } from '@/components/WalletConnect';
import { NavbarMenu } from '@/components/NavbarMenu';
import { BrandLogo } from '@/components/BrandLogo';
import { AgentLogPanel } from '@/components/AgentLogPanel';
import { StatusBadge, NetworkBadge, getStatusMeta } from '@/components/StatusBadge';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useStore } from '@/lib/store';
import {
  ckbToShannons,
  formatCkbAmount,
  getMinimumMilestoneCapacity,
  sendCapacityTransfer,
  sendOnchainEscrowFunding,
  sendOnchainEscrowResolution,
  shannonsToCKB,
  withTimeout,
  MIN_CELL_CAPACITY,
} from '@/lib/ckb';
import * as api from '@/lib/api';
import {
  type DraftArtifact,
  isDownloadableArtifact,
  isImageArtifact,
  MAX_ARTIFACT_SIZE_LABEL,
  parseDisputeEvidenceBundle,
  parseProofBundle,
  readFilesAsArtifacts,
} from '@/lib/richPayloads';
import {
  AgentIcon,
  ArrowLeftIcon,
  CurrencyDollarIcon,
  PaperClipIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
  ScaleIcon,
  LinkIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  TrophyIcon,
  SparklesIcon,
} from '@/components/Icons';

const currentMilestoneStatuses = ['ACTIVE', 'PROOF_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'DISPUTED'];

function canSignerFundAgreement(signer: ccc.Signer | undefined) {
  return signer?.type === ccc.SignerType.CKB || signer?.type === ccc.SignerType.EVM;
}

function isLikelyCkbAddress(value: string) {
  const trimmed = value.trim().toLowerCase();
  return /^(ckt|ckb)1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{20,}$/i.test(trimmed);
}

const TX_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

function getParticipantLabel(
  address: string,
  agreement: { clientAddress: string; workerAddress: string }
) {
  if (address === agreement.clientAddress) {
    return 'Client';
  }

  if (address === agreement.workerAddress) {
    return 'Worker';
  }
  return 'Participant';
}

function formatAuditActionTitle(action: string) {
  switch (action) {
    case 'AGREEMENT_IMPORTED_FROM_BOUNTY':
      return 'Agreement imported from bounty';
    case 'INFO_REQUESTED':
      return 'More information requested';
    case 'INFO_RECEIVED':
      return 'Information received';
    case 'PROOF_CHECK_STARTED':
      return 'Proof review started';
    case 'PROOF_CHECK_COMPLETED':
      return 'Proof review completed';
    default:
      return action.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
  }
}

function isLikelySpentOutPointError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('TransactionFailedToResolve')
    || message.includes('Unknown(OutPoint(')
    || message.includes('Could not find the escrow cell on-chain for this milestone.')
  );
}

function getRecommendationAvailability(dispute: any, agreement: any) {
  if (!dispute) {
    return null;
  }

  const responseDeadlineAt = new Date(
    new Date(dispute.createdAt).getTime() + (agreement.disputeWindowSecs * 1000)
  );
  const counterpartyAddress =
    dispute.openedBy === agreement.clientAddress
      ? agreement.workerAddress
      : dispute.openedBy === agreement.workerAddress
        ? agreement.clientAddress
        : null;
  const hasCounterpartyReply = counterpartyAddress
    ? (dispute.evidenceEntries || []).some((entry: any) => entry.submittedBy === counterpartyAddress)
    : (dispute.evidenceEntries || []).some((entry: any) => entry.submittedBy !== dispute.openedBy);
  const responseWindowExpired = Date.now() >= responseDeadlineAt.getTime();

  return {
    ready: hasCounterpartyReply || responseWindowExpired,
    counterpartyAddress,
    hasCounterpartyReply,
    responseWindowExpired,
    responseDeadlineAt,
  };
}

function getMilestonePhaseLabel(status: string) {
  switch (status) {
    case 'PENDING':
      return 'Queued';
    case 'ACTIVE':
      return 'In delivery';
    case 'PROOF_SUBMITTED':
      return 'Proof delivered';
    case 'UNDER_REVIEW':
      return 'Awaiting review';
    case 'APPROVED':
      return 'Approved for payout';
    case 'PAID':
      return 'Paid out';
    case 'DISPUTED':
      return 'Blocked by dispute';
    case 'REFUNDED':
      return 'Refunded';
    case 'EXPIRED':
      return 'Expired';
    default:
      return getStatusMeta(status).label;
  }
}

function describeMissingSourceFields(fields: string[] | null | undefined) {
  if (!Array.isArray(fields) || !fields.length) {
    return null;
  }

  if (fields.length === 1 && fields[0] === 'fundingAddress') {
    return 'The original forum thread did not include a funding wallet address.';
  }

  return `The original forum thread is still missing: ${fields.join(', ')}.`;
}

function isSponsorControlledImportedAgreement(agreement: any) {
  return agreement?.source?.sourceType === 'BOUNTY' || agreement?.source?.sourceType === 'DAO';
}

type LifecycleStepState = 'complete' | 'current' | 'upcoming' | 'blocked';

function getLifecycleStepStyles(state: LifecycleStepState) {
  switch (state) {
    case 'complete':
      return {
        ring: 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200',
        dot: 'bg-emerald-400',
        line: 'bg-emerald-500/40',
      };
    case 'current':
      return {
        ring: 'border-agent-accent/60 bg-agent-accent/10 text-agent-accent',
        dot: 'bg-agent-accent',
        line: 'bg-agent-accent/40',
      };
    case 'blocked':
      return {
        ring: 'border-rose-700/50 bg-rose-950/20 text-rose-200',
        dot: 'bg-rose-400',
        line: 'bg-rose-700/40',
      };
    default:
      return {
        ring: 'border-agent-border bg-agent-bg/70 text-gray-300',
        dot: 'bg-gray-500',
        line: 'bg-agent-border',
      };
  }
}

function getAgreementUnavailableState(error: string | null) {
  const message = (error || '').toLowerCase();

  if (message.includes('can\'t reach database server') || message.includes('prisma.')) {
    return {
      title: 'Agreement temporarily unavailable',
      body: 'PactAgent could not reach the agreement service just now. This is usually a temporary server or database connection issue, not a problem with your wallet or agreement.',
      hint: 'Wait a moment and try again. If it keeps happening, the server connection needs attention.',
    };
  }

  if (message.includes('not found') || message.includes('no longer exist')) {
    return {
      title: 'Agreement not found',
      body: 'This agreement could not be found. It may have been removed, the link may be incomplete, or this wallet may not have access to it.',
      hint: 'Check the agreement link or return to your dashboard and open it again from there.',
    };
  }

  if (message.includes('unauthorized') || message.includes('forbidden') || message.includes('not belong to the connected wallet')) {
    return {
      title: 'This agreement is not available for this wallet',
      body: 'The connected wallet does not currently have access to this agreement view.',
      hint: 'Reconnect with the correct participant wallet or open the agreement from the right account.',
    };
  }

  if (message.includes('failed to fetch') || message.includes('network')) {
    return {
      title: 'PactAgent could not load this agreement',
      body: 'The app could not reach the server successfully, so the agreement details could not be loaded.',
      hint: 'Check your internet connection and try again in a moment.',
    };
  }

  return {
    title: 'Agreement unavailable',
    body: 'This agreement could not be loaded right now. It may be temporarily unavailable or the current wallet may not have access to it.',
    hint: 'Try again shortly, or return to the dashboard and reopen the agreement from your list.',
  };
}

function ReviewerDecisionDraftPanel({
  reviewerDecisionNote,
  setReviewerDecisionNote,
  humanApprovalConfirmed,
  setHumanApprovalConfirmed,
  acknowledgeProofCheck,
  setAcknowledgeProofCheck,
  acknowledgeAiSuggestion,
  setAcknowledgeAiSuggestion,
  displayedRecommendation,
  currentOpenInfoRequestsCount,
  waitingForReview = false,
}: {
  reviewerDecisionNote: string;
  setReviewerDecisionNote: (value: string) => void;
  humanApprovalConfirmed: boolean;
  setHumanApprovalConfirmed: (value: boolean) => void;
  acknowledgeProofCheck: boolean;
  setAcknowledgeProofCheck: (value: boolean) => void;
  acknowledgeAiSuggestion: boolean;
  setAcknowledgeAiSuggestion: (value: boolean) => void;
  displayedRecommendation: any;
  currentOpenInfoRequestsCount: number;
  waitingForReview?: boolean;
}) {
  return (
    <div className="mb-4 rounded-xl border border-emerald-800/40 bg-emerald-950/20 p-4">
      <div className="text-[11px] uppercase tracking-[0.16em] text-emerald-300">Final Reviewer Action</div>
      <h4 className="mt-2 text-sm font-semibold text-white">
        {waitingForReview ? 'Reviewer note draft' : 'Human confirmation checkpoint'}
      </h4>
      <p className="mt-1 text-xs text-gray-300">
        {waitingForReview
          ? 'You can draft the payout decision note while the background review is still running. Human approval is still available immediately if you already verified the work yourself.'
          : 'AI signals are suggestions only. A person still needs to review the evidence and explicitly confirm the payout decision.'}
      </p>
      <textarea
        className="mt-3 min-h-[88px] w-full rounded-lg border border-agent-border bg-agent-bg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
        placeholder="Reviewer decision note..."
        value={reviewerDecisionNote}
        onChange={(e) => setReviewerDecisionNote(e.target.value)}
      />
      <label className="mt-3 flex items-start gap-3 text-sm text-gray-200">
        <input
          type="checkbox"
          className="mt-1"
          checked={humanApprovalConfirmed}
          onChange={(e) => setHumanApprovalConfirmed(e.target.checked)}
        />
        <span>I reviewed the submitted proof myself and I want to approve this milestone.</span>
      </label>
      <label className="mt-3 flex items-start gap-3 text-sm text-gray-200">
        <input
          type="checkbox"
          className="mt-1"
          checked={acknowledgeProofCheck}
          onChange={(e) => setAcknowledgeProofCheck(e.target.checked)}
        />
        <span>I used the proof checker as a suggested pre-review aid, not as the final decision maker.</span>
      </label>
      {displayedRecommendation ? (
        <label className="mt-3 flex items-start gap-3 text-sm text-gray-200">
          <input
            type="checkbox"
            className="mt-1"
            checked={acknowledgeAiSuggestion}
            onChange={(e) => setAcknowledgeAiSuggestion(e.target.checked)}
          />
          <span>I understand the AI recommendation is suggested only and does not approve payout by itself.</span>
        </label>
      ) : null}
      {waitingForReview ? (
        <div className="mt-3 rounded-lg border border-yellow-800/40 bg-yellow-950/20 px-3 py-2 text-xs text-yellow-100">
          PactAgent is still reviewing in the background, but you can approve payout now if your manual review is complete.
        </div>
      ) : null}
      {currentOpenInfoRequestsCount > 0 ? (
        <div className="mt-3 rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-100">
          There {currentOpenInfoRequestsCount === 1 ? 'is still 1 open info request' : `are still ${currentOpenInfoRequestsCount} open info requests`} on this milestone, but they no longer lock manual payout approval.
        </div>
      ) : null}
    </div>
  );
}

function ArtifactPreviewList({
  artifacts,
  onRemove,
}: {
  artifacts: DraftArtifact[];
  onRemove?: (id: string) => void;
}) {
  if (!artifacts.length) {
    return null;
  }

  return (
    <div className="space-y-2">
      {artifacts.map((artifact) => (
        <div key={artifact.id} className="rounded-lg border border-agent-border bg-agent-bg/60 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-white">{artifact.label}</div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500">{artifact.kind}</div>
            </div>
            {onRemove ? (
              <button
                type="button"
                onClick={() => onRemove(artifact.id)}
                className="text-xs text-red-300 hover:text-red-200"
              >
                Remove
              </button>
            ) : null}
          </div>

          {isImageArtifact(artifact) ? (
            <img src={artifact.content} alt={artifact.label} className="max-h-48 rounded-lg border border-agent-border object-contain" />
          ) : artifact.kind === 'URL' ? (
            <a
              href={artifact.content}
              target="_blank"
              rel="noreferrer"
              className="break-all text-sm text-agent-accent hover:underline"
            >
              {artifact.content}
            </a>
          ) : artifact.kind === 'TEXT' ? (
            <p className="whitespace-pre-wrap text-sm text-gray-300">{artifact.content}</p>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-gray-400">
                {artifact.mimeType || 'Attached file'}{artifact.sizeBytes ? ` · ${artifact.sizeBytes} bytes` : ''}
              </div>
              {isDownloadableArtifact(artifact) ? (
                <a
                  href={artifact.content}
                  download={artifact.label}
                  className="inline-flex items-center gap-2 rounded-lg border border-agent-border px-3 py-2 text-xs text-gray-200 hover:bg-agent-card"
                >
                  Download Attachment
                </a>
              ) : null}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

type ProofCheckChecklistStatus = 'PRESENT' | 'MISSING' | 'PARTIAL' | 'NOT_APPLICABLE';
type ProofCheckStatus = 'READY_FOR_HUMAN_REVIEW' | 'NEEDS_MORE_INFO';

type ProofCheckChecklistItem = {
  key: 'links' | 'tx_hash' | 'screenshots' | 'scope';
  label: string;
  status: ProofCheckChecklistStatus;
  detail: string;
  warning: string | null;
};

type ProofCheckResult = {
  agreementId: string;
  milestoneId: string;
  proofId: string;
  checkedAt: string;
  status: ProofCheckStatus;
  lifecycleStatus?: 'UNREVIEWED' | 'CHECKING' | 'ISSUES_FOUND' | 'READY_FOR_HUMAN_REVIEW' | 'NEEDS_MORE_INFO';
  summary: string;
  issueCount: number;
  warningCount: number;
  warnings: string[];
  checklist: ProofCheckChecklistItem[];
};

type PersistedProofCheckRecord = {
  id: string;
  agreementId: string;
  milestoneId: string;
  proofId: string;
  status: 'CHECKING' | 'ISSUES_FOUND' | 'READY_FOR_HUMAN_REVIEW' | 'NEEDS_MORE_INFO';
  issueCount: number;
  warningCount: number;
  summary: string;
  warningsJson?: string | null;
  checklistJson?: string | null;
  warnings?: string[];
  checklist?: ProofCheckChecklistItem[];
  triggeredByAddress?: string | null;
  triggeredByType?: 'USER' | 'SYSTEM';
  asyncJobId?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
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

function getProofCheckResultFromAuditEntry(entry: any): ProofCheckResult | null {
  if (entry?.action !== 'PROOF_CHECK_COMPLETED') {
    return null;
  }

  const parsed = safeParseJson<Partial<ProofCheckResult>>(entry.metadataJson);
  if (!parsed || typeof parsed.milestoneId !== 'string' || typeof parsed.proofId !== 'string') {
    return null;
  }

  return {
    agreementId: typeof parsed.agreementId === 'string' ? parsed.agreementId : '',
    milestoneId: parsed.milestoneId,
    proofId: parsed.proofId,
    checkedAt: typeof parsed.checkedAt === 'string' ? parsed.checkedAt : entry.createdAt,
    status: parsed.status === 'READY_FOR_HUMAN_REVIEW' ? 'READY_FOR_HUMAN_REVIEW' : 'NEEDS_MORE_INFO',
    lifecycleStatus:
      parsed.lifecycleStatus === 'CHECKING'
        || parsed.lifecycleStatus === 'ISSUES_FOUND'
        || parsed.lifecycleStatus === 'READY_FOR_HUMAN_REVIEW'
        || parsed.lifecycleStatus === 'NEEDS_MORE_INFO'
        || parsed.lifecycleStatus === 'UNREVIEWED'
        ? parsed.lifecycleStatus
        : (parsed.status === 'READY_FOR_HUMAN_REVIEW' ? 'READY_FOR_HUMAN_REVIEW' : 'ISSUES_FOUND'),
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    issueCount: typeof parsed.issueCount === 'number' ? parsed.issueCount : 0,
    warningCount: typeof parsed.warningCount === 'number' ? parsed.warningCount : 0,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((item): item is string => typeof item === 'string') : [],
    checklist: Array.isArray(parsed.checklist)
      ? parsed.checklist.filter((item): item is ProofCheckChecklistItem =>
        Boolean(
          item
          && typeof item === 'object'
          && typeof item.key === 'string'
          && typeof item.label === 'string'
          && typeof item.status === 'string'
          && typeof item.detail === 'string'
        )
      )
      : [],
  };
}

function buildLatestProofChecksByMilestone(auditLogs: any[]) {
  const checks: Record<string, ProofCheckResult> = {};

  auditLogs.forEach((entry) => {
    const result = getProofCheckResultFromAuditEntry(entry);
    if (result && !checks[result.milestoneId]) {
      checks[result.milestoneId] = result;
    }
  });

  return checks;
}

function buildLatestProofChecksByMilestoneFromAgreement(agreement: any) {
  const checks: Record<string, ProofCheckResult> = {};
  const records = Array.isArray(agreement?.proofChecks) ? agreement.proofChecks as PersistedProofCheckRecord[] : [];

  records.forEach((record) => {
    if (checks[record.milestoneId]) {
      return;
    }

    const status =
      record.status === 'READY_FOR_HUMAN_REVIEW'
        ? 'READY_FOR_HUMAN_REVIEW'
        : 'NEEDS_MORE_INFO';
    const checklist = Array.isArray(record.checklist)
      ? record.checklist
      : safeParseJson<ProofCheckChecklistItem[]>(record.checklistJson) || [];
    const warnings = Array.isArray(record.warnings)
      ? record.warnings
      : safeParseJson<string[]>(record.warningsJson) || [];

    if (record.status === 'CHECKING') {
      checks[record.milestoneId] = {
        agreementId: record.agreementId,
        milestoneId: record.milestoneId,
        proofId: record.proofId,
        checkedAt: record.updatedAt,
        status: 'NEEDS_MORE_INFO',
        lifecycleStatus: 'CHECKING',
        summary: record.summary || 'Proof check is still running.',
        issueCount: 0,
        warningCount: 0,
        warnings: [],
        checklist: [],
      };
      return;
    }

    checks[record.milestoneId] = {
      agreementId: record.agreementId,
      milestoneId: record.milestoneId,
      proofId: record.proofId,
      checkedAt: record.completedAt || record.updatedAt,
      status,
      lifecycleStatus: record.status,
      summary: record.summary,
      issueCount: record.issueCount,
      warningCount: record.warningCount,
      warnings,
      checklist,
    };
  });

  return checks;
}

function getChecklistTone(status: ProofCheckChecklistStatus) {
  switch (status) {
    case 'PRESENT':
      return 'border-emerald-800/40 bg-emerald-950/20 text-emerald-200';
    case 'MISSING':
      return 'border-amber-800/50 bg-amber-950/30 text-amber-100';
    case 'PARTIAL':
      return 'border-yellow-800/40 bg-yellow-950/20 text-yellow-100';
    default:
      return 'border-agent-border bg-agent-bg/60 text-gray-300';
  }
}

function ProofCheckPanel({
  result,
  checking,
  onCheck,
  showCheckAction = true,
}: {
  result: ProofCheckResult | null;
  checking: boolean;
  onCheck: () => void;
  showCheckAction?: boolean;
}) {
  const lifecycleStatus = checking ? 'CHECKING' : (result?.lifecycleStatus || null);
  const title = checking
    ? 'Checking report'
    : result?.status === 'READY_FOR_HUMAN_REVIEW'
      ? 'Ready for human review'
      : lifecycleStatus === 'NEEDS_MORE_INFO'
        ? 'Needs more info'
        : result
          ? 'Issues found'
          : 'Check report';
  const subtitle = checking
    ? 'PactAgent is comparing the submitted proof against the milestone scope and basic evidence signals.'
    : result?.status === 'READY_FOR_HUMAN_REVIEW'
      ? result.summary
      : lifecycleStatus === 'NEEDS_MORE_INFO'
        ? result?.summary || 'A reviewer has requested more information before payout can be approved.'
        : result
          ? 'Needs more info before review is likely to be efficient.'
          : 'Run a pre-review completeness pass before the human decision step.';

  return (
    <div className="rounded-xl border border-agent-border bg-agent-bg/60 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-white">{title}</span>
            {result && !checking ? (
              <span
                className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${result.status === 'READY_FOR_HUMAN_REVIEW'
                  ? 'bg-emerald-950/40 text-emerald-300'
                  : lifecycleStatus === 'NEEDS_MORE_INFO'
                    ? 'bg-orange-950/40 text-orange-300'
                    : 'bg-amber-950/40 text-amber-300'
                  }`}
              >
                {result.status === 'READY_FOR_HUMAN_REVIEW'
                  ? 'Ready'
                  : lifecycleStatus === 'NEEDS_MORE_INFO'
                    ? 'Waiting On Info'
                    : 'Issues Found'}
              </span>
            ) : null}
            {checking ? (
              <span className="rounded-full bg-sky-950/40 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-sky-300">
                Checking
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-gray-400">{subtitle}</p>
          {result?.checkedAt ? (
            <p className="mt-2 text-[11px] uppercase tracking-[0.16em] text-gray-500">
              Last checked {new Date(result.checkedAt).toLocaleString()}
            </p>
          ) : null}
        </div>
        {showCheckAction ? (
          <button
            type="button"
            onClick={onCheck}
            disabled={checking}
            className="inline-flex items-center justify-center rounded-lg border border-agent-accent/40 px-3 py-2 text-xs font-medium text-agent-accent transition-colors hover:bg-agent-accent/10 disabled:opacity-60"
          >
            {checking ? 'Checking...' : result ? 'Re-check Report' : 'Check Report'}
          </button>
        ) : null}
      </div>

      {result?.checklist?.length ? (
        <div className="mt-4 grid gap-2">
          {result.checklist.map((item) => (
            <div key={item.key} className={`rounded-lg border px-3 py-2 ${getChecklistTone(item.status)}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{item.label}</span>
                <span className="text-[10px] uppercase tracking-[0.16em]">{item.status.replace(/_/g, ' ')}</span>
              </div>
              <p className="mt-1 text-xs leading-5">{item.detail}</p>
            </div>
          ))}
        </div>
      ) : null}

      {result?.warnings?.length ? (
        <div className="mt-4 rounded-lg border border-amber-800/40 bg-amber-950/20 p-3">
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-amber-300">Missing-item warnings</div>
          <div className="mt-2 space-y-2">
            {result.warnings.map((warning, index) => (
              <p key={`${warning}-${index}`} className="text-sm text-amber-100">
                {warning}
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type FollowUpDraft = {
  milestoneId: string;
  proofId: string;
  summary: string;
  prompts: string[];
  basedOnStatus: ProofCheckStatus;
};

type InfoRequestRecord = {
  requestId: string;
  milestoneId: string;
  requestedBy: string | null;
  questions: string[];
  note: string | null;
  createdAt: string;
  resolved: boolean;
  resolvedAt: string | null;
  responseBy: string | null;
  responsePreview: string | null;
};

function buildInfoRequestRecords(auditLogs: any[]) {
  const requests = new Map<string, InfoRequestRecord>();

  auditLogs
    .slice()
    .reverse()
    .forEach((entry) => {
      const metadata = safeParseJson<Record<string, unknown>>(entry.metadataJson);
      if (!metadata || typeof metadata.requestId !== 'string' || typeof metadata.milestoneId !== 'string') {
        return;
      }

      if (entry.action === 'INFO_REQUESTED') {
        requests.set(metadata.requestId, {
          requestId: metadata.requestId,
          milestoneId: metadata.milestoneId,
          requestedBy: entry.actorAddress || null,
          questions: Array.isArray(metadata.questions)
            ? metadata.questions.filter((item): item is string => typeof item === 'string')
            : [],
          note: typeof metadata.note === 'string' ? metadata.note : null,
          createdAt: entry.createdAt,
          resolved: false,
          resolvedAt: null,
          responseBy: null,
          responsePreview: null,
        });
        return;
      }

      if (entry.action === 'INFO_RECEIVED') {
        const existing = requests.get(metadata.requestId);
        if (!existing) {
          return;
        }

        existing.resolved = true;
        existing.resolvedAt = entry.createdAt;
        existing.responseBy = entry.actorAddress || null;
        existing.responsePreview =
          typeof metadata.responsePreview === 'string'
            ? metadata.responsePreview
            : null;
      }
    });

  return Array.from(requests.values()).sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
}

function buildInfoRequestRecordsFromAgreement(agreement: any) {
  const requests = Array.isArray(agreement?.infoRequests) ? agreement.infoRequests : [];
  return requests.map((record: any) => ({
    requestId: record.id,
    milestoneId: record.milestoneId,
    proofId: record.proofId || null,
    requestedBy: record.requestedBy || null,
    questions: safeParseJson<string[]>(record.questionsJson) || [],
    note: record.note || null,
    createdAt: record.createdAt,
    resolved: record.status !== 'OPEN',
    resolvedAt: record.respondedAt || null,
    responseBy: record.respondedBy || null,
    responsePreview: record.responseContent ? String(record.responseContent).slice(0, 240) : null,
    requestType: record.requestType || 'STRUCTURED_REVIEW_REQUEST',
    status: record.status || 'OPEN',
    commentId: record.commentId || null,
    responseCommentId: record.responseCommentId || null,
  })) as InfoRequestRecord[];
}

type SourceSyncActivity = {
  action: string;
  createdAt: string;
  actorAddress: string | null;
  preview: string | null;
};

function buildLatestSourceSyncActivity(auditLogs: any[]) {
  for (const entry of auditLogs) {
    if (![
      'SOURCE_SYNC_COMPLETED',
      'SOURCE_SYNC_FAILED',
      'SOURCE_SYNC_DRAFTED',
      'SOURCE_SYNC_REVIEWED',
      'SOURCE_SYNC_PUBLISHED',
    ].includes(entry?.action)) {
      continue;
    }

    const metadata = safeParseJson<Record<string, unknown>>(entry.metadataJson);
    const preview =
      typeof metadata?.latestSummary === 'string'
        ? metadata.latestSummary
        : typeof metadata?.publishedPreview === 'string'
          ? metadata.publishedPreview
          : typeof metadata?.draftPreview === 'string'
            ? metadata.draftPreview
            : null;

    return {
      action: entry.action,
      createdAt: entry.createdAt,
      actorAddress: entry.actorAddress || null,
      preview,
    } satisfies SourceSyncActivity;
  }

  return null;
}

function getInfoRequestTone(request: InfoRequestRecord) {
  return request.resolved
    ? 'border-emerald-800/40 bg-emerald-950/20 text-emerald-100'
    : 'border-amber-800/40 bg-amber-950/20 text-amber-100';
}

type PendingDisputeReply = {
  id: string;
  submittedBy: string;
  content: string;
  createdAt: string;
  optimistic: true;
};

type PendingAgreementComment = {
  id: string;
  authorAddress: string;
  content: string;
  createdAt: string;
  optimistic: true;
};

function CollapsibleSection({
  title,
  description,
  countLabel,
  storageKey,
  defaultExpanded = false,
  children,
}: {
  title: string;
  description: string;
  countLabel?: string;
  storageKey: string;
  defaultExpanded?: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const saved = window.localStorage.getItem(storageKey);
    if (saved === 'expanded') {
      setExpanded(true);
    } else if (saved === 'collapsed') {
      setExpanded(false);
    } else {
      setExpanded(defaultExpanded);
    }
  }, [defaultExpanded, storageKey]);

  function toggle() {
    setExpanded((current) => {
      const next = !current;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, next ? 'expanded' : 'collapsed');
      }
      return next;
    });
  }

  return (
    <div className="bg-agent-card border border-agent-border rounded-xl p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-white font-semibold">{title}</h2>
          <p className="text-xs text-gray-400 mt-1">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          {countLabel ? <div className="text-right text-xs leading-relaxed text-gray-500">{countLabel}</div> : null}
          <button
            type="button"
            onClick={toggle}
            className="shrink-0 whitespace-nowrap rounded-lg border border-agent-border px-4 py-2 text-sm font-medium tracking-[0.01em] text-gray-200 transition-colors hover:bg-agent-bg"
          >
            {expanded ? 'Show Less' : 'Show More'}
          </button>
        </div>
      </div>
      {expanded ? children : null}
    </div>
  );
}

async function addressesMatchOnSignerNetwork(
  signer: ccc.Signer,
  leftAddress: string,
  rightAddress: string
) {
  if (leftAddress === rightAddress) {
    return true;
  }

  const [left, right] = await Promise.all([
    ccc.Address.fromString(leftAddress, signer.client),
    ccc.Address.fromString(rightAddress, signer.client),
  ]);

  return JSON.stringify(left.script) === JSON.stringify(right.script);
}

export default function AgreementDetailPage() {
  useWebSocket();
  const params = useParams();
  const id = params.id as string;
  const { open, disconnect } = ccc.useCcc();
  const signer = ccc.useSigner();
  const hasHydrated = useStore((s) => s.hasHydrated);
  const walletAddress = useStore((s) => s.walletAddress);
  const authToken = useStore((s) => s.authToken);
  const isAdmin = useStore((s) => s.isAdmin);
  const updateCount = useStore((s) => s.agreementUpdateCount);
  const wsConnected = useStore((s) => s.wsConnected);

  const [agreement, setAgreement] = useState<any>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [proofChecksByMilestone, setProofChecksByMilestone] = useState<Record<string, ProofCheckResult>>({});
  const [infoRequests, setInfoRequests] = useState<InfoRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [proofCheckLoadingMilestoneId, setProofCheckLoadingMilestoneId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publicConfig, setPublicConfig] = useState<any>(null);
  const [liveCkbQuote, setLiveCkbQuote] = useState<null | {
    priceUsd: number;
    inversePriceCkbPerUsd: number;
    lastUpdatedAt: string | null;
    fetchedAt: string;
  }>(null);
  const [fundingStatus, setFundingStatus] = useState<string | null>(null);
  const [proofSummary, setProofSummary] = useState('');
  const [proofContent, setProofContent] = useState('');
  const [proofUrlDraft, setProofUrlDraft] = useState('');
  const [proofTxHashDraft, setProofTxHashDraft] = useState('');
  const [proofArtifacts, setProofArtifacts] = useState<DraftArtifact[]>([]);
  const [followUpDraft, setFollowUpDraft] = useState<FollowUpDraft | null>(null);
  const [followUpDraftText, setFollowUpDraftText] = useState('');
  const [followUpNote, setFollowUpNote] = useState('');
  const [infoResponseContent, setInfoResponseContent] = useState('');
  const [reviewerDecisionNote, setReviewerDecisionNote] = useState('');
  const [humanApprovalConfirmed, setHumanApprovalConfirmed] = useState(false);
  const [acknowledgeAiSuggestion, setAcknowledgeAiSuggestion] = useState(false);
  const [acknowledgeProofCheck, setAcknowledgeProofCheck] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [evidenceNotes, setEvidenceNotes] = useState('');
  const [disputeResolution, setDisputeResolution] = useState<'PAYOUT' | 'REFUND' | 'SPLIT'>('REFUND');
  const [splitWorkerAmountCkb, setSplitWorkerAmountCkb] = useState('');
  const [disputeUrlDraft, setDisputeUrlDraft] = useState('');
  const [disputeArtifacts, setDisputeArtifacts] = useState<DraftArtifact[]>([]);
  const [additionalEvidence, setAdditionalEvidence] = useState('');
  const [replyUrlDraft, setReplyUrlDraft] = useState('');
  const [replyArtifacts, setReplyArtifacts] = useState<DraftArtifact[]>([]);
  const [pendingDisputeReplies, setPendingDisputeReplies] = useState<PendingDisputeReply[]>([]);
  const [pendingAgreementComments, setPendingAgreementComments] = useState<PendingAgreementComment[]>([]);
  const [commentContent, setCommentContent] = useState('');
  const [sourceThreadUrl, setSourceThreadUrl] = useState('');
  const [sourceSummaryOverride, setSourceSummaryOverride] = useState('');
  const [sourceDraftUpdate, setSourceDraftUpdate] = useState('');
  const [sourceReviewerApproved, setSourceReviewerApproved] = useState(false);
  const [sourceActionLoading, setSourceActionLoading] = useState<string | null>(null);
  const [draftForm, setDraftForm] = useState<null | {
    title: string;
    description: string;
    workerAddress: string;
    workerFiberPubkey: string;
    deadlineAt: string;
    disputeWindowHours: string;
    proofType: string;
    reviewerMode: string;
    releaseMode: string;
    payoutNetwork: string;
  }>(null);
  const [draftMilestones, setDraftMilestones] = useState<Array<{
    id?: string;
    title: string;
    description: string;
    amount: string;
  }>>([]);
  const [amendmentReason, setAmendmentReason] = useState('');
  const [amendmentTitle, setAmendmentTitle] = useState('');
  const [amendmentDescription, setAmendmentDescription] = useState('');
  const [amendmentDeadlineAt, setAmendmentDeadlineAt] = useState('');
  const [amendmentResponseNote, setAmendmentResponseNote] = useState('');
  const [inviteFeedback, setInviteFeedback] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [topUpTxHash, setTopUpTxHash] = useState('');
  const [topUpAmountCkb, setTopUpAmountCkb] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      if (!hasHydrated) {
        return;
      }

      if (!authToken) {
        if (!cancelled) {
          setPublicConfig(null);
        }
        return;
      }

      try {
        const configData = await api.fetchConfig();
        if (!cancelled) {
          setPublicConfig(configData);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load public config:', err);
        }
      }
    }

    void loadConfig();

    return () => {
      cancelled = true;
    };
  }, [authToken, hasHydrated]);

  useEffect(() => {
    let cancelled = false;

    async function loadQuote() {
      if (!agreement?.source || agreement?.pricingMode !== 'USD_EQUIVALENT' || !authToken) {
        if (!cancelled) {
          setLiveCkbQuote(null);
        }
        return;
      }

      if (['PAID', 'REFUNDED', 'EXPIRED', 'CANCELLED'].includes(agreement.status)) {
        if (!cancelled) {
          setLiveCkbQuote(null);
        }
        return;
      }

      try {
        const quote = await api.fetchCkbPriceQuote({ fresh: true });
        if (!cancelled) {
          setLiveCkbQuote(quote);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load live CKB quote for imported grant:', err);
          setLiveCkbQuote(null);
        }
      }
    }

    void loadQuote();

    // Refresh live quote every 60 seconds for funded agreements
    const intervalId = (agreement?.source && agreement?.pricingMode === 'USD_EQUIVALENT' && !['PAID', 'REFUNDED', 'EXPIRED', 'CANCELLED'].includes(agreement?.status || ''))
      ? setInterval(() => { void loadQuote(); }, 60_000)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [agreement?.id, agreement?.pricingMode, agreement?.source, agreement?.status, authToken]);

  useEffect(() => {
    const flash = window.sessionStorage.getItem('pactagent-ui-flash');
    if (!flash) {
      return;
    }

    setSuccessMessage(flash);
    window.sessionStorage.removeItem('pactagent-ui-flash');
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAgreement() {
      if (!hasHydrated) {
        return;
      }

      if (!authToken) {
        if (!cancelled) {
          setAgreement(null);
          setError(null);
          setLoading(false);
        }
        return;
      }

      if (!agreement) {
        setLoading(true);
      }

      try {
        const agreementData = await api.fetchAgreement(id);
        if (!cancelled) {
          setAgreement(agreementData);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load agreement:', err);
          setAgreement(null);
          setError(err instanceof Error ? err.message : 'Failed to load agreement');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadAgreement();

    return () => {
      cancelled = true;
    };
  }, [authToken, hasHydrated, id, updateCount]);

  useEffect(() => {
    if (!agreement || agreement.status !== 'DRAFT') {
      setDraftForm(null);
      setDraftMilestones([]);
      return;
    }

    setDraftForm({
      title: agreement.title || '',
      description: agreement.description || '',
      workerAddress: agreement.workerAddress || '',
      workerFiberPubkey: agreement.workerFiberPubkey || '',
      deadlineAt: agreement.deadlineAt ? new Date(agreement.deadlineAt).toISOString().slice(0, 16) : '',
      disputeWindowHours: agreement.disputeWindowSecs ? String(Math.max(1, Math.round(agreement.disputeWindowSecs / 3600))) : '24',
      proofType: agreement.proofType || 'URL',
      reviewerMode: agreement.reviewerMode || 'AUTO',
      releaseMode: agreement.releaseMode || 'PARTIAL',
      payoutNetwork: agreement.payoutNetwork || 'CKB',
    });
    setDraftMilestones((agreement.milestones || []).map((milestone: any) => ({
      id: milestone.id,
      title: milestone.title,
      description: milestone.description,
      amount: milestone.amount,
    })));
  }, [agreement]);

  useEffect(() => {
    setSourceThreadUrl(agreement?.source?.forumThreadUrl || '');
    setSourceSummaryOverride('');
    setSourceDraftUpdate(agreement?.source?.draftUpdate || '');
    setSourceReviewerApproved(false);
  }, [agreement?.source?.forumThreadUrl, agreement?.source?.draftUpdate]);

  useEffect(() => {
    let cancelled = false;

    async function loadAuditLogs() {
      if (!hasHydrated || !authToken) {
        if (!cancelled) {
          setAuditLogs([]);
        }
        return;
      }

      try {
        const logs = await api.fetchAgreementAuditLogs(id, 100);
        if (!cancelled) {
          setAuditLogs(logs);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load audit logs:', err);
          setAuditLogs([]);
        }
      }
    }

    void loadAuditLogs();

    return () => {
      cancelled = true;
    };
  }, [authToken, hasHydrated, id, updateCount]);

  useEffect(() => {
    if (agreement?.proofChecks?.length) {
      setProofChecksByMilestone(buildLatestProofChecksByMilestoneFromAgreement(agreement));
    } else {
      setProofChecksByMilestone(buildLatestProofChecksByMilestone(auditLogs));
    }

    if (agreement?.infoRequests?.length) {
      setInfoRequests(buildInfoRequestRecordsFromAgreement(agreement));
    } else {
      setInfoRequests(buildInfoRequestRecords(auditLogs));
    }
  }, [agreement, auditLogs]);

  useEffect(() => {
    setFollowUpDraft(null);
    setFollowUpDraftText('');
    setFollowUpNote('');
    setInfoResponseContent('');
    setReviewerDecisionNote('');
    setHumanApprovalConfirmed(false);
    setAcknowledgeAiSuggestion(false);
    setAcknowledgeProofCheck(false);
  }, [agreement?.updatedAt]);

  async function refreshAuditLogs() {
    if (!hasHydrated || !authToken) {
      setAuditLogs([]);
      return [];
    }

    const logs = await api.fetchAgreementAuditLogs(id, 100);
    setAuditLogs(logs);
    return logs;
  }

  async function refreshAgreement(actionKey?: string) {
    if (actionKey) {
      setActionLoading(actionKey);
    }

    try {
      const data = await api.fetchAgreement(id);
      setAgreement(data);
      return data;
    } finally {
      if (actionKey) {
        setActionLoading(null);
      }
    }
  }

  function applyAgreementPayload(payload: any) {
    const nextAgreement = payload?.agreement ?? payload;
    if (nextAgreement?.id) {
      setAgreement(nextAgreement);
    }
  }

  async function handleCheckProof(milestoneId: string, options?: { silent?: boolean }) {
    setProofCheckLoadingMilestoneId(milestoneId);
    if (!options?.silent) {
      setError(null);
    }

    try {
      const result = await api.checkSubmittedProof(id, {
        milestoneId,
        async: true,
      });
      if (result?.queued) {
        await refreshAgreement().catch(() => { });
        await refreshAuditLogs().catch(() => { });
        return null;
      }
      setProofChecksByMilestone((prev) => ({
        ...prev,
        [milestoneId]: result,
      }));
      await refreshAuditLogs().catch(() => { });
      return result;
    } catch (err) {
      if (!options?.silent) {
        setError(err instanceof Error ? err.message : 'Proof check failed');
      }
      return null;
    } finally {
      setProofCheckLoadingMilestoneId((current) => (current === milestoneId ? null : current));
    }
  }

  async function handleDraftInfoRequest(milestoneId: string) {
    setActionLoading('draft-info-request');
    setError(null);

    try {
      const draft = await api.draftInfoRequest(id, { milestoneId });
      setFollowUpDraft(draft);
      setFollowUpDraftText((draft.prompts || []).join('\n'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to draft follow-up questions');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSendInfoRequest(milestoneId: string) {
    if (!walletAddress) {
      return;
    }

    const questions = followUpDraftText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (!questions.length) {
      setError('Add at least one follow-up question before sending the request.');
      return;
    }

    setActionLoading('send-info-request');
    setError(null);

    try {
      const response = await api.sendInfoRequest(id, {
        milestoneId,
        requesterAddress: walletAddress,
        questions,
        note: followUpNote.trim() || undefined,
      });
      setFollowUpNote('');
      setFollowUpDraftText('');
      setFollowUpDraft(null);
      applyAgreementPayload(response);
      await refreshAuditLogs().catch(() => { });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send info request');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSendInfoResponse(milestoneId: string, requestId: string) {
    if (!walletAddress || !infoResponseContent.trim()) {
      return;
    }

    setActionLoading('send-info-response');
    setError(null);

    try {
      const response = await api.sendInfoResponse(id, {
        milestoneId,
        requestId,
        responderAddress: walletAddress,
        content: infoResponseContent.trim(),
      });
      setInfoResponseContent('');
      applyAgreementPayload(response);
      await refreshAuditLogs().catch(() => { });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send info response');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSyncSource() {
    if (!agreement?.source) {
      return;
    }

    setSourceActionLoading('sync');
    setError(null);

    try {
      const response = await api.syncAgreementSource(id, {
        forumThreadUrl: sourceThreadUrl.trim() || undefined,
        manualSummary: sourceSummaryOverride.trim() || undefined,
      });
      applyAgreementPayload(response);
      await refreshAgreement().catch(() => { });
      await refreshAuditLogs().catch(() => { });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync source thread');
    } finally {
      setSourceActionLoading(null);
    }
  }

  async function handleDraftSourceUpdate() {
    if (!agreement?.source || !sourceDraftUpdate.trim()) {
      return;
    }

    setSourceActionLoading('draft-source');
    setError(null);

    try {
      const response = await api.updateAgreementSourcePublishState(id, {
        action: 'DRAFT',
        content: sourceDraftUpdate.trim(),
      });
      applyAgreementPayload(response);
      await refreshAgreement().catch(() => { });
      await refreshAuditLogs().catch(() => { });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to draft source update');
    } finally {
      setSourceActionLoading(null);
    }
  }

  async function handleReviewSourceUpdate() {
    if (!agreement?.source) {
      return;
    }

    setSourceActionLoading('review-source');
    setError(null);

    try {
      const response = await api.updateAgreementSourcePublishState(id, {
        action: 'REVIEW',
      });
      applyAgreementPayload(response);
      await refreshAgreement().catch(() => { });
      await refreshAuditLogs().catch(() => { });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark source update as reviewed');
    } finally {
      setSourceActionLoading(null);
    }
  }

  async function handlePublishSourceUpdate() {
    if (!agreement?.source || !sourceDraftUpdate.trim()) {
      return;
    }

    if (!sourceReviewerApproved) {
      setError('Explicit reviewer approval is required before publishing a source update.');
      return;
    }

    setSourceActionLoading('publish-source');
    setError(null);

    try {
      const response = await api.updateAgreementSourcePublishState(id, {
        action: 'PUBLISH',
        content: sourceDraftUpdate.trim(),
        reviewerApproved: true,
      });
      applyAgreementPayload(response);
      await refreshAgreement().catch(() => { });
      await refreshAuditLogs().catch(() => { });
      setSourceReviewerApproved(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish source update');
    } finally {
      setSourceActionLoading(null);
    }
  }

  function appendUrlArtifact(
    value: string,
    setter: (next: DraftArtifact[] | ((prev: DraftArtifact[]) => DraftArtifact[])) => void,
    clear: () => void,
    labelPrefix: string,
  ) {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    setter((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${prev.length}`,
        kind: 'URL',
        label: `${labelPrefix} Link ${prev.length + 1}`,
        content: trimmed,
      },
    ]);
    clear();
  }

  function appendTxHashArtifact(
    value: string,
    setter: (next: DraftArtifact[] | ((prev: DraftArtifact[]) => DraftArtifact[])) => void,
    clear: () => void,
  ) {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    if (!TX_HASH_PATTERN.test(trimmed)) {
      setError('Transaction hash must use the full 0x-prefixed 64-byte format.');
      return;
    }

    setter((prev) => {
      const alreadyAdded = prev.some((artifact) =>
        artifact.kind === 'TEXT'
        && artifact.label.startsWith('Transaction Hash')
        && artifact.content.trim().toLowerCase() === trimmed.toLowerCase()
      );

      if (alreadyAdded) {
        return prev;
      }

      const nextTxHashCount = prev.filter((artifact) => artifact.label.startsWith('Transaction Hash')).length + 1;
      return [
        ...prev,
        {
          id: `${Date.now()}-${prev.length}`,
          kind: 'TEXT',
          label: `Transaction Hash ${nextTxHashCount}`,
          content: trimmed,
        },
      ];
    });

    setError(null);
    clear();
  }

  async function appendFileArtifacts(
    files: FileList | null,
    setter: (next: DraftArtifact[] | ((prev: DraftArtifact[]) => DraftArtifact[])) => void,
  ) {
    if (!files?.length) {
      return;
    }

    try {
      const artifacts = await readFilesAsArtifacts(files);
      setter((prev) => [...prev, ...artifacts]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read selected files');
    }
  }

  function removeArtifact(
    id: string,
    setter: (next: DraftArtifact[] | ((prev: DraftArtifact[]) => DraftArtifact[])) => void,
  ) {
    setter((prev) => prev.filter((artifact) => artifact.id !== id));
  }

  async function handleFund() {
    if (!signer) {
      setError('Reconnect a CKB wallet before funding this agreement');
      return;
    }

    if (!canSignerFundAgreement(signer)) {
      setError(
        'This wallet can authenticate, but it cannot fund CKB agreements. Use JoyID or an EVM wallet that supports CKB OmniLock funding.',
      );
      return;
    }

    const fundingAddress = agreement?.escrowAddress || publicConfig?.treasuryAddress;

    if (!fundingAddress) {
      setError('Escrow funding address is not configured on the server');
      return;
    }

    setActionLoading('fund');
    setError(null);
    setFundingStatus(null);

    try {
      if (!walletAddress) {
        throw new Error('Wallet session not found. Please reconnect your wallet.');
      }

      const minimumMilestoneCapacity = getMinimumMilestoneCapacity({
        escrowModel: agreement.escrowModel,
        payoutNetwork: agreement.payoutNetwork,
        escrowLockCodeHash: agreement.escrowLockCodeHash,
        escrowLockHashType: agreement.escrowLockHashType,
        escrowLockArgs: agreement.escrowLockArgs,
      });

      // Validate minimum CKB amount before doing anything else
      if (BigInt(agreement.amount) < MIN_CELL_CAPACITY) {
        throw new Error(
          `Agreement amount is too low. CKB requires at least 61 CKB per transaction output. Current amount: ${shannonsToCKB(agreement.amount)} CKB.`,
        );
      }

      if (agreement.escrowModel === 'ONCHAIN_LOCK') {
        const underfundedMilestone = agreement.milestones.find(
          (milestone: { amount: string; sortOrder: number }) => BigInt(milestone.amount) < minimumMilestoneCapacity,
        );

        if (underfundedMilestone) {
          throw new Error(
            `Milestone ${underfundedMilestone.sortOrder} is too small for on-chain lock funding. Each milestone currently needs at least ${formatCkbAmount(minimumMilestoneCapacity)} CKB, but this one is ${shannonsToCKB(underfundedMilestone.amount)} CKB.`,
          );
        }
      }

      setFundingStatus('Verifying wallet address...');
      if (walletAddress !== agreement.clientAddress) {
        try {
          const match = await withTimeout(
            addressesMatchOnSignerNetwork(signer, walletAddress, agreement.clientAddress),
            10_000,
            'skip',
          );
          if (!match) {
            throw new Error('The connected wallet does not match the client wallet for this agreement.');
          }
        } catch (err) {
          if (err instanceof Error && err.message !== 'skip') throw err;
        }
      }

      let txHash: string;
      let milestoneOutputs:
        | Array<{
          milestoneId: string;
          outputIndex: number;
          escrowCellData: string;
          refundTimeoutBlock: string;
        }>
        | undefined;
      let commencementOutputIndex: number | undefined;

      if (agreement.escrowModel === 'ONCHAIN_LOCK') {
        const funding = await sendOnchainEscrowFunding({
          signer,
          agreement,
          onProgress: (step) => setFundingStatus(step),
        });
        txHash = funding.txHash;
        milestoneOutputs = funding.milestoneOutputs;
        commencementOutputIndex = funding.commencementOutputIndex ?? undefined;
      } else {
        txHash = await sendCapacityTransfer({
          signer,
          fromAddress: walletAddress,
          toAddress: fundingAddress,
          amount: isUsdEquivalentGrant && agreement.status === 'DRAFT' ? currentDraftReserveShannons : agreement.amount,
          onProgress: (step) => setFundingStatus(step),
        });
      }

      setFundingStatus('Confirming with server...');
      await withTimeout(
        api.fundAgreement(
          id,
          String(txHash),
          isUsdEquivalentGrant && agreement.status === 'DRAFT' ? currentDraftReserveShannons : undefined,
          milestoneOutputs,
          commencementOutputIndex,
        ),
        30_000,
        'Timed out confirming the funding with the server. The transaction may have been sent — please refresh the page.',
      );

      setFundingStatus(null);
      await refreshAgreement().catch(() => { });
    } catch (err) {
      console.error('[Fund] Error:', err);
      setError(err instanceof Error ? err.message : 'Funding failed — please try again.');
    } finally {
      setActionLoading(null);
      setFundingStatus(null);
    }
  }

  async function handleReconnectSigner() {
    setError(null);

    try {
      // Disconnect first to clear any stale/corrupt connection state,
      // then open the wallet picker for a clean reconnect.
      await disconnect();
      await open();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reconnect wallet. Try refreshing the page.');
    }
  }

  async function handleTopUpReserve() {
    if (!topUpTxHash.trim() || !topUpAmountCkb.trim()) {
      setError('Enter the reserve top-up transaction hash and the exact CKB amount sent.');
      return;
    }

    setActionLoading('top-up-reserve');
    setError(null);

    try {
      const updated = await api.topUpImportedGrantReserve(
        id,
        topUpTxHash.trim(),
        ckbToShannons(topUpAmountCkb.trim()).toString(),
      );
      setAgreement(updated);
      setTopUpTxHash('');
      setTopUpAmountCkb('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm reserve top-up');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSubmitProof(milestoneId: string) {
    if (!proofContent.trim() && !proofSummary.trim() && proofArtifacts.length === 0) {
      return;
    }

    setActionLoading('proof');
    setError(null);

    try {
      const response = await api.submitProof(id, {
        milestoneId,
        proofType: agreement.proofType,
        content: proofContent,
        summary: proofSummary,
        artifacts: proofArtifacts,
      });
      setProofSummary('');
      setProofContent('');
      setProofUrlDraft('');
      setProofTxHashDraft('');
      setProofArtifacts([]);
      applyAgreementPayload(response);
      void handleCheckProof(milestoneId, { silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Proof submission failed');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleOpenDispute(milestoneId: string) {
    if (!disputeReason.trim() || !walletAddress) {
      return;
    }

    if (disputeResolution === 'SPLIT' && splitWorkerAmountError) {
      setError(splitWorkerAmountError);
      return;
    }

    setActionLoading('dispute');
    setError(null);

    try {
      const response = await api.openDispute(id, {
        milestoneId,
        openedBy: walletAddress,
        reason: disputeReason,
        evidenceNotes: evidenceNotes || undefined,
        desiredResolution: disputeResolution,
        splitWorkerAmount: disputeResolution === 'SPLIT' && splitWorkerAmountCkb.trim()
          ? ckbToShannons(splitWorkerAmountCkb).toString()
          : undefined,
        artifacts: disputeArtifacts,
      });
      setDisputeReason('');
      setEvidenceNotes('');
      setDisputeResolution('REFUND');
      setSplitWorkerAmountCkb('');
      setDisputeUrlDraft('');
      setDisputeArtifacts([]);
      applyAgreementPayload(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open dispute');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleGetRecommendation() {
    setActionLoading('recommend');
    setError(null);

    try {
      await api.getDisputeRecommendation(id);
      await refreshAgreement();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get recommendation');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSubmitDisputeEvidence() {
    if (!walletAddress || !agreement) {
      return;
    }

    const openDispute = agreement.disputes?.find((item: any) => !item.resolvedAt);
    if (!openDispute || (!additionalEvidence.trim() && replyArtifacts.length === 0)) {
      return;
    }

    setError(null);
    const content = additionalEvidence.trim();
    const optimisticReply: PendingDisputeReply = {
      id: `pending-${Date.now()}`,
      submittedBy: walletAddress,
      content: content || 'Attachment bundle added',
      createdAt: new Date().toISOString(),
      optimistic: true,
    };
    setPendingDisputeReplies((prev) => [...prev, optimisticReply]);
    setAdditionalEvidence('');

    try {
      const response = await api.addDisputeEvidence(id, {
        disputeId: openDispute.id,
        submittedBy: walletAddress,
        content,
        artifacts: replyArtifacts,
      });
      setPendingDisputeReplies((prev) => prev.filter((entry) => entry.id !== optimisticReply.id));
      setReplyUrlDraft('');
      setReplyArtifacts([]);
      applyAgreementPayload(response);
    } catch (err) {
      setPendingDisputeReplies((prev) => prev.filter((entry) => entry.id !== optimisticReply.id));
      setAdditionalEvidence((currentValue) => currentValue || content);
      setError(err instanceof Error ? err.message : 'Failed to add dispute evidence');
    }
  }

  async function handleReviewAction(action: string) {
    if (!walletAddress) {
      return;
    }

    if (action === 'APPROVE') {
      if (!humanApprovalConfirmed) {
        setError('Confirm the final human decision before approving payout.');
        return;
      }

      if (!reviewerDecisionNote.trim()) {
        setError('Add a short reviewer note before approving payout.');
        return;
      }
    }

    setActionLoading(action);
    setError(null);

    try {
      if (agreement.escrowModel === 'ONCHAIN_LOCK' && currentMilestone) {
        if (!signer) {
          throw new Error('Reconnect your wallet before signing an on-chain escrow settlement.');
        }

        const latestConfig = await api.fetchConfigFresh();
        setPublicConfig(latestConfig);

        if (action === 'APPROVE') {
          const txHash = await sendOnchainEscrowResolution({
            signer,
            agreement,
            milestone: currentMilestone,
            config: latestConfig || publicConfig || {},
            direction: 'PAYOUT',
          });
          await api.submitOnchainResolution(id, {
            milestoneId: currentMilestone.id,
            txHash,
            direction: 'PAYOUT',
          });
        } else if (action === 'REJECT') {
          const useTimeoutRefund = !isWorker;
          if (useTimeoutRefund) {
            if (!currentMilestone.refundTimeoutBlock) {
              throw new Error('This milestone does not have timeout metadata recorded yet.');
            }

            const currentTip = await signer.client.getTip();
            if (currentTip < BigInt(currentMilestone.refundTimeoutBlock)) {
              throw new Error('This on-chain refund path stays locked until the timeout block is reached.');
            }
          }

          const txHash = await sendOnchainEscrowResolution({
            signer,
            agreement,
            milestone: currentMilestone,
            config: latestConfig || publicConfig || {},
            direction: 'REFUND',
            useTimeout: useTimeoutRefund,
          });
          await api.submitOnchainResolution(id, {
            milestoneId: currentMilestone.id,
            txHash,
            direction: 'REFUND',
          });
        } else {
          throw new Error('Unsupported on-chain review action.');
        }
      } else {
        const response = await api.reviewAction(id, {
          action,
          reviewerAddress: walletAddress,
          confirmation: action === 'APPROVE'
            ? {
              confirmed: true,
              summary: reviewerDecisionNote.trim(),
              aiSuggestionAcknowledged: acknowledgeAiSuggestion,
              proofCheckAcknowledged: acknowledgeProofCheck,
            }
            : undefined,
        });
        applyAgreementPayload(response);
        await refreshAuditLogs().catch(() => { });
        return;
      }
      await refreshAgreement();
    } catch (err) {
      if (agreement.escrowModel === 'ONCHAIN_LOCK' && currentMilestone && isLikelySpentOutPointError(err)) {
        try {
          const updated = await api.reconcileAgreement(id);
          setAgreement(updated);

          const refreshedMilestone = updated?.milestones?.find((item: any) => item.id === currentMilestone.id);
          if (refreshedMilestone?.status === 'PAID') {
            setError('This milestone was already paid on-chain earlier. The agreement state has been refreshed.');
            return;
          }

          if (refreshedMilestone?.status === 'REFUNDED') {
            setError('This milestone was already refunded on-chain earlier. The agreement state has been refreshed.');
            return;
          }
        } catch {
          // Fall through to the original wallet error if reconciliation fails.
        }
      }

      setError(err instanceof Error ? err.message : 'Review action failed');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleApproveMutualRefund() {
    if (!walletAddress) {
      return;
    }

    setActionLoading('mutual-refund');
    setError(null);

    try {
      const response = await api.approveMutualRefund(id, walletAddress);
      applyAgreementPayload(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record refund approval');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSplitSettlement() {
    if (!walletAddress) {
      return;
    }

    const workerAmount = currentOpenDispute?.splitConsensus?.workerAmount
      || (splitWorkerAmountCkb.trim() ? ckbToShannons(splitWorkerAmountCkb).toString() : '');
    if (splitWorkerAmountError) {
      setError(splitWorkerAmountError);
      return;
    }

    setActionLoading('split');
    setError(null);

    try {
      const response = await api.proposeOrAcceptSplitSettlement(id, {
        actorAddress: walletAddress,
        workerAmount,
      });
      if (isClient) {
        setSplitWorkerAmountCkb('');
      }
      applyAgreementPayload(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record split settlement');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReconcile() {
    setActionLoading('reconcile');
    setError(null);

    try {
      const updated = await api.reconcileAgreement(id);
      setAgreement(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to recheck settlement state');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRetrySettlement() {
    setActionLoading('retry-settlement');
    setError(null);

    try {
      const updated = await api.retryAgreementSettlement(id);
      setAgreement(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry settlement');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSaveDraft() {
    if (!walletAddress || !draftForm) {
      return;
    }

    const firstDraftFieldError = Object.values(draftFieldErrors || {}).find(Boolean);
    if (firstDraftFieldError) {
      setError(firstDraftFieldError);
      return;
    }

    const firstDraftMilestoneError = draftMilestoneErrors.flatMap((milestone) => Object.values(milestone)).find(Boolean);
    if (firstDraftMilestoneError) {
      setError(firstDraftMilestoneError);
      return;
    }

    setActionLoading('save-draft');
    setError(null);

    try {
      const updated = await api.updateDraftAgreement(id, {
        title: draftForm.title,
        description: draftForm.description,
        workerAddress: draftForm.workerAddress,
        workerFiberPubkey: draftForm.workerFiberPubkey.trim() || undefined,
        deadlineAt: new Date(draftForm.deadlineAt).toISOString(),
        disputeWindowSecs: parseInt(draftForm.disputeWindowHours || '24', 10) * 3600,
        proofType: draftForm.proofType,
        reviewerMode: draftForm.reviewerMode,
        releaseMode: draftForm.releaseMode,
        payoutNetwork: draftForm.payoutNetwork,
        milestones: draftMilestones.map((milestone) => ({
          id: milestone.id,
          title: milestone.title,
          description: milestone.description,
          amount: milestone.amount,
        })),
      });
      setAgreement(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save draft');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCancelDraft() {
    setActionLoading('cancel-draft');
    setError(null);

    try {
      const updated = await api.cancelDraftAgreement(id);
      setAgreement(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel draft');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCreateInviteFromDraft() {
    if (!walletAddress || !agreement) {
      return;
    }

    setActionLoading('draft-invite');
    setError(null);
    setInviteFeedback(null);

    try {
      const invite = await api.createInvite({
        createdByAddress: walletAddress,
        creatorRole: 'CLIENT',
        targetRole: 'WORKER',
        title: `${agreement.title} worker invite`,
        description: agreement.description,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        agreementTemplate: {
          title: draftForm?.title || agreement.title,
          description: draftForm?.description || agreement.description,
          deadlineAt: new Date(draftForm?.deadlineAt || agreement.deadlineAt).toISOString(),
          disputeWindowSecs: parseInt(
            draftForm?.disputeWindowHours || String((agreement.disputeWindowSecs || 86400) / 3600),
            10,
          ) * 3600,
          proofType: draftForm?.proofType || agreement.proofType,
          reviewerMode: draftForm?.reviewerMode || agreement.reviewerMode,
          releaseMode: draftForm?.releaseMode || agreement.releaseMode,
          payoutNetwork: draftForm?.payoutNetwork || agreement.payoutNetwork,
          escrowModel: agreement.escrowModel,
          workerFiberPubkey: draftForm?.workerFiberPubkey?.trim() || agreement.workerFiberPubkey || undefined,
          milestones: (draftMilestones.length ? draftMilestones : agreement.milestones || []).map((milestone: any) => ({
            title: milestone.title,
            description: milestone.description,
            amount: milestone.amount,
          })),
        },
      });

      const inviteUrl = `${window.location.origin}/invites/${invite.token}`;
      await navigator.clipboard.writeText(inviteUrl);
      setInviteFeedback('Invite link copied to clipboard.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invite');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleAddComment() {
    if (!walletAddress || !commentContent.trim()) {
      return;
    }

    const optimisticContent = commentContent.trim();
    const optimisticComment: PendingAgreementComment = {
      id: `pending-comment-${Date.now()}`,
      authorAddress: walletAddress,
      content: optimisticContent,
      createdAt: new Date().toISOString(),
      optimistic: true,
    };

    setActionLoading('comment');
    setError(null);
    setPendingAgreementComments((prev) => [...prev, optimisticComment]);
    setCommentContent('');

    try {
      const response = await api.addAgreementComment(id, {
        authorAddress: walletAddress,
        content: optimisticContent,
      });
      setPendingAgreementComments((prev) => prev.filter((comment) => comment.id !== optimisticComment.id));
      applyAgreementPayload(response);
    } catch (err) {
      setPendingAgreementComments((prev) => prev.filter((comment) => comment.id !== optimisticComment.id));
      setCommentContent((current) => current || optimisticContent);
      setError(err instanceof Error ? err.message : 'Failed to send comment');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleProposeAmendment() {
    if (!walletAddress) {
      return;
    }

    setActionLoading('amendment');
    setError(null);

    try {
      const pendingMilestones = (agreement?.milestones || [])
        .filter((milestone: any) => milestone.status === 'PENDING')
        .map((milestone: any) => ({
          id: milestone.id,
          title: milestone.title,
          description: milestone.description,
          sortOrder: milestone.sortOrder,
        }));

      const response = await api.proposeAgreementAmendment(id, {
        proposedBy: walletAddress,
        reason: amendmentReason.trim() || undefined,
        title: amendmentTitle.trim() || undefined,
        description: amendmentDescription.trim() || undefined,
        deadlineAt: amendmentDeadlineAt ? new Date(amendmentDeadlineAt).toISOString() : undefined,
        milestones: pendingMilestones,
      });
      setAmendmentReason('');
      setAmendmentTitle('');
      setAmendmentDescription('');
      setAmendmentDeadlineAt('');
      applyAgreementPayload(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to propose amendment');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRespondToAmendment(amendmentId: string, accept: boolean) {
    if (!walletAddress) {
      return;
    }

    setActionLoading(`amendment-${amendmentId}`);
    setError(null);

    try {
      const updated = await api.respondToAgreementAmendment(id, amendmentId, {
        actorAddress: walletAddress,
        accept,
        responseNote: amendmentResponseNote.trim() || undefined,
      });
      setAmendmentResponseNote('');
      setAgreement(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to respond to amendment');
    } finally {
      setActionLoading(null);
    }
  }

  if (!hasHydrated || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-agent-accent border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!authToken) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md w-full bg-agent-card border border-agent-border rounded-xl p-6 text-center">
          <h1 className="text-xl font-semibold text-white mb-2">Connect your wallet to open this agreement</h1>
          <p className="text-sm text-gray-400 mb-4">
            Viewing agreement details, proof, disputes, and settlement actions requires an authenticated wallet session.
          </p>
          <div className="flex justify-center">
            <WalletConnect />
          </div>
        </div>
      </div>
    );
  }

  if (!agreement) {
    const unavailableState = getAgreementUnavailableState(error);
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-xl w-full rounded-2xl border border-agent-border bg-agent-card p-6 text-center shadow-[0_18px_50px_rgba(15,23,42,0.22)]">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-agent-border bg-agent-bg/60">
            <ExclamationTriangleIcon className="h-6 w-6 text-amber-300" />
          </div>
          <h1 className="mb-2 text-2xl font-semibold text-white">{unavailableState.title}</h1>
          <p className="mx-auto max-w-lg text-sm leading-6 text-gray-300">
            {unavailableState.body}
          </p>
          <p className="mt-3 text-sm text-gray-500">{unavailableState.hint}</p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex w-full items-center justify-center rounded-xl bg-agent-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 sm:w-auto"
            >
              Try Again
            </button>
            <Link
              href="/dashboard"
              className="inline-flex w-full items-center justify-center rounded-xl border border-agent-border px-5 py-2.5 text-sm font-medium text-gray-200 transition-colors hover:bg-agent-bg sm:w-auto"
            >
              Return to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const milestones = agreement.milestones || [];
  const currentMilestone =
    milestones.find((milestone: any) => currentMilestoneStatuses.includes(milestone.status)) ||
    milestones.find((milestone: any) => milestone.status === 'PENDING') ||
    null;
  const currentProofCheck = currentMilestone
    ? (() => {
      const latestCheck = proofChecksByMilestone[currentMilestone.id] || null;
      const latestProofId = currentMilestone.proofs?.[0]?.id;
      if (!latestCheck || !latestProofId || latestCheck.proofId !== latestProofId) {
        return null;
      }

      return latestCheck;
    })()
    : null;
  const currentProofCheckLoading = currentMilestone ? proofCheckLoadingMilestoneId === currentMilestone.id : false;
  const currentMilestoneInfoRequests = currentMilestone
    ? infoRequests.filter((request) => request.milestoneId === currentMilestone.id)
    : [];
  const currentOpenInfoRequests = currentMilestoneInfoRequests.filter((request) => !request.resolved);
  const latestCurrentInfoRequest = currentMilestoneInfoRequests[0] || null;
  const paidMilestones = milestones.filter((milestone: any) => milestone.status === 'PAID').length;
  const isClient = walletAddress === agreement.clientAddress;
  const isWorker = walletAddress === agreement.workerAddress;
  const currentOpenDispute =
    agreement.disputes?.find((item: any) => !item.resolvedAt) || null;
  const displayedRecommendation = currentOpenDispute?.aiRecommendation
    ? {
      recommendation: currentOpenDispute.aiRecommendation,
      confidence: currentOpenDispute.aiConfidence,
      summary: currentOpenDispute.aiSummary,
      rationale: currentOpenDispute.aiRationale,
    }
    : null;
  const canClientReview =
    isClient &&
    (agreement.reviewerMode !== 'AUTO' || agreement.status === 'DISPUTED') &&
    currentMilestone != null &&
    ['PROOF_SUBMITTED', 'UNDER_REVIEW', 'DISPUTED'].includes(currentMilestone.status);
  const canSendInfoRequest =
    isClient &&
    currentMilestone != null &&
    ['PROOF_SUBMITTED', 'UNDER_REVIEW', 'DISPUTED'].includes(currentMilestone.status);
  const submitAreaProofCheck = currentMilestone?.status === 'ACTIVE'
    ? proofChecksByMilestone[currentMilestone.id] || null
    : currentProofCheck;
  const canResubmitProofAfterInfoRequest =
    isWorker &&
    currentMilestone != null &&
    currentMilestone.status === 'PROOF_SUBMITTED' &&
    currentOpenInfoRequests.length > 0;
  const isImportedGrant = isSponsorControlledImportedAgreement(agreement);
  const canOnchainRefundReview =
    agreement.escrowModel === 'ONCHAIN_LOCK' &&
    currentMilestone != null &&
    isWorker &&
    !isImportedGrant &&
    ['PROOF_SUBMITTED', 'UNDER_REVIEW', 'DISPUTED'].includes(currentMilestone.status);
  const fundingPending = agreement.settlementStatus === 'FUNDING_PENDING';
  const payoutPending = agreement.settlementStatus === 'PAYOUT_PENDING';
  const splitPending = agreement.settlementStatus === 'SPLIT_PENDING';
  const refundPending = agreement.settlementStatus === 'REFUND_PENDING';
  const reserveTopUpLoading = actionLoading === 'top-up-reserve';
  const hasRecordedFundingAttempt = Boolean(agreement.ckbTxHashFund);
  const fundingNeedsReconnect = agreement.status === 'DRAFT' && isClient && !signer;
  const fundingUnsupportedSigner =
    agreement.status === 'DRAFT' && isClient && signer != null && !canSignerFundAgreement(signer);
  const canFundAgreement =
    agreement.status === 'DRAFT' &&
    !fundingPending &&
    !hasRecordedFundingAttempt &&
    isClient &&
    canSignerFundAgreement(signer) &&
    Boolean(agreement.escrowAddress || publicConfig?.treasuryAddress);
  const approveLoading = actionLoading === 'APPROVE';
  const rejectLoading = actionLoading === 'REJECT';
  const sendInfoRequestLoading = actionLoading === 'send-info-request';
  const draftInfoRequestLoading = actionLoading === 'draft-info-request';
  const sendInfoResponseLoading = actionLoading === 'send-info-response';
  const mutualRefundLoading = actionLoading === 'mutual-refund';
  const splitLoading = actionLoading === 'split';
  const reconcileLoading = actionLoading === 'reconcile';
  const retrySettlementLoading = actionLoading === 'retry-settlement';
  const refreshingStatus = actionLoading === 'refresh';
  const disputeLoading = actionLoading === 'dispute';
  const disputeOpenedByLabel = currentOpenDispute
    ? getParticipantLabel(currentOpenDispute.openedBy, agreement)
    : null;
  const canReplyToDispute = Boolean(currentOpenDispute) && (isClient || isWorker);
  const refundConsensus = currentOpenDispute?.refundConsensus || null;
  const splitConsensus = currentOpenDispute?.splitConsensus || null;
  const disputeWorkspaceState = currentOpenDispute?.workspaceState || null;
  const hasApprovedMutualRefund = Boolean(
    walletAddress
    && refundConsensus
    && ((walletAddress === agreement.clientAddress && refundConsensus.clientApprovedAt)
      || (walletAddress === agreement.workerAddress && refundConsensus.workerApprovedAt))
  );
  const canProposeMutualRefund =
    Boolean(currentOpenDispute)
    && isClient
    && !refundConsensus?.proposedBy
    && !refundConsensus?.fullyApproved;
  const canAcceptMutualRefund =
    Boolean(currentOpenDispute)
    && isWorker
    && refundConsensus?.proposedBy === agreement.clientAddress
    && !refundConsensus?.workerApprovedAt
    && !refundConsensus?.fullyApproved;
  const canProposeSplitSettlement =
    Boolean(currentOpenDispute)
    && isClient
    && !splitConsensus?.proposedBy
    && !splitConsensus?.fullyApproved;
  const canAcceptSplitSettlement =
    Boolean(currentOpenDispute)
    && isWorker
    && splitConsensus?.proposedBy === agreement.clientAddress
    && !splitConsensus?.workerApprovedAt
    && !splitConsensus?.fullyApproved;
  const openerEvidenceEntry = currentOpenDispute
    ? (currentOpenDispute.evidenceEntries || []).find((entry: any) => entry.submittedBy === currentOpenDispute.openedBy)
    : null;
  const openerEvidenceBundle = openerEvidenceEntry
    ? parseDisputeEvidenceBundle(openerEvidenceEntry.content)
    : null;
  const displayedDisputeReplies = [
    ...((currentOpenDispute?.evidenceEntries || []).filter((entry: any) => entry.id !== openerEvidenceEntry?.id)),
    ...pendingDisputeReplies,
  ];
  const disputeReplyCount = displayedDisputeReplies.length;
  const recommendationAvailability = getRecommendationAvailability(currentOpenDispute, agreement);
  const expectedReplyLabel = recommendationAvailability?.counterpartyAddress
    ? getParticipantLabel(recommendationAvailability.counterpartyAddress, agreement)
    : 'other participant';
  const recommendationWaitMessage = recommendationAvailability && !recommendationAvailability.ready
    ? `The AI recommendation unlocks after the ${expectedReplyLabel.toLowerCase()} replies, or after ${recommendationAvailability.responseDeadlineAt.toLocaleString()} if no reply arrives.`
    : null;
  const splitWorkerAmountError = (() => {
    if (disputeResolution !== 'SPLIT' && !canProposeSplitSettlement) {
      return null;
    }

    const trimmed = splitWorkerAmountCkb.trim();
    if (!trimmed) {
      return 'Enter the worker amount for the split settlement.';
    }

    const parsed = Number(trimmed);
    const currentMilestoneCkb = currentMilestone ? Number(shannonsToCKB(currentMilestone.amount)) : null;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 'Enter a valid worker amount greater than 0.';
    }

    if (currentMilestoneCkb != null && parsed >= currentMilestoneCkb) {
      return `Worker amount must be less than the current milestone amount of ${shannonsToCKB(currentMilestone.amount)} CKB.`;
    }

    return null;
  })();
  const mutualRefundActionLabel = refundConsensus?.proposedBy
    ? hasApprovedMutualRefund
      ? 'Refund Approval Recorded'
      : 'Accept Mutual Refund'
    : isWorker
      ? 'Waiting for Client Proposal'
      : 'Propose Mutual Refund';
  const mutualRefundStatusText = refundConsensus?.proposedBy
    ? refundConsensus.fullyApproved
      ? 'Both parties approved this refund.'
      : refundConsensus.awaitingAddress
        ? `${getParticipantLabel(refundConsensus.awaitingAddress, agreement)} approval is still needed before the refund can execute.`
        : 'Waiting for the second approval.'
    : isWorker
      ? 'Only the client can start a mutual refund proposal. You can accept it after the client initiates it.'
      : 'A refund only moves funds after both client and worker agree inside this dispute.';
  const replyPlaceholder = isClient
    ? 'Reply to the worker with any clarification, screenshots, or acceptance notes...'
    : isWorker
      ? 'Reply to the client dispute with your explanation, proof links, or supporting context...'
      : 'Reply to this dispute...';
  const replyHelpText = isClient
    ? 'Your reply is visible to the worker immediately while both pages are open.'
    : isWorker
      ? 'Use this to answer the client dispute directly. Your reply appears in the shared thread.'
      : 'Replies appear in the shared dispute thread.';
  const splitSettlementStatusText = splitConsensus?.proposedBy
    ? splitConsensus.fullyApproved
      ? 'Both parties approved this split settlement.'
      : splitConsensus.awaitingAddress
        ? `${getParticipantLabel(splitConsensus.awaitingAddress, agreement)} approval is still needed before the split settlement can execute.`
        : 'Waiting for the second approval.'
    : 'Use split settlement when both sides agree to pay part of the milestone to the worker and refund the rest to the client.';
  const splitSettlementActionLabel = splitConsensus?.proposedBy
    ? splitConsensus.fullyApproved
      ? 'Split Confirmed'
      : isWorker
        ? 'Accept Split Settlement'
        : 'Split Proposal Sent'
    : isWorker
      ? 'Waiting for Client Proposal'
      : 'Propose Split Settlement';
  const settlementHistory = agreement.settlements || [];
  const escrowAddress = agreement.escrowAddress || publicConfig?.treasuryAddress || null;
  const canReconcileSettlement =
    (isClient || isWorker) &&
    (agreement.settlementStatus === 'FAILED' ||
      agreement.settlementStatus === 'FUNDING_PENDING' ||
      agreement.settlementStatus === 'PAYOUT_PENDING' ||
      agreement.settlementStatus === 'SPLIT_PENDING' ||
      agreement.settlementStatus === 'REFUND_PENDING');
  const agreementStatusMeta = getStatusMeta(agreement.status);
  const settlementStatusMeta = getStatusMeta(agreement.settlementStatus || 'UNFUNDED');
  const currentMilestoneIndex = currentMilestone
    ? milestones.findIndex((milestone: any) => milestone.id === currentMilestone.id)
    : -1;
  const currentMilestoneSummary = currentMilestone
    ? `${currentMilestone.title} · ${shannonsToCKB(currentMilestone.amount)} CKB · ${getMilestonePhaseLabel(currentMilestone.status)}`
    : 'No active milestone yet.';
  const nextActionSummary = agreement.nextParticipantAction
    || (agreement.status === 'DRAFT'
      ? 'Finish the draft and fund the agreement to start the first milestone.'
      : agreement.status === 'FUNDED' && isWorker
        ? 'Submit proof for the current milestone so review can begin.'
        : agreement.status === 'UNDER_REVIEW' && isClient
          ? 'Review the current milestone and choose whether to approve or dispute it.'
          : agreement.status === 'DISPUTED'
            ? 'Use the dispute workspace to reply, negotiate, or request a recommendation.'
            : settlementStatusMeta.hint
              ? settlementStatusMeta.hint
              : agreementStatusMeta.hint || 'Open the current milestone details and continue the next step.');
  const draftMinimumMilestoneCapacity = getMinimumMilestoneCapacity({
    escrowModel: draftForm?.payoutNetwork === 'CKB' && publicConfig?.onchainEscrowReady ? 'ONCHAIN_LOCK' : agreement.escrowModel,
    payoutNetwork: draftForm?.payoutNetwork || agreement.payoutNetwork,
    escrowLockCodeHash: agreement.escrowLockCodeHash || publicConfig?.onchainLockCodeHash,
    escrowLockHashType: agreement.escrowLockHashType || publicConfig?.onchainLockHashType,
    escrowLockArgs: agreement.escrowLockArgs || (publicConfig?.onchainEscrowReady ? `0x${'00'.repeat(32 * 3)}` : null),
  });
  const draftMinimumMilestoneCkb = formatCkbAmount(draftMinimumMilestoneCapacity);
  const draftFieldErrors = draftForm ? {
    title: !draftForm.title.trim() ? 'Agreement title is required.' : null,
    workerAddress:
      !draftForm.workerAddress.trim()
        ? 'Worker address is required.'
        : !isLikelyCkbAddress(draftForm.workerAddress)
          ? 'Use a valid CKB address starting with ckt1 or ckb1.'
          : null,
    description: !draftForm.description.trim() ? 'Agreement description is required.' : null,
    deadlineAt: !draftForm.deadlineAt ? 'Deadline is required.' : null,
    disputeWindowHours:
      !draftForm.disputeWindowHours.trim()
        ? 'Dispute window is required.'
        : Number(draftForm.disputeWindowHours) < 1
          ? 'Dispute window must be at least 1 hour.'
          : null,
  } : null;
  const draftMilestoneErrors = draftMilestones.map((milestone) => ({
    title: !milestone.title.trim() ? 'Milestone title is required.' : null,
    description: !milestone.description.trim() ? 'Milestone description is required.' : null,
    amount:
      !milestone.amount.trim()
        ? 'Milestone amount is required.'
        : BigInt(milestone.amount || '0') < draftMinimumMilestoneCapacity
          ? `Milestone amount must be at least ${draftMinimumMilestoneCkb} CKB for the current escrow setup.`
          : null,
  }));
  const actionPanel = agreement.status === 'DRAFT'
    ? {
      title: isClient ? 'Draft agreement is waiting on you' : 'Draft agreement is waiting on the client',
      body: isClient
        ? 'Check the draft terms, invite the worker if needed, and fund the agreement once everything is ready.'
        : 'The client still needs to finalize and fund this draft before work can begin.',
    }
    : agreement.status === 'FUNDED' && isWorker && currentMilestone?.status === 'ACTIVE'
      ? {
        title: 'Current milestone is ready for delivery',
        body: `Submit proof for ${currentMilestone.title} when the work is ready for review.`,
      }
      : canClientReview && currentMilestone
        ? {
          title: 'Review decision needed now',
          body: isImportedGrant
            ? `The worker has delivered ${currentMilestone.title}. Review the proof, ask for more information if needed, and approve the milestone when you are satisfied.`
            : `The worker has delivered ${currentMilestone.title}. Approve the payout, reject it, or open a dispute based on the submitted proof.`,
        }
        : agreement.status === 'DISPUTED' && currentMilestone
          ? {
            title: 'Dispute workspace is active',
            body: `Use the shared dispute thread for ${currentMilestone.title} to exchange evidence and choose a resolution path.`,
          }
          : {
            title: 'Agreement is progressing',
            body: nextActionSummary,
          };
  const isGrantMode = Boolean(agreement.source);
  const viewerRole = isClient
    ? {
      label: 'Client Operator',
      summary: isGrantMode
        ? 'You define the funding plan, review deliverables, and release each approved milestone.'
        : 'You fund the agreement, review each delivery, and decide when payouts or disputes should move forward.',
    }
    : isWorker
      ? {
        label: isGrantMode ? 'Builder / Grantee' : 'Worker / Contributor',
        summary: isGrantMode
          ? 'You deliver each checkpoint, submit proof, and wait for manual reviewer approval before each payout.'
          : 'You deliver work milestone by milestone, submit proof, and react to client review or dispute requests.',
      }
      : isAdmin
        ? {
          label: 'Admin Observer',
          summary: 'You can inspect lifecycle state, logs, and settlement context, but normal participant actions still belong to the client and worker.',
        }
        : walletAddress
          ? {
            label: 'Connected Observer',
            summary: 'You are connected, but this wallet is not one of the primary participants on this agreement.',
          }
          : {
            label: 'Visitor',
            summary: 'Connect the participant wallet to unlock funding, proof, review, and dispute controls.',
          };
  const roleActionLabel = isClient
    ? 'Client action lane'
    : isWorker
      ? 'Worker action lane'
      : isAdmin
        ? 'Operator visibility lane'
        : 'Read-only lane';
  const grantModeSummary = isGrantMode
    ? `Imported from ${agreement.source.sourceType === 'DAO' ? 'a DAO workflow' : 'a bounty source'} so the external context, treasury sponsor, and governance notes stay attached to every milestone.`
    : 'Created directly inside PactAgent as a standard milestone agreement between client and worker.';
  const isUsdEquivalentGrant = isGrantMode && agreement.pricingMode === 'USD_EQUIVALENT';
  const reserveRemainingCkb = agreement.reserveCkbRemaining ? shannonsToCKB(agreement.reserveCkbRemaining) : null;
  const reserveLockedCkb = agreement.reserveCkbLocked ? shannonsToCKB(agreement.reserveCkbLocked) : null;
  const liveDraftReserveCkb = (() => {
    if (!isUsdEquivalentGrant || agreement.status !== 'DRAFT' || !liveCkbQuote) {
      return null;
    }

    const totalTargetUsd = milestones.reduce((sum: number, milestone: any) => sum + (Number(milestone.targetUsd) || 0), 0);
    if (!totalTargetUsd || !Number.isFinite(totalTargetUsd)) {
      return null;
    }

    const reserveEstimate = (totalTargetUsd / liveCkbQuote.priceUsd) * 1.2;
    return reserveEstimate;
  })();
  const currentDraftReserveLabel = liveDraftReserveCkb != null
    ? `${liveDraftReserveCkb.toLocaleString('en-US', { maximumFractionDigits: 2 })} CKB`
    : shannonsToCKB(agreement.amount);
  const currentDraftReserveShannons = liveDraftReserveCkb != null
    ? ckbToShannons(String(liveDraftReserveCkb)).toString()
    : agreement.amount;
  const currentMilestoneTargetUsd = currentMilestone?.targetUsd ? `$${currentMilestone.targetUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : null;
  const currentMilestoneReleasedUsd = currentMilestone?.releasedUsdValue ? `$${currentMilestone.releasedUsdValue.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : null;
  const reserveQuoteLabel = agreement.reserveFundingQuoteUsdPerCkb
    ? `$${agreement.reserveFundingQuoteUsdPerCkb.toFixed(6)} / CKB`
    : 'Not recorded';
  const currentLiveQuoteLabel = liveCkbQuote
    ? `$${liveCkbQuote.priceUsd.toFixed(6)} / CKB`
    : reserveQuoteLabel;
  const liveReserveUsdValue = (() => {
    if (!isUsdEquivalentGrant || agreement.status === 'DRAFT' || !liveCkbQuote || !agreement.reserveCkbRemaining) return null;
    const remainingShannons = BigInt(agreement.reserveCkbRemaining);
    const remainingCkb = Number(remainingShannons) / 1e8;
    return remainingCkb * liveCkbQuote.priceUsd;
  })();
  const liveTotalUsdValue = (() => {
    if (!isUsdEquivalentGrant || agreement.status === 'DRAFT' || !liveCkbQuote) return null;
    const totalShannons = BigInt(agreement.amount);
    const totalCkb = Number(totalShannons) / 1e8;
    return totalCkb * liveCkbQuote.priceUsd;
  })();
  const priceMovementPct = (() => {
    if (!isUsdEquivalentGrant || agreement.status === 'DRAFT' || !liveCkbQuote || !agreement.reserveFundingQuoteUsdPerCkb) return null;
    return ((liveCkbQuote.priceUsd - agreement.reserveFundingQuoteUsdPerCkb) / agreement.reserveFundingQuoteUsdPerCkb) * 100;
  })();
  const priceMovementLabel = (() => {
    if (priceMovementPct == null) return null;
    const sign = priceMovementPct >= 0 ? '+' : '';
    return `${sign}${priceMovementPct.toFixed(2)}%`;
  })();
  const importedSourceMetadata = safeParseJson<Record<string, any>>(agreement.source?.externalMetadataJson) || null;
  const latestSourceSyncActivity = buildLatestSourceSyncActivity(auditLogs);
  const lifecycleOverview = isGrantMode
    ? 'Import source context, fund the full grant once, then move milestone-by-milestone through reviewer approval and payout.'
    : 'Draft the agreement, fund it once, deliver milestone proof, review the work, and settle each approved checkpoint cleanly.';
  const nextActionOwner = (() => {
    if (agreement.status === 'DRAFT') {
      return {
        label: isClient ? 'You (client operator)' : 'Client operator',
        detail: 'Finalize the draft, invite the worker if needed, and fund the agreement to activate the first milestone.',
      };
    }

    if (agreement.status === 'FUNDED' && currentMilestone?.status === 'ACTIVE') {
      return {
        label: isWorker ? 'You (worker / builder)' : 'Worker / builder',
        detail: 'The current milestone is active and waiting for proof delivery.',
      };
    }

    if (
      ['PROOF_SUBMITTED', 'UNDER_REVIEW'].includes(agreement.status)
      || ['PROOF_SUBMITTED', 'UNDER_REVIEW'].includes(currentMilestone?.status || '')
    ) {
      return {
        label: isClient ? 'You (review owner)' : 'Client reviewer',
        detail: 'A human review decision is now the gating step before payout or dispute.',
      };
    }

    if (agreement.status === 'DISPUTED') {
      return {
        label: isClient || isWorker ? 'Both participants' : 'Client and worker',
        detail: 'Use the dispute workspace to exchange evidence, answer questions, and agree on the resolution path.',
      };
    }

    if (['PAYOUT_PENDING', 'REFUND_PENDING', 'SPLIT_PENDING'].includes(agreement.settlementStatus || '')) {
      return {
        label: 'Settlement layer',
        detail: 'PactAgent is trying to complete the settlement. Participants mainly need to monitor and reconcile if anything stalls.',
      };
    }

    if (['PAID', 'REFUNDED', 'EXPIRED', 'CANCELLED'].includes(agreement.status)) {
      return {
        label: 'No active owner',
        detail: 'This agreement is effectively closed unless someone needs to inspect the history or settlement trail.',
      };
    }

    return {
      label: 'Participant handoff',
      detail: nextActionSummary,
    };
  })();
  const riskFlags = [
    isUsdEquivalentGrant && agreement.reserveHealthStatus === 'TOP_UP_REQUIRED'
      ? {
        label: 'Reserve top-up required',
        detail: 'The remaining CKB reserve is no longer enough to satisfy the next USD-equivalent milestone payout.',
        tone: 'border-rose-700/40 bg-rose-950/20 text-rose-100',
      }
      : null,
    agreement.status === 'DISPUTED'
      ? {
        label: 'Dispute is open',
        detail: 'The current milestone is blocked until the participants resolve the dispute workspace.',
        tone: 'border-rose-700/40 bg-rose-950/20 text-rose-100',
      }
      : null,
    agreement.settlementStatus === 'FAILED'
      ? {
        label: 'Settlement needs attention',
        detail: agreement.lastSettlementError || 'The latest funding or payout attempt failed and may need a retry or reconciliation.',
        tone: 'border-rose-700/40 bg-rose-950/20 text-rose-100',
      }
      : null,
    currentOpenInfoRequests.length > 0
      ? {
        label: 'More information requested',
        detail: `${currentOpenInfoRequests.length} open info request${currentOpenInfoRequests.length === 1 ? '' : 's'} still need a response before review feels complete.`,
        tone: 'border-amber-700/40 bg-amber-950/20 text-amber-100',
      }
      : null,
    fundingNeedsReconnect
      ? {
        label: 'Funding wallet disconnected',
        detail: 'The client is signed in but needs to reconnect the funding wallet before this draft can move forward.',
        tone: 'border-yellow-700/40 bg-yellow-950/20 text-yellow-100',
      }
      : null,
    fundingUnsupportedSigner
      ? {
        label: 'Funding wallet unsupported',
        detail: 'The connected wallet can sign in, but it cannot fund this agreement.',
        tone: 'border-yellow-700/40 bg-yellow-950/20 text-yellow-100',
      }
      : null,
    describeMissingSourceFields(importedSourceMetadata?.missingFields)
      ? {
        label: 'Imported source is incomplete',
        detail: describeMissingSourceFields(importedSourceMetadata?.missingFields) || 'The source thread is missing fields PactAgent expected to find.',
        tone: 'border-fuchsia-700/40 bg-fuchsia-950/20 text-fuchsia-100',
      }
      : null,
  ].filter(Boolean) as Array<{ label: string; detail: string; tone: string }>;
  const currentStateLabel = agreement.workflowStage
    ? getStatusMeta(agreement.workflowStage).label
    : agreementStatusMeta.label;
  const currentStateDetail = agreementStatusMeta.hint || settlementStatusMeta.hint || lifecycleOverview;
  const progressSummary = milestones.length
    ? `${paidMilestones}/${milestones.length} milestone${milestones.length === 1 ? '' : 's'} paid`
    : 'No milestones configured yet.';
  const displayedAgreementComments = [
    ...(agreement.comments || []),
    ...pendingAgreementComments,
  ].sort(
    (left: any, right: any) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );
  const lifecycleSteps: Array<{
    key: string;
    label: string;
    detail: string;
    state: LifecycleStepState;
  }> = [
      {
        key: 'create',
        label: 'Create',
        detail: isGrantMode ? 'Grant terms imported and normalized' : 'Agreement draft captured',
        state: 'complete' as LifecycleStepState,
      },
      {
        key: 'fund',
        label: 'Fund',
        detail: isGrantMode ? 'Lock treasury budget once' : 'Lock the full agreement value',
        state:
          agreement.status === 'DRAFT'
            ? 'current'
            : 'complete',
      },
      {
        key: 'deliver',
        label: 'Deliver',
        detail: currentMilestone ? currentMilestone.title : 'Wait for the first milestone',
        state:
          agreement.status === 'DRAFT'
            ? 'upcoming'
            : ['FUNDED', 'PROOF_SUBMITTED', 'UNDER_REVIEW', 'DISPUTED', 'PAID', 'REFUNDED', 'EXPIRED'].includes(agreement.status)
              ? currentMilestone?.status === 'ACTIVE'
                ? 'current'
                : ['PROOF_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PAID', 'DISPUTED', 'REFUNDED', 'EXPIRED'].includes(currentMilestone?.status || '')
                  ? 'complete'
                  : 'upcoming'
              : 'upcoming',
      },
      {
        key: 'review',
        label: agreement.reviewerMode === 'MANUAL' ? 'Manual Review' : 'Review',
        detail: agreement.reviewerMode === 'MANUAL' ? 'Human reviewer must approve each release' : 'Review decides payout path',
        state:
          agreement.status === 'DISPUTED'
            ? 'blocked'
            : ['PROOF_SUBMITTED', 'UNDER_REVIEW'].includes(agreement.status) || ['PROOF_SUBMITTED', 'UNDER_REVIEW'].includes(currentMilestone?.status || '')
              ? 'current'
              : ['APPROVED', 'PAID', 'REFUNDED'].includes(currentMilestone?.status || '') || ['PAID', 'REFUNDED'].includes(agreement.status)
                ? 'complete'
                : agreement.status === 'DRAFT' || agreement.status === 'FUNDED'
                  ? 'upcoming'
                  : 'upcoming',
      },
      {
        key: 'settle',
        label: 'Settle',
        detail: agreement.payoutNetwork === 'FIBER' ? 'Route the payout over Fiber when approved' : 'Confirm on-chain payout or refund',
        state:
          agreement.status === 'DISPUTED'
            ? 'blocked'
            : ['PAYOUT_PENDING', 'REFUND_PENDING', 'SPLIT_PENDING', 'FAILED'].includes(agreement.settlementStatus || '')
              ? 'current'
              : ['PAID', 'REFUNDED'].includes(agreement.status)
                ? 'complete'
                : currentMilestone?.status === 'APPROVED'
                  ? 'current'
                  : agreement.status === 'DRAFT' || agreement.status === 'FUNDED'
                    ? 'upcoming'
                    : 'upcoming',
      },
      {
        key: 'complete',
        label: isGrantMode ? 'Close Grant' : 'Complete',
        detail: isGrantMode ? 'Every checkpoint approved and recorded' : 'Agreement settled and closed',
        state:
          ['PAID', 'REFUNDED', 'EXPIRED', 'CANCELLED'].includes(agreement.status)
            ? 'complete'
            : agreement.status === 'DISPUTED'
              ? 'blocked'
              : 'upcoming',
      },
    ];
  const operationalTimeline = (() => {
    const items: Array<{
      id: string;
      kind: string;
      title: string;
      detail: string;
      timestamp: number;
      tone: string;
    }> = [];

    settlementHistory.forEach((settlement: any) => {
      const milestoneLabel = settlement.milestoneId
        ? `Milestone ${milestones.find((milestone: any) => milestone.id === settlement.milestoneId)?.sortOrder || '?'}`
        : 'Agreement-level';
      items.push({
        id: `settlement-${settlement.id}`,
        kind: 'Settlement',
        title: `${getStatusMeta(settlement.direction).label} ${getStatusMeta(settlement.status).label}`,
        detail: `${milestoneLabel} · ${shannonsToCKB(settlement.amount)} CKB · ${settlement.txHash ? 'transaction recorded' : 'internal record'}`,
        timestamp: new Date(settlement.confirmedAt || settlement.createdAt).getTime(),
        tone: 'border-cyan-900/50 bg-cyan-950/20 text-cyan-200',
      });
    });

    auditLogs.forEach((entry: any) => {
      const metadata = safeParseJson<Record<string, unknown>>(entry.metadataJson);
      const sourceLabel = typeof metadata?.sourceLabel === 'string' ? metadata.sourceLabel : null;
      const sourceType = typeof metadata?.sourceType === 'string' ? metadata.sourceType : null;
      const importedBountyDetail =
        entry.action === 'AGREEMENT_IMPORTED_FROM_BOUNTY'
          ? `Imported from ${sourceLabel || 'the source record'}${sourceType ? ` · ${sourceType.toLowerCase()} workflow attached` : ''}.`
          : null;
      const infoRequestDetail =
        entry.action === 'INFO_REQUESTED' && Array.isArray(metadata?.questions)
          ? `Requested more info: ${(metadata.questions as string[]).slice(0, 2).join(' ')}`
          : entry.action === 'INFO_RECEIVED' && typeof metadata?.responsePreview === 'string'
            ? `Info response received: ${metadata.responsePreview}`
            : null;
      items.push({
        id: `audit-${entry.id}`,
        kind: 'Audit',
        title: formatAuditActionTitle(entry.action),
        detail:
          importedBountyDetail
          || infoRequestDetail
          || `${entry.actorAddress ? `${getParticipantLabel(entry.actorAddress, agreement)} acted` : 'System action'} on ${entry.resourceType.toLowerCase()} ${entry.resourceId}`,
        timestamp: new Date(entry.createdAt).getTime(),
        tone: 'border-violet-900/50 bg-violet-950/20 text-violet-200',
      });
    });

    (agreement.comments || []).forEach((comment: any) => {
      items.push({
        id: `comment-${comment.id}`,
        kind: 'Thread',
        title: `${getParticipantLabel(comment.authorAddress, agreement)} posted a message`,
        detail: comment.content,
        timestamp: new Date(comment.createdAt).getTime(),
        tone: 'border-sky-900/50 bg-sky-950/20 text-sky-200',
      });
    });

    (agreement.amendments || []).forEach((amendment: any) => {
      items.push({
        id: `amendment-${amendment.id}`,
        kind: 'Amendment',
        title: `${getStatusMeta(amendment.status).label} amendment proposal`,
        detail: amendment.reason || 'No amendment reason provided.',
        timestamp: new Date(amendment.updatedAt || amendment.createdAt).getTime(),
        tone: 'border-amber-900/50 bg-amber-950/20 text-amber-200',
      });
    });

    if (currentOpenDispute) {
      items.push({
        id: `dispute-open-${currentOpenDispute.id}`,
        kind: 'Dispute',
        title: `${disputeOpenedByLabel || 'Participant'} opened a dispute`,
        detail: currentOpenDispute.reason,
        timestamp: new Date(currentOpenDispute.createdAt).getTime(),
        tone: 'border-rose-900/50 bg-rose-950/20 text-rose-200',
      });
    }

    displayedDisputeReplies.forEach((reply: any) => {
      items.push({
        id: `dispute-reply-${reply.id}`,
        kind: 'Dispute Reply',
        title: `${getParticipantLabel(reply.submittedBy, agreement)} added dispute evidence`,
        detail: reply.content,
        timestamp: new Date(reply.createdAt).getTime(),
        tone: 'border-fuchsia-900/50 bg-fuchsia-950/20 text-fuchsia-200',
      });
    });

    return items.sort((left, right) => right.timestamp - left.timestamp).slice(0, 18);
  })();

  return (
    <div className="min-h-screen">
      <nav className="app-nav">
        <div className="app-nav-inner">
          <div className="flex min-w-0 items-center gap-3">
            <BrandLogo />
            <span className="text-gray-600">/</span>
            <span className="truncate text-sm text-gray-400">{agreement.title}</span>
          </div>
          <NavbarMenu>
            <Link href="/dashboard" className="app-nav-link">Dashboard</Link>
            <Link href="/agreement/import-bounty" className="app-nav-link">Imports</Link>
            {isAdmin ? <Link href="/admin" className="app-nav-link-accent">Admin</Link> : null}
          </NavbarMenu>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6">
        <Link href="/dashboard" className="page-back-link mb-5">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Dashboard
        </Link>
        {successMessage ? (
          <div className="ui-alert-success mb-5 shadow-[0_18px_40px_rgba(16,185,129,0.08)]">
            {successMessage}
          </div>
        ) : null}
        <div className={`mb-5 rounded-2xl border px-4 py-4 ${
          riskFlags.length
            ? riskFlags[0].tone
            : 'border-emerald-700/30 bg-emerald-950/15 text-emerald-100'
        }`}>
          <div className="text-[11px] uppercase tracking-[0.16em]">
            {riskFlags.length ? 'Critical Strip' : 'Clear State'}
          </div>
          <div className="mt-2 text-sm font-medium text-white">
            {riskFlags.length ? riskFlags[0].label : 'No immediate blockers are flagged on this agreement.'}
          </div>
          <p className="mt-1 text-sm opacity-90">
            {riskFlags.length ? riskFlags[0].detail : nextActionOwner.detail}
          </p>
        </div>
        <div className="mb-5 flex flex-wrap gap-2">
          {[
            ['#overview', 'Overview'],
            ['#milestones', 'Milestones'],
            ['#review', 'Proof & Review'],
            ['#funding', 'Funding & Settlement'],
            ['#timeline', 'Timeline'],
          ].map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="rounded-full border border-agent-border bg-agent-bg/55 px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-gray-300 transition-colors hover:border-agent-accent/40 hover:text-white"
            >
              {label}
            </a>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div id="overview" className="overflow-hidden rounded-3xl border border-agent-border bg-agent-card shadow-[0_24px_60px_rgba(15,23,42,0.28)]">
              <div className={`border-b border-agent-border p-6 sm:p-7 ${isGrantMode
                ? 'bg-[radial-gradient(circle_at_top_left,rgba(168,85,247,0.18),transparent_42%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.16),transparent_36%)]'
                : 'bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_40%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.16),transparent_34%)]'
                }`}>
                <div className="flex flex-col gap-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="max-w-3xl">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] ${isGrantMode
                          ? 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200'
                          : 'border-sky-500/30 bg-sky-500/10 text-sky-200'
                          }`}>
                          <SparklesIcon className="h-3.5 w-3.5" />
                          {isGrantMode ? `${agreement.source.sourceType} Grant Mode` : 'Direct Agreement Mode'}
                        </span>
                        <span className="inline-flex items-center gap-2 rounded-full border border-agent-border bg-agent-bg/70 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-agent-accent">
                          <TrophyIcon className="h-3.5 w-3.5" />
                          Lifecycle-centered workspace
                        </span>
                      </div>
                      <h1 className="mb-2 text-2xl font-bold text-white sm:text-3xl">{agreement.title}</h1>
                      <p className="mb-2 text-xs font-mono text-gray-500">{agreement.id}</p>
                      <p className="text-sm leading-6 text-gray-300">{agreement.description}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:max-w-[240px] lg:justify-end">
                      <StatusBadge status={agreement.status} />
                      <StatusBadge status={agreement.settlementStatus || 'UNFUNDED'} />
                      <NetworkBadge network={agreement.payoutNetwork} />
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                    <div className="rounded-3xl border border-agent-border bg-agent-bg/60 p-5">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-agent-accent">Current State</div>
                      <h2 className="mt-2 text-xl font-semibold text-white">{currentStateLabel}</h2>
                      <p className="mt-2 text-sm text-gray-400">{currentStateDetail}</p>

                      <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border border-agent-border bg-agent-card/60 p-4">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Next action</div>
                          <div className="mt-2 text-sm font-medium text-white">{nextActionSummary}</div>
                        </div>
                        <div className="rounded-2xl border border-agent-border bg-agent-card/60 p-4">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Action owner</div>
                          <div className="mt-2 text-sm font-medium text-white">{nextActionOwner.label}</div>
                          <p className="mt-2 text-xs text-gray-500">{nextActionOwner.detail}</p>
                        </div>
                        <div className="rounded-2xl border border-agent-border bg-agent-card/60 p-4">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Current milestone</div>
                          <div className="mt-2 text-sm font-medium text-white">{currentMilestoneSummary}</div>
                          <p className="mt-2 text-xs text-gray-500">
                            {currentMilestone ? 'This checkpoint sets the current delivery and review context.' : 'The first checkpoint becomes active after funding.'}
                          </p>
                          {isUsdEquivalentGrant && currentMilestoneTargetUsd ? (
                            <p className="mt-2 text-xs text-emerald-200">Canonical target: {currentMilestoneTargetUsd}</p>
                          ) : null}
                        </div>
                        <div className="rounded-2xl border border-agent-border bg-agent-card/60 p-4">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Progress</div>
                          <div className="mt-2 text-sm font-medium text-white">{progressSummary}</div>
                          <p className="mt-2 text-xs text-gray-500">Agreement mode: {isGrantMode ? 'Imported grant / bounty' : 'Direct bilateral agreement'}.</p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-agent-border bg-agent-bg/60 p-5">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-agent-accent">Role + Context</div>
                      <h2 className="mt-2 text-xl font-semibold text-white">{viewerRole.label}</h2>
                      <p className="mt-2 text-sm text-gray-400">{viewerRole.summary}</p>
                      <div className="mt-4 rounded-2xl border border-agent-border bg-agent-card/60 p-4">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">{roleActionLabel}</div>
                        <p className="mt-2 text-sm text-gray-300">{grantModeSummary}</p>
                      </div>
                      <div className="mt-4 rounded-2xl border border-agent-border bg-agent-card/60 p-4">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Lifecycle path</div>
                        <p className="mt-2 text-sm text-gray-300">{lifecycleOverview}</p>
                      </div>
                      {isUsdEquivalentGrant ? (
                        <div className="mt-4 rounded-2xl border border-agent-border bg-agent-card/60 p-4">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Reserve model</div>
                          <p className="mt-2 text-sm text-gray-300">
                            This imported grant is tracked as a USD-equivalent obligation and settled in CKB from a treasury reserve. Payout amounts are determined at release time using a fresh quote.
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {riskFlags.length > 1 ? (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {riskFlags.slice(1).map((flag) => (
                        <div key={flag.label} className={`rounded-2xl border p-4 ${flag.tone}`}>
                          <div className="text-[11px] uppercase tracking-[0.16em]">Risk flag</div>
                          <h3 className="mt-2 text-sm font-semibold text-white">{flag.label}</h3>
                          <p className="mt-2 text-sm opacity-90">{flag.detail}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-emerald-700/30 bg-emerald-950/15 p-4 text-sm text-emerald-100">
                      No immediate workflow risks are flagged right now. The agreement is progressing without a visible blocker at the top level.
                    </div>
                  )}

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                    {lifecycleSteps.map((step, index) => {
                      const styles = getLifecycleStepStyles(step.state);
                      return (
                        <div key={step.key} className="rounded-2xl border border-agent-border bg-agent-bg/55 p-4">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div className={`flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold ${styles.ring}`}>
                              {index + 1}
                            </div>
                            <span className={`h-2.5 w-2.5 rounded-full ${styles.dot}`} />
                          </div>
                          <div className="text-sm font-semibold text-white">{step.label}</div>
                          <p className="mt-1 text-xs leading-5 text-gray-400">{step.detail}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="p-6">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <div>
                    <span className="mb-1 block text-[10px] uppercase text-gray-500">Total Value</span>
                    <span className="text-sm font-mono text-white">
                      {isUsdEquivalentGrant && agreement.status === 'DRAFT'
                        ? currentDraftReserveLabel
                        : shannonsToCKB(agreement.amount)} CKB
                    </span>
                    {liveTotalUsdValue != null ? (
                      <span className="mt-0.5 block text-[10px] text-emerald-300">
                        ≈ ${liveTotalUsdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD at live price
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <span className="mb-1 block text-[10px] uppercase text-gray-500">Deadline</span>
                    <span className="text-sm text-white">{new Date(agreement.deadlineAt).toLocaleDateString()}</span>
                  </div>
                  <div>
                    <span className="mb-1 block text-[10px] uppercase text-gray-500">Reviewer</span>
                    <span className="text-sm text-white">{agreement.reviewerMode}</span>
                  </div>
                  <div>
                    <span className="mb-1 block text-[10px] uppercase text-gray-500">Milestone Progress</span>
                    <span className="text-sm text-white">
                      {paidMilestones}/{milestones.length} milestones paid
                    </span>
                  </div>
                </div>

                {isUsdEquivalentGrant ? (
                  <div className="mt-4 grid gap-4 border-t border-agent-border pt-4 md:grid-cols-3">
                    <div>
                      <span className="mb-1 block text-[10px] uppercase text-gray-500">
                        {agreement.status === 'DRAFT' ? 'Current recommendation' : 'Reserve Locked'}
                      </span>
                      <span className="text-sm font-mono text-white">
                        {agreement.status === 'DRAFT'
                          ? `${currentDraftReserveLabel} CKB`
                          : `${reserveLockedCkb || '0'} CKB`}
                      </span>
                    </div>
                    <div>
                      <span className="mb-1 block text-[10px] uppercase text-gray-500">
                        {agreement.status === 'DRAFT' ? 'Stored draft reserve' : 'Reserve Remaining'}
                      </span>
                      <span className="text-sm font-mono text-white">
                        {agreement.status === 'DRAFT'
                          ? `${shannonsToCKB(agreement.amount)} CKB`
                          : `${reserveRemainingCkb || '0'} CKB`}
                      </span>
                      {liveReserveUsdValue != null ? (
                        <span className="mt-0.5 block text-[10px] text-emerald-300">
                          ≈ ${liveReserveUsdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD remaining
                        </span>
                      ) : null}
                    </div>
                    <div>
                      <span className="mb-1 block text-[10px] uppercase text-gray-500">
                        {agreement.status === 'DRAFT' ? 'Live quote' : 'Funding Quote'}
                      </span>
                      <span className="text-sm text-white">
                        {agreement.status === 'DRAFT' ? currentLiveQuoteLabel : reserveQuoteLabel}
                      </span>
                      {agreement.status !== 'DRAFT' && liveCkbQuote ? (
                        <>
                          <span className="mt-0.5 block text-[10px] text-cyan-300">
                            Live: ${liveCkbQuote.priceUsd.toFixed(6)} / CKB
                          </span>
                          {priceMovementLabel != null ? (
                            <span className={`mt-0.5 block text-[10px] font-medium ${(priceMovementPct || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}>
                              {priceMovementLabel} since funding
                            </span>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div className={`mt-4 grid gap-4 border-t border-agent-border pt-4 ${agreement.payoutNetwork === 'FIBER' && agreement.workerFiberPubkey ? 'grid-cols-1 md:grid-cols-4' : 'grid-cols-3'
                  }`}>
                  <div>
                    <span className="mb-1 block text-[10px] uppercase text-gray-500">Client</span>
                    <span className="text-xs font-mono text-gray-300">{agreement.clientAddress.slice(0, 20)}...</span>
                  </div>
                  <div>
                    <span className="mb-1 block text-[10px] uppercase text-gray-500">Worker</span>
                    <span className="text-xs font-mono text-gray-300">{agreement.workerAddress.slice(0, 20)}...</span>
                  </div>
                  <div>
                    <span className="mb-1 block text-[10px] uppercase text-gray-500">Refund Rule</span>
                    <span className="text-xs text-gray-300">
                      Client and worker must both approve a refund during a dispute.
                    </span>
                  </div>
                  {agreement.payoutNetwork === 'FIBER' && agreement.workerFiberPubkey && (
                    <div>
                      <span className="mb-1 block text-[10px] uppercase text-gray-500">Worker Fiber Key</span>
                      <span className="break-all text-xs font-mono text-gray-300">{agreement.workerFiberPubkey}</span>
                    </div>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 border-t border-agent-border pt-4 md:grid-cols-2">
                  <div>
                    <span className="mb-1 block text-[10px] uppercase text-gray-500">Funding Address</span>
                    <span className="break-all text-xs font-mono text-gray-300">
                      {escrowAddress || 'Awaiting configuration'}
                    </span>
                  </div>
                  <div>
                    <span className="mb-1 block text-[10px] uppercase text-gray-500">Agreement Digest</span>
                    <span className="break-all text-xs font-mono text-gray-300">
                      {agreement.agreementDigest || 'Pending'}
                    </span>
                  </div>
                  <div>
                    <span className="mb-1 block text-[10px] uppercase text-gray-500">Milestone Digest</span>
                    <span className="break-all text-xs font-mono text-gray-300">
                      {agreement.milestoneDigest || 'Pending'}
                    </span>
                  </div>
                  {agreement.escrowModel === 'ONCHAIN_LOCK' && (
                    <>
                      <div>
                        <span className="mb-1 block text-[10px] uppercase text-gray-500">Lock Code Hash</span>
                        <span className="break-all text-xs font-mono text-gray-300">
                          {agreement.escrowLockCodeHash || 'Pending'}
                        </span>
                      </div>
                      <div>
                        <span className="mb-1 block text-[10px] uppercase text-gray-500">Lock Args</span>
                        <span className="break-all text-xs font-mono text-gray-300">
                          {agreement.escrowLockArgs || 'Pending'}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {(agreement.ckbTxHashFund || agreement.ckbTxHashRelease || agreement.fiberPaymentReference || agreement.lastSettlementError) && (
                  <div className="mt-4 grid grid-cols-1 gap-4 border-t border-agent-border pt-4 md:grid-cols-3">
                    <div>
                      <span className="mb-1 block text-[10px] uppercase text-gray-500">Funding Tx</span>
                      <span className="break-all text-xs font-mono text-gray-300">
                        {agreement.ckbTxHashFund || 'Pending'}
                      </span>
                    </div>
                    <div>
                      <span className="mb-1 block text-[10px] uppercase text-gray-500">Settlement Tx</span>
                      <span className="break-all text-xs font-mono text-gray-300">
                        {agreement.ckbTxHashRelease || 'Not settled yet'}
                      </span>
                    </div>
                    <div>
                      <span className="mb-1 block text-[10px] uppercase text-gray-500">Fiber Reference</span>
                      <span className="break-all text-xs font-mono text-gray-300">
                        {agreement.fiberPaymentReference || 'Not used'}
                      </span>
                    </div>
                    {agreement.lastSettlementError ? (
                      <div className="md:col-span-3">
                        <span className="mb-1 block text-[10px] uppercase text-gray-500">Last Settlement Error</span>
                        <span className="text-xs text-rose-300">{agreement.lastSettlementError}</span>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>

            <div id="milestones" className="bg-agent-card border border-agent-border rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-white font-semibold">Milestone Journey</h2>
                  <p className="text-xs text-gray-400 mt-1">Each milestone moves from delivery to review to payout one step at a time.</p>
                </div>
                <div className="text-xs text-gray-500">{milestones.length} milestones</div>
              </div>

              <div className="space-y-3">
                {milestones.map((milestone: any) => {
                  const isCurrent = currentMilestone?.id === milestone.id;
                  const latestProof = milestone.proofs?.[0];
                  const openDispute = milestone.disputes?.find((dispute: any) => !dispute.resolvedAt);
                  const latestSettlement = milestone.settlements?.[0];
                  const milestoneInfoRequests = infoRequests.filter((request) => request.milestoneId === milestone.id);
                  const openMilestoneInfoRequests = milestoneInfoRequests.filter((request) => !request.resolved);
                  const milestoneStatusMeta = getStatusMeta(milestone.status);
                  const milestoneProgressIndex = milestones.findIndex((item: any) => item.id === milestone.id);
                  const isCompleted = ['PAID', 'REFUNDED', 'EXPIRED'].includes(milestone.status);

                  return (
                    <div
                      key={milestone.id}
                      className={`rounded-xl border p-4 ${isCurrent ? 'border-agent-accent bg-blue-950/20 shadow-[0_0_0_1px_rgba(59,130,246,0.18)]' : 'border-agent-border bg-agent-bg/60'
                        }`}
                    >
                      <div className="flex gap-4">
                        <div className="flex w-9 shrink-0 flex-col items-center">
                          <div className={`flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold ${isCurrent
                            ? 'border-agent-accent bg-agent-accent/15 text-agent-accent'
                            : isCompleted
                              ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                              : 'border-agent-border bg-agent-card/80 text-gray-300'
                            }`}>
                            {milestone.sortOrder}
                          </div>
                          {milestoneProgressIndex < milestones.length - 1 ? (
                            <div className={`mt-2 h-full min-h-10 w-px ${isCompleted ? 'bg-emerald-500/40' : 'bg-agent-border'
                              }`} />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-3 flex items-start justify-between gap-4">
                            <div>
                              <div className="mb-1 flex items-center gap-2">
                                <span className="text-xs uppercase tracking-wide text-gray-500">
                                  Milestone {milestone.sortOrder}
                                </span>
                                {isCurrent ? (
                                  <span className="rounded-full bg-agent-accent/20 px-2 py-0.5 text-[10px] text-agent-accent">
                                    Current checkpoint
                                  </span>
                                ) : null}
                              </div>
                              <h3 className="text-white font-semibold">{milestone.title}</h3>
                              <p className="mt-1 text-xs text-gray-500">{getMilestonePhaseLabel(milestone.status)}</p>
                            </div>
                            <div className="text-right">
                              <StatusBadge status={milestone.status} />
                              <div className="mt-1 text-xs font-mono text-gray-400">{shannonsToCKB(milestone.amount)} CKB</div>
                            </div>
                          </div>

                          <p className="mb-3 text-sm text-gray-400">{milestone.description}</p>

                          <div className="mb-3 grid gap-2 text-xs text-gray-500 md:grid-cols-2 xl:grid-cols-4">
                            <span>Phase: {milestoneStatusMeta.label}</span>
                            <span>Proofs: {milestone.proofs?.length || 0}</span>
                            <span>Disputes: {milestone.disputes?.length || 0}</span>
                            <span>Settlements: {milestone.settlements?.length || 0}</span>
                          </div>

                          {isUsdEquivalentGrant && milestone.targetUsd ? (
                            <div className="mb-3 rounded-lg border border-agent-border bg-agent-card/60 px-3 py-2 text-xs text-gray-300">
                              <div>Canonical USD target: ${milestone.targetUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
                              {milestone.releasedCkbAmount ? (
                                <div className="mt-1 text-gray-400">
                                  Released: {shannonsToCKB(milestone.releasedCkbAmount)} CKB
                                  {milestone.releasedUsdValue ? ` · satisfied ${milestone.releasedUsdValue.toLocaleString('en-US', { maximumFractionDigits: 2 })} USD-equivalent` : ''}
                                  {milestone.releaseQuoteUsdPerCkb ? ` · quote $${milestone.releaseQuoteUsdPerCkb.toFixed(6)}/CKB` : ''}
                                </div>
                              ) : (
                                <div className="mt-1 text-gray-400">CKB payout amount is determined at release time using a fresh quote.</div>
                              )}
                            </div>
                          ) : null}

                          {milestoneInfoRequests.length ? (
                            <div className="mb-3 rounded-lg border border-agent-border bg-agent-card/60 px-3 py-2 text-xs text-gray-300">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span>
                                  Info requests: {milestoneInfoRequests.length}
                                </span>
                                <span className={openMilestoneInfoRequests.length ? 'text-amber-300' : 'text-emerald-300'}>
                                  {openMilestoneInfoRequests.length ? `${openMilestoneInfoRequests.length} open` : 'All answered'}
                                </span>
                              </div>
                              {milestoneInfoRequests[0]?.questions?.length ? (
                                <p className="mt-2 text-xs text-gray-400">
                                  Latest request: {milestoneInfoRequests[0].questions[0]}
                                </p>
                              ) : null}
                            </div>
                          ) : null}

                          {(latestProof || latestSettlement) ? (
                            <div className="rounded-lg border border-agent-border bg-agent-card/60 px-3 py-2 text-xs text-gray-400">
                              {latestProof ? <div>Latest proof submitted {new Date(latestProof.submittedAt).toLocaleString()}</div> : null}
                              {latestSettlement ? (
                                <div>
                                  Latest settlement {latestSettlement.direction.toLowerCase()} is {getStatusMeta(latestSettlement.status).label.toLowerCase()}.
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {openDispute ? (
                            <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2 text-xs text-red-200">
                              Open dispute: {openDispute.reason}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div id="timeline">
              <CollapsibleSection
              title="Unified Lifecycle Timeline"
              description="Funding attempts, audit actions, participant messages, amendments, and dispute activity are merged here so the agreement reads like one continuous operating record."
              countLabel={`${operationalTimeline.length} items`}
              storageKey={`agreement:${id}:section:timeline`}
            >
              <div className="overflow-hidden rounded-2xl border border-agent-border bg-agent-card shadow-[0_18px_50px_rgba(15,23,42,0.18)]">
                <div className="border-b border-agent-border bg-gradient-to-r from-agent-bg/95 via-agent-card to-agent-bg/90 p-6">
                  <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
                    <div className="max-w-2xl">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">Operational History</div>
                      <h2 className="mt-2 text-xl font-semibold text-white">Unified lifecycle timeline</h2>
                      <p className="mt-1 text-sm text-gray-400">
                        Funding attempts, audit actions, participant messages, amendments, and dispute activity are merged here so the agreement reads like one continuous operating record.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs text-gray-400 sm:grid-cols-4 xl:min-w-[520px]">
                      <div className="rounded-2xl border border-agent-border bg-agent-bg/60 px-4 py-4 sm:px-5">
                        <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500">Timeline items</div>
                        <div className="mt-3 text-2xl font-semibold leading-none text-white">{operationalTimeline.length}</div>
                      </div>
                      <div className="rounded-2xl border border-agent-border bg-agent-bg/60 px-4 py-4 sm:px-5">
                        <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500">Settlements</div>
                        <div className="mt-3 text-2xl font-semibold leading-none text-white">{settlementHistory.length}</div>
                      </div>
                      <div className="rounded-2xl border border-agent-border bg-agent-bg/60 px-4 py-4 sm:px-5">
                        <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500">Messages</div>
                        <div className="mt-3 text-2xl font-semibold leading-none text-white">{agreement.comments?.length || 0}</div>
                      </div>
                      <div className="rounded-2xl border border-agent-border bg-agent-bg/60 px-4 py-4 sm:px-5">
                        <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500">Amendments</div>
                        <div className="mt-3 text-2xl font-semibold leading-none text-white">{agreement.amendments?.length || 0}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-6">
                  {operationalTimeline.length ? (
                    <div className="space-y-4">
                      {operationalTimeline.map((item, index) => (
                        <div key={item.id} className="flex gap-4">
                          <div className="flex w-9 shrink-0 flex-col items-center">
                            <div className={`h-3 w-3 rounded-full ${getLifecycleStepStyles(index === 0 ? 'current' : 'complete').dot}`} />
                            {index < operationalTimeline.length - 1 ? (
                              <div className="mt-2 h-full min-h-10 w-px bg-agent-border" />
                            ) : null}
                          </div>
                          <div className={`min-w-0 flex-1 rounded-2xl border p-4 ${item.tone}`}>
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <div className="text-[11px] uppercase tracking-[0.16em] opacity-80">{item.kind}</div>
                                <h3 className="mt-1 text-sm font-semibold text-white">{item.title}</h3>
                              </div>
                              <div className="text-xs opacity-80">{new Date(item.timestamp).toLocaleString()}</div>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-200/90">{item.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-agent-border bg-agent-bg/60 p-4 text-sm text-gray-400">
                      No unified history yet. As this agreement is funded, reviewed, commented on, amended, or disputed, the most important operational events will appear here in timestamp order.
                    </div>
                  )}
                </div>
              </div>
              </CollapsibleSection>
            </div>

            <div id="funding">
              <CollapsibleSection
              title="Settlement History"
              description="On-chain funding, payout, and refund attempts are tracked separately from workflow."
              countLabel={`${settlementHistory.length} records`}
              storageKey={`agreement:${id}:section:settlement-history`}
            >
              {settlementHistory.length ? (
                <div className="space-y-3">
                  {settlementHistory.map((settlement: any) => (
                    <div key={settlement.id} className="rounded-xl border border-agent-border bg-agent-bg/60 p-4">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={settlement.status} />
                          <StatusBadge status={settlement.direction} />
                          <NetworkBadge network={settlement.network === 'INTERNAL' ? agreement.payoutNetwork : settlement.network} />
                        </div>
                        <div className="text-xs font-mono text-gray-400">{shannonsToCKB(settlement.amount)} CKB</div>
                      </div>
                      <div className="grid grid-cols-1 gap-2 text-xs text-gray-400 md:grid-cols-2">
                        <span>
                          Milestone {settlement.milestoneId
                            ? milestones.find((milestone: any) => milestone.id === settlement.milestoneId)?.sortOrder || 'Agreement'
                            : 'Agreement'}
                        </span>
                        <span>Created {new Date(settlement.createdAt).toLocaleString()}</span>
                        <span>Confirmed {settlement.confirmedAt ? new Date(settlement.confirmedAt).toLocaleString() : 'Pending'}</span>
                        <span className="break-all">Tx {settlement.txHash || 'Not used'}</span>
                        <span className="break-all">Reference {settlement.paymentReference || 'Not used'}</span>
                      </div>
                      {settlement.errorMessage ? (
                        <p className="mt-2 text-xs text-rose-300">{settlement.errorMessage}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-agent-border bg-agent-bg/60 p-4 text-sm text-gray-400">
                  No settlement records yet. Funding, payout, refund, and split attempts will appear here as the agreement moves forward.
                </div>
              )}
              </CollapsibleSection>
            </div>

            {agreement.source ? (
              <div className="bg-agent-card border border-agent-border rounded-xl p-6">
                <div className="mb-4">
                  <h2 className="text-white font-semibold">Imported Source</h2>
                  <p className="mt-1 text-xs text-gray-400">
                    External DAO or bounty attribution and sync controls attached to this agreement.
                  </p>
                </div>
                <div className="overflow-hidden rounded-2xl border border-agent-border bg-agent-card shadow-[0_18px_50px_rgba(15,23,42,0.18)]">
                  <div className="border-b border-agent-border bg-gradient-to-r from-agent-bg/95 via-agent-card to-agent-bg/90 p-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">Imported Source</div>
                        <h2 className="mt-2 text-xl font-semibold text-white">{agreement.source.bountyTitle || agreement.source.sourceLabel}</h2>
                        <p className="mt-1 text-sm text-gray-400">
                          This agreement originated from external DAO or bounty metadata and keeps that attribution attached to every milestone and webhook event.
                        </p>
                      </div>
                      <StatusBadge status={agreement.source.sourceType} />
                    </div>
                  </div>
                  <div className="p-6">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-lg border border-agent-border bg-agent-bg/60 p-4">
                        <div className="text-xs uppercase tracking-wide text-gray-500">Source Label</div>
                        <div className="mt-2 text-sm text-white">{agreement.source.sourceLabel}</div>
                      </div>
                      <div className="rounded-lg border border-agent-border bg-agent-bg/60 p-4">
                        <div className="text-xs uppercase tracking-wide text-gray-500">Sponsor / DAO</div>
                        <div className="mt-2 text-sm text-white">{agreement.source.sponsorName || 'Not provided'}</div>
                      </div>
                      {agreement.source.sourceReferenceId ? (
                        <div className="rounded-lg border border-agent-border bg-agent-bg/60 p-4">
                          <div className="text-xs uppercase tracking-wide text-gray-500">Reference ID</div>
                          <div className="mt-2 text-sm text-white">{agreement.source.sourceReferenceId}</div>
                        </div>
                      ) : null}
                      <div className="rounded-lg border border-agent-border bg-agent-bg/60 p-4 md:col-span-2">
                        <div className="text-xs uppercase tracking-wide text-gray-500">External URL</div>
                        <a href={agreement.source.externalUrl} target="_blank" rel="noreferrer" className="mt-2 block break-all text-sm text-agent-accent hover:text-blue-300">
                          {agreement.source.externalUrl}
                        </a>
                      </div>
                      {agreement.source.forumThreadUrl ? (
                        <div className="rounded-lg border border-agent-border bg-agent-bg/60 p-4 md:col-span-2">
                          <div className="text-xs uppercase tracking-wide text-gray-500">Forum / Governance Thread</div>
                          <a href={agreement.source.forumThreadUrl} target="_blank" rel="noreferrer" className="mt-2 block break-all text-sm text-agent-accent hover:text-blue-300">
                            {agreement.source.forumThreadUrl}
                          </a>
                        </div>
                      ) : null}
                      <div className="rounded-lg border border-agent-border bg-agent-bg/60 p-4">
                        <div className="text-xs uppercase tracking-wide text-gray-500">Source Sync Status</div>
                        <div className="mt-2 flex items-center gap-2">
                          <StatusBadge status={agreement.source.syncStatus || 'READY_TO_SYNC'} />
                        </div>
                        <div className="mt-2 text-xs text-gray-400">
                          {agreement.source.lastSyncedAt
                            ? `Last synced ${new Date(agreement.source.lastSyncedAt).toLocaleString()}`
                            : 'No source sync has been run yet.'}
                        </div>
                      </div>
                      <div className="rounded-lg border border-agent-border bg-agent-bg/60 p-4">
                        <div className="text-xs uppercase tracking-wide text-gray-500">Publish Controls State</div>
                        <div className="mt-2 text-sm text-white">
                          {agreement.source.lastPublishedAt
                            ? `Published ${new Date(agreement.source.lastPublishedAt).toLocaleString()}`
                            : agreement.source.reviewedAt
                              ? `Reviewed ${new Date(agreement.source.reviewedAt).toLocaleString()}`
                              : agreement.source.draftUpdate
                                ? 'Draft update prepared'
                                : 'No drafted or published source update yet'}
                        </div>
                        {agreement.source.lastPublishedUrl ? (
                          <a
                            href={agreement.source.lastPublishedUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 block break-all text-xs text-agent-accent hover:text-blue-300"
                          >
                            {agreement.source.lastPublishedUrl}
                          </a>
                        ) : null}
                        {agreement.source.reviewedByAddress ? (
                          <div className="mt-2 text-xs text-gray-400 break-all">
                            Reviewed by {agreement.source.reviewedByAddress}
                          </div>
                        ) : null}
                        {agreement.source.lastPublishError ? (
                          <div className="mt-2 text-xs text-rose-300">
                            Last publish error: {agreement.source.lastPublishError}
                          </div>
                        ) : null}
                      </div>
                      {agreement.source.latestSummary ? (
                        <div className="rounded-lg border border-agent-border bg-agent-bg/60 p-4 md:col-span-2">
                          <div className="text-xs uppercase tracking-wide text-gray-500">Latest Synced Activity</div>
                          <div className="mt-2 whitespace-pre-wrap text-sm text-gray-300">{agreement.source.latestSummary}</div>
                        </div>
                      ) : null}
                      {importedSourceMetadata?.parser === 'NERVOS_GRANT_THREAD_V1' ? (
                        <div className="rounded-lg border border-agent-border bg-agent-bg/60 p-4 md:col-span-2">
                          <div className="text-xs uppercase tracking-wide text-gray-500">Imported Grant Snapshot</div>
                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            <div className="rounded-lg border border-agent-border bg-slate-950/20 p-4">
                              <div className="text-xs uppercase tracking-wide text-gray-500">Requested Source Budget</div>
                              <div className="mt-2 text-sm text-white">{importedSourceMetadata.grantAmountRequested || 'Not found in source thread'}</div>
                            </div>
                            <div className="rounded-lg border border-agent-border bg-slate-950/20 p-4">
                              <div className="text-xs uppercase tracking-wide text-gray-500">ETA From Source</div>
                              <div className="mt-2 text-sm text-white">{importedSourceMetadata.etaToCompletion || 'Not found in source thread'}</div>
                            </div>
                            <div className="rounded-lg border border-agent-border bg-slate-950/20 p-4">
                              <div className="text-xs uppercase tracking-wide text-gray-500">Commencement Payment</div>
                              <div className="mt-2 text-sm text-white">
                                {[
                                  importedSourceMetadata.upfrontPayment?.label,
                                  importedSourceMetadata.upfrontPayment?.amountUsd,
                                  importedSourceMetadata.upfrontPayment?.percentage,
                                ].filter(Boolean).join(' · ') || 'No separate commencement payment parsed'}
                              </div>
                            </div>
                            <div className="rounded-lg border border-agent-border bg-slate-950/20 p-4">
                              <div className="text-xs uppercase tracking-wide text-gray-500">Funding Address In Source</div>
                              <div className="mt-2 break-all text-sm text-white">{importedSourceMetadata.fundingAddress || 'Not provided in source thread'}</div>
                            </div>
                          </div>
                          {describeMissingSourceFields(importedSourceMetadata.missingFields) ? (
                            <div className="mt-4 rounded-lg border border-amber-700/40 bg-amber-950/20 p-4 text-sm text-amber-100">
                              {describeMissingSourceFields(importedSourceMetadata.missingFields)}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {latestSourceSyncActivity ? (
                        <div className="rounded-lg border border-agent-border bg-agent-bg/60 p-4 md:col-span-2">
                          <div className="text-xs uppercase tracking-wide text-gray-500">Most Recent Source Action</div>
                          <div className="mt-2 text-sm text-white">
                            {latestSourceSyncActivity.action.replace(/_/g, ' ')}
                          </div>
                          <div className="mt-2 text-xs text-gray-400">
                            {new Date(latestSourceSyncActivity.createdAt).toLocaleString()}
                            {latestSourceSyncActivity.actorAddress ? ` · ${getParticipantLabel(latestSourceSyncActivity.actorAddress, agreement)}` : ''}
                          </div>
                          {latestSourceSyncActivity.preview ? (
                            <div className="mt-3 whitespace-pre-wrap text-sm text-gray-300">
                              {latestSourceSyncActivity.preview}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {agreement.source.draftUpdate ? (
                        <div className="rounded-lg border border-agent-border bg-agent-bg/60 p-4 md:col-span-2">
                          <div className="text-xs uppercase tracking-wide text-gray-500">Draft Update</div>
                          <div className="mt-2 whitespace-pre-wrap text-sm text-gray-300">{agreement.source.draftUpdate}</div>
                        </div>
                      ) : null}
                      {isAdmin ? (
                        <div className="rounded-lg border border-agent-border bg-agent-bg/60 p-4 md:col-span-2">
                          <div className="text-xs uppercase tracking-wide text-gray-500">Admin Source Sync Controls</div>
                          <div className="mt-4 grid gap-4 md:grid-cols-2">
                            <div>
                              <label className="text-xs uppercase tracking-wide text-gray-500">Thread URL</label>
                              <input
                                value={sourceThreadUrl}
                                onChange={(e) => setSourceThreadUrl(e.target.value)}
                                placeholder="https://forum.example.com/t/grant-update-thread"
                                className="mt-2 w-full rounded-lg border border-agent-border bg-agent-card px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-agent-accent focus:outline-none"
                              />
                              <textarea
                                value={sourceSummaryOverride}
                                onChange={(e) => setSourceSummaryOverride(e.target.value)}
                                placeholder="Optional manual summary. Leave blank to fetch the thread directly."
                                className="mt-3 min-h-[96px] w-full rounded-lg border border-agent-border bg-agent-card px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-agent-accent focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  void handleSyncSource();
                                }}
                                disabled={sourceActionLoading === 'sync'}
                                className="mt-3 rounded-lg border border-agent-accent/40 px-4 py-2 text-sm text-agent-accent hover:bg-agent-accent/10 disabled:opacity-50"
                              >
                                {sourceActionLoading === 'sync' ? 'Syncing...' : 'Sync Source Thread'}
                              </button>
                            </div>
                            <div>
                              <label className="text-xs uppercase tracking-wide text-gray-500">Draft / Publish Update</label>
                              <textarea
                                value={sourceDraftUpdate}
                                onChange={(e) => setSourceDraftUpdate(e.target.value)}
                                placeholder="Draft the update that should be published back to the source thread."
                                className="mt-2 min-h-[164px] w-full rounded-lg border border-agent-border bg-agent-card px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-agent-accent focus:outline-none"
                              />
                              <label className="mt-3 flex items-start gap-3 text-sm text-gray-200">
                                <input
                                  type="checkbox"
                                  className="mt-1"
                                  checked={sourceReviewerApproved}
                                  onChange={(e) => setSourceReviewerApproved(e.target.checked)}
                                />
                                <span>I explicitly approve this outbound source-thread update before publishing it.</span>
                              </label>
                              <div className="mt-3 flex flex-wrap gap-3">
                                <button
                                  type="button"
                                  onClick={() => {
                                    void handleDraftSourceUpdate();
                                  }}
                                  disabled={sourceActionLoading === 'draft-source' || !sourceDraftUpdate.trim()}
                                  className="rounded-lg border border-agent-border px-4 py-2 text-sm text-white hover:bg-agent-card disabled:opacity-50"
                                >
                                  {sourceActionLoading === 'draft-source' ? 'Saving Draft...' : 'Draft Update'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    void handleReviewSourceUpdate();
                                  }}
                                  disabled={sourceActionLoading === 'review-source'}
                                  className="rounded-lg border border-agent-border px-4 py-2 text-sm text-white hover:bg-agent-card disabled:opacity-50"
                                >
                                  {sourceActionLoading === 'review-source' ? 'Marking...' : 'Mark as Reviewed'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    void handlePublishSourceUpdate();
                                  }}
                                  disabled={sourceActionLoading === 'publish-source' || !sourceDraftUpdate.trim() || !sourceReviewerApproved}
                                  className="rounded-lg border border-emerald-500/40 px-4 py-2 text-sm text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-50"
                                >
                                  {sourceActionLoading === 'publish-source' ? 'Publishing...' : 'Publish Update'}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                      {agreement.source.bountyDescription ? (
                        <div className="rounded-lg border border-agent-border bg-agent-bg/60 p-4 md:col-span-2">
                          <div className="text-xs uppercase tracking-wide text-gray-500">Imported Scope</div>
                          <div className="mt-2 whitespace-pre-wrap text-sm text-gray-300">{agreement.source.bountyDescription}</div>
                        </div>
                      ) : null}
                      {agreement.source.governanceNotes ? (
                        <div className="rounded-lg border border-agent-border bg-agent-bg/60 p-4 md:col-span-2">
                          <div className="text-xs uppercase tracking-wide text-gray-500">Governance Notes</div>
                          <div className="mt-2 whitespace-pre-wrap text-sm text-gray-300">{agreement.source.governanceNotes}</div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <CollapsibleSection
              title="Audit Trail"
              description="Participant and operator actions recorded for this agreement."
              countLabel={`${auditLogs.length} entries`}
              storageKey={`agreement:${id}:section:audit-trail`}
            >
              {auditLogs.length ? (
                <div className="space-y-3">
                  {auditLogs.map((entry: any) => (
                    <div key={entry.id} className="rounded-xl border border-agent-border bg-agent-bg/60 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={entry.actorType} />
                          <span className="text-xs font-semibold text-white">{entry.action.replace(/_/g, ' ')}</span>
                        </div>
                        <span className="text-[11px] text-gray-500">{new Date(entry.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="mt-2 text-xs text-gray-400 break-all">
                        Actor {entry.actorAddress || 'system'} · {entry.resourceType} · {entry.resourceId}
                      </div>
                      {entry.metadataJson ? (
                        <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-950/40 p-3 text-[11px] text-gray-400">
                          {JSON.stringify(JSON.parse(entry.metadataJson), null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-agent-border bg-agent-bg/60 p-4 text-sm text-gray-400">
                  No audit entries yet. Agreement edits, funding confirmations, approvals, disputes, and amendments will be recorded here.
                </div>
              )}
            </CollapsibleSection>

            <CollapsibleSection
              title={isImportedGrant ? 'Reviewer Thread' : 'Agreement Thread'}
              description={
                isImportedGrant
                  ? 'Use this shared thread for direct reviewer and worker conversation about the imported grant.'
                  : 'Participant comments and coordination outside the dispute workspace.'
              }
              countLabel={`${displayedAgreementComments.length} messages`}
              storageKey={`agreement:${id}:section:agreement-thread`}
              defaultExpanded={isImportedGrant}
            >
              <div className="space-y-3">
                {displayedAgreementComments.length ? (
                  displayedAgreementComments.map((comment: any) => (
                    <div key={comment.id} className="rounded-lg border border-agent-border bg-agent-bg/60 p-4">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        <span className="rounded-full bg-slate-900/60 px-2 py-1 text-gray-300">
                          {getParticipantLabel(comment.authorAddress, agreement)}
                        </span>
                        <span>{new Date(comment.createdAt).toLocaleString()}</span>
                        {comment.optimistic ? (
                          <span className="text-emerald-300">Sending...</span>
                        ) : null}
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-gray-300">{comment.content}</p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-agent-border bg-agent-bg/60 p-4 text-sm text-gray-400">
                    {isImportedGrant
                      ? 'No reviewer-worker messages yet. Use this thread for direct conversation about the milestone work.'
                      : 'No messages yet. Use this thread for normal coordination that does not belong in the formal dispute workspace.'}
                  </div>
                )}
              </div>

              {(isClient || isWorker) && (
                <div className="mt-4">
                  <textarea
                    className="w-full bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-agent-accent min-h-[96px]"
                    placeholder={isImportedGrant ? 'Send a reviewer / worker message...' : 'Message the other participant...'}
                    value={commentContent}
                    onChange={(e) => setCommentContent(e.target.value)}
                  />
                  <button
                    onClick={handleAddComment}
                    disabled={actionLoading === 'comment' || !commentContent.trim()}
                    className="mt-3 rounded-lg border border-agent-border px-4 py-2 text-sm font-medium text-white hover:bg-agent-bg disabled:opacity-50"
                  >
                    {actionLoading === 'comment' ? 'Sending...' : 'Send Message'}
                  </button>
                </div>
              )}
            </CollapsibleSection>

            {agreement.status !== 'DRAFT' && agreement.status !== 'CANCELLED' && (
              <CollapsibleSection
                title="Amendment Proposals"
                description="Propose post-funding changes and have the counterparty accept or reject them."
                countLabel={`${agreement.amendments?.length || 0} proposals`}
                storageKey={`agreement:${id}:section:amendments`}
              >
                {(isClient || isWorker) && (
                  <div className="mb-5 rounded-lg border border-agent-border bg-agent-bg/60 p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <input
                        className="bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white"
                        value={amendmentTitle}
                        onChange={(e) => setAmendmentTitle(e.target.value)}
                        placeholder="Proposed title change (optional)"
                      />
                      <input
                        type="datetime-local"
                        className="bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white"
                        value={amendmentDeadlineAt}
                        onChange={(e) => setAmendmentDeadlineAt(e.target.value)}
                      />
                      <textarea
                        className="md:col-span-2 bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white min-h-[90px]"
                        value={amendmentDescription}
                        onChange={(e) => setAmendmentDescription(e.target.value)}
                        placeholder="Describe the proposed amendment..."
                      />
                      <textarea
                        className="md:col-span-2 bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white min-h-[80px]"
                        value={amendmentReason}
                        onChange={(e) => setAmendmentReason(e.target.value)}
                        placeholder="Why is this amendment needed?"
                      />
                    </div>
                    <button
                      onClick={handleProposeAmendment}
                      disabled={actionLoading === 'amendment'}
                      className="mt-3 rounded-lg bg-agent-accent px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-60"
                    >
                      {actionLoading === 'amendment' ? 'Submitting...' : 'Propose Amendment'}
                    </button>
                  </div>
                )}

                <div className="space-y-3">
                  {(agreement.amendments || []).map((amendment: any) => {
                    const canRespond =
                      walletAddress
                      && amendment.status === 'PROPOSED'
                      && walletAddress !== amendment.proposedBy;
                    return (
                      <div key={amendment.id} className="rounded-lg border border-agent-border bg-agent-bg/60 p-4">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <StatusBadge status={amendment.status} />
                          <span className="text-xs text-gray-400">
                            Proposed by {getParticipantLabel(amendment.proposedBy, agreement)} on {new Date(amendment.createdAt).toLocaleString()}
                          </span>
                        </div>
                        {amendment.reason ? (
                          <p className="mb-2 text-sm text-gray-300 whitespace-pre-wrap">{amendment.reason}</p>
                        ) : null}
                        <div className="grid gap-2 text-xs text-gray-400 md:grid-cols-2">
                          {amendment.title ? <span>Title: {amendment.title}</span> : null}
                          {amendment.description ? <span>Description updated</span> : null}
                          {amendment.deadlineAt ? <span>Deadline: {new Date(amendment.deadlineAt).toLocaleString()}</span> : null}
                          {amendment.releaseMode ? <span>Release mode: {amendment.releaseMode}</span> : null}
                        </div>
                        {amendment.responseNote ? (
                          <p className="mt-3 text-sm text-gray-400 whitespace-pre-wrap">{amendment.responseNote}</p>
                        ) : null}
                        {canRespond ? (
                          <div className="mt-3">
                            <textarea
                              className="w-full bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white min-h-[80px]"
                              value={amendmentResponseNote}
                              onChange={(e) => setAmendmentResponseNote(e.target.value)}
                              placeholder="Optional response note..."
                            />
                            <div className="mt-3 flex gap-3">
                              <button
                                onClick={() => handleRespondToAmendment(amendment.id, true)}
                                disabled={actionLoading === `amendment-${amendment.id}`}
                                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
                              >
                                Accept
                              </button>
                              <button
                                onClick={() => handleRespondToAmendment(amendment.id, false)}
                                disabled={actionLoading === `amendment-${amendment.id}`}
                                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </CollapsibleSection>
            )}

            {error && (
              <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            {(payoutPending || refundPending || splitPending) && (
              <div className="bg-agent-card border border-cyan-800/40 rounded-xl p-6">
                <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
                  <ClockIcon className="w-5 h-5 text-cyan-400" />
                  Settlement Confirmation In Progress
                </h3>
                <p className="text-sm text-gray-400">
                  {splitPending
                    ? 'A split settlement has been sent. The worker payout and client refund are both waiting for on-chain confirmation before the milestone moves forward.'
                    : payoutPending
                      ? 'A payout transaction has been sent and the worker is waiting for on-chain confirmation before this milestone is marked paid.'
                      : 'A refund transaction has been sent and the client is waiting for on-chain confirmation before the settlement is final.'}
                </p>
                <button
                  onClick={handleReconcile}
                  disabled={reconcileLoading}
                  className="mt-4 rounded-lg border border-cyan-600/40 px-4 py-2 text-sm font-medium text-cyan-300 transition-colors hover:bg-cyan-900/20 disabled:opacity-60"
                >
                  {reconcileLoading ? 'Rechecking...' : 'Recheck Settlement'}
                </button>
              </div>
            )}

            {agreement.settlementStatus === 'FAILED' && canReconcileSettlement && (
              <div className="bg-agent-card border border-rose-800/40 rounded-xl p-6">
                <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
                  <ExclamationTriangleIcon className="w-5 h-5 text-rose-400" />
                  Settlement Needs Attention
                </h3>
                <p className="text-sm text-gray-400">
                  The last settlement verification failed. You can request another reconciliation pass after checking the chain transaction details.
                </p>
                <button
                  onClick={handleReconcile}
                  disabled={reconcileLoading}
                  className="mt-4 rounded-lg border border-rose-600/40 px-4 py-2 text-sm font-medium text-rose-300 transition-colors hover:bg-rose-900/20 disabled:opacity-60"
                >
                  {reconcileLoading ? 'Rechecking...' : 'Recheck Settlement'}
                </button>
                <button
                  onClick={handleRetrySettlement}
                  disabled={retrySettlementLoading}
                  className="mt-3 rounded-lg border border-agent-border px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-agent-bg disabled:opacity-60"
                >
                  {retrySettlementLoading ? 'Retrying...' : 'Retry Settlement'}
                </button>
              </div>
            )}

            {agreement.status === 'DRAFT' && isClient && draftForm && (
              <div className="bg-agent-card border border-agent-border rounded-xl p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-white font-semibold">Edit Draft Before Funding</h3>
                    <p className="text-sm text-gray-400 mt-1">
                      Update the draft, reorder milestones, or cancel it before the client sends funds.
                    </p>
                  </div>
                  <button
                    onClick={handleCancelDraft}
                    disabled={actionLoading === 'cancel-draft'}
                    className="rounded-lg border border-red-700/50 px-4 py-2 text-sm text-red-300 hover:bg-red-950/20 disabled:opacity-60"
                  >
                    {actionLoading === 'cancel-draft' ? 'Cancelling...' : 'Cancel Draft'}
                  </button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <input
                      className={`w-full bg-agent-bg border rounded-lg px-4 py-2.5 text-sm text-white ${draftFieldErrors?.title ? 'border-red-500/70' : 'border-agent-border'}`}
                      value={draftForm.title}
                      onChange={(e) => setDraftForm((prev) => prev ? { ...prev, title: e.target.value } : prev)}
                      placeholder="Agreement title"
                    />
                    {draftFieldErrors?.title ? <p className="mt-1 text-xs text-red-300">{draftFieldErrors.title}</p> : null}
                  </div>
                  <div>
                    <input
                      className={`w-full bg-agent-bg border rounded-lg px-4 py-2.5 text-sm text-white ${draftFieldErrors?.workerAddress ? 'border-red-500/70' : 'border-agent-border'}`}
                      value={draftForm.workerAddress}
                      onChange={(e) => setDraftForm((prev) => prev ? { ...prev, workerAddress: e.target.value } : prev)}
                      placeholder="Worker address"
                    />
                    {draftFieldErrors?.workerAddress ? <p className="mt-1 text-xs text-red-300">{draftFieldErrors.workerAddress}</p> : null}
                  </div>
                  <div className="md:col-span-2">
                    <textarea
                      className={`w-full min-h-[100px] bg-agent-bg border rounded-lg px-4 py-2.5 text-sm text-white ${draftFieldErrors?.description ? 'border-red-500/70' : 'border-agent-border'}`}
                      value={draftForm.description}
                      onChange={(e) => setDraftForm((prev) => prev ? { ...prev, description: e.target.value } : prev)}
                      placeholder="Agreement description"
                    />
                    {draftFieldErrors?.description ? <p className="mt-1 text-xs text-red-300">{draftFieldErrors.description}</p> : null}
                  </div>
                  <div>
                    <input
                      type="datetime-local"
                      className={`w-full bg-agent-bg border rounded-lg px-4 py-2.5 text-sm text-white ${draftFieldErrors?.deadlineAt ? 'border-red-500/70' : 'border-agent-border'}`}
                      value={draftForm.deadlineAt}
                      onChange={(e) => setDraftForm((prev) => prev ? { ...prev, deadlineAt: e.target.value } : prev)}
                    />
                    {draftFieldErrors?.deadlineAt ? <p className="mt-1 text-xs text-red-300">{draftFieldErrors.deadlineAt}</p> : null}
                  </div>
                  <div>
                    <input
                      type="number"
                      className={`w-full bg-agent-bg border rounded-lg px-4 py-2.5 text-sm text-white ${draftFieldErrors?.disputeWindowHours ? 'border-red-500/70' : 'border-agent-border'}`}
                      value={draftForm.disputeWindowHours}
                      onChange={(e) => setDraftForm((prev) => prev ? { ...prev, disputeWindowHours: e.target.value } : prev)}
                      placeholder="Dispute window (hours)"
                    />
                    {draftFieldErrors?.disputeWindowHours ? <p className="mt-1 text-xs text-red-300">{draftFieldErrors.disputeWindowHours}</p> : null}
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {draftMilestones.map((milestone, index) => (
                    <div key={milestone.id || index} className="rounded-lg border border-agent-border bg-agent-bg/60 p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium text-white">Milestone {index + 1}</span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => setDraftMilestones((prev) => {
                              const next = [...prev];
                              [next[index - 1], next[index]] = [next[index], next[index - 1]];
                              return next;
                            })}
                            className="rounded-lg border border-agent-border px-3 py-1.5 text-xs text-gray-300 disabled:opacity-40"
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            disabled={index === draftMilestones.length - 1}
                            onClick={() => setDraftMilestones((prev) => {
                              const next = [...prev];
                              [next[index], next[index + 1]] = [next[index + 1], next[index]];
                              return next;
                            })}
                            className="rounded-lg border border-agent-border px-3 py-1.5 text-xs text-gray-300 disabled:opacity-40"
                          >
                            Down
                          </button>
                        </div>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <input
                            className={`w-full bg-agent-bg border rounded-lg px-4 py-2.5 text-sm text-white ${draftMilestoneErrors[index]?.title ? 'border-red-500/70' : 'border-agent-border'}`}
                            value={milestone.title}
                            onChange={(e) => setDraftMilestones((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, title: e.target.value } : item))}
                            placeholder="Milestone title"
                          />
                          {draftMilestoneErrors[index]?.title ? <p className="mt-1 text-xs text-red-300">{draftMilestoneErrors[index]?.title}</p> : null}
                        </div>
                        <div>
                          <input
                            className={`w-full bg-agent-bg border rounded-lg px-4 py-2.5 text-sm text-white ${draftMilestoneErrors[index]?.amount ? 'border-red-500/70' : 'border-agent-border'}`}
                            value={shannonsToCKB(milestone.amount)}
                            onChange={(e) => setDraftMilestones((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, amount: ckbToShannons(e.target.value || '0').toString() } : item))}
                            placeholder={`Amount in CKB (min ${draftMinimumMilestoneCkb})`}
                          />
                          {draftMilestoneErrors[index]?.amount ? (
                            <p className="mt-1 text-xs text-red-300">{draftMilestoneErrors[index]?.amount}</p>
                          ) : (
                            <p className="mt-1 text-xs text-gray-500">Minimum {draftMinimumMilestoneCkb} CKB for the current escrow setup.</p>
                          )}
                        </div>
                        <div className="md:col-span-2">
                          <textarea
                            className={`w-full min-h-[80px] bg-agent-bg border rounded-lg px-4 py-2.5 text-sm text-white ${draftMilestoneErrors[index]?.description ? 'border-red-500/70' : 'border-agent-border'}`}
                            value={milestone.description}
                            onChange={(e) => setDraftMilestones((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, description: e.target.value } : item))}
                            placeholder="Milestone description"
                          />
                          {draftMilestoneErrors[index]?.description ? <p className="mt-1 text-xs text-red-300">{draftMilestoneErrors[index]?.description}</p> : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleSaveDraft}
                  disabled={actionLoading === 'save-draft'}
                  className="mt-4 rounded-lg bg-agent-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-60"
                >
                  {actionLoading === 'save-draft' ? 'Saving Draft...' : 'Save Draft Changes'}
                </button>
              </div>
            )}

            {agreement.status === 'DRAFT' && isClient && (
              <div className="bg-agent-card border border-agent-border rounded-xl p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-white font-semibold">Invite a Worker</h3>
                    <p className="text-sm text-gray-400 mt-1">
                      Create a shareable invite link from this draft. The link is copied automatically once created.
                    </p>
                  </div>
                </div>
                {inviteFeedback ? (
                  <div className="mb-4 rounded-lg border border-emerald-800 bg-emerald-900/20 px-3 py-2 text-sm text-emerald-200">
                    {inviteFeedback}
                  </div>
                ) : null}
                <button
                  onClick={handleCreateInviteFromDraft}
                  disabled={actionLoading === 'draft-invite'}
                  className="rounded-lg border border-agent-accent/40 bg-agent-accent/10 px-4 py-2 text-sm font-medium text-agent-accent hover:bg-agent-accent/20 disabled:opacity-60"
                >
                  {actionLoading === 'draft-invite' ? 'Creating invite...' : 'Create Worker Invite Link'}
                </button>
              </div>
            )}

            {agreement.status === 'DRAFT' && isClient && (
              <div className="bg-agent-card border border-blue-800/50 rounded-xl p-6">
                <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
                  <CurrencyDollarIcon className="w-5 h-5 text-blue-400" />
                  Lock and Fund Agreement
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                  {isImportedGrant
                    ? `Lock ${currentDraftReserveLabel} as the initial reserve. Any commencement fund releases immediately after funding confirms, and later milestone payouts are quoted from the remaining reserve at release time.`
                    : `Lock ${shannonsToCKB(agreement.amount)} CKB once, then the agent will release milestone payouts as work is approved.`}
                </p>
                {isUsdEquivalentGrant && agreement.status === 'DRAFT' && liveCkbQuote ? (
                  <div className="mb-4 rounded-lg border border-emerald-800/40 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-100">
                    Live reserve recommendation refreshed at {new Date(liveCkbQuote.lastUpdatedAt || liveCkbQuote.fetchedAt).toLocaleString()} using 1 CKB = ${liveCkbQuote.priceUsd.toFixed(6)}.
                  </div>
                ) : null}
                <div className="mb-4 rounded-lg border border-agent-border bg-agent-bg/60 px-3 py-2 text-xs text-gray-400">
                  Funds will be sent to the agreement escrow destination:
                  <div className="mt-1 font-mono text-gray-300 break-all">
                    {escrowAddress || 'Escrow address not configured'}
                  </div>
                </div>
                {fundingPending && (
                  <div className="mb-4 rounded-lg border border-sky-800 bg-sky-950/20 px-3 py-2 text-xs text-sky-200">
                    Funding transaction submitted. The worker is waiting for on-chain confirmation before this agreement moves to the first milestone.
                  </div>
                )}
                {!fundingPending && hasRecordedFundingAttempt && (
                  <div className="mb-4 rounded-lg border border-amber-800 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
                    A funding transaction is already recorded for this agreement. Please wait for the server to reconcile that transaction instead of sending a second transfer.
                  </div>
                )}
                {fundingNeedsReconnect && (
                  <div className="mb-4 rounded-lg border border-yellow-800 bg-yellow-900/20 px-3 py-2 text-xs text-yellow-200">
                    Your wallet session is active, but the live signer is no longer attached. Click
                    &quot;Reconnect Wallet&quot; below to disconnect and re-establish the connection with
                    your JoyID or CKB wallet.
                  </div>
                )}
                {fundingUnsupportedSigner && (
                  <div className="mb-4 rounded-lg border border-yellow-800 bg-yellow-900/20 px-3 py-2 text-xs text-yellow-200">
                    This agreement was created from a wallet that can authenticate but cannot sign CKB funding
                    transactions. Use JoyID or an EVM wallet that supports CKB OmniLock funding as the client for
                    agreements that need funding.
                  </div>
                )}
                {isUsdEquivalentGrant && agreement.reserveHealthStatus === 'TOP_UP_REQUIRED' && (
                  <div className="mb-4 rounded-lg border border-rose-800 bg-rose-950/20 p-4 text-sm text-rose-100">
                    <div className="font-medium text-white">Reserve top-up required</div>
                    <p className="mt-2 text-sm text-rose-100/90">
                      The remaining CKB reserve is not enough to satisfy the next USD-equivalent milestone payout. Send an additional treasury funding transfer to the escrow destination, then confirm it here.
                    </p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <input
                        className="w-full rounded-lg border border-agent-border bg-agent-bg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-agent-accent"
                        value={topUpTxHash}
                        onChange={(e) => setTopUpTxHash(e.target.value)}
                        placeholder="Top-up transaction hash"
                      />
                      <input
                        className="w-full rounded-lg border border-agent-border bg-agent-bg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-agent-accent"
                        value={topUpAmountCkb}
                        onChange={(e) => setTopUpAmountCkb(e.target.value)}
                        placeholder="Top-up amount in CKB"
                      />
                    </div>
                    <button
                      onClick={handleTopUpReserve}
                      disabled={reserveTopUpLoading}
                      className="mt-4 rounded-lg bg-agent-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-60"
                    >
                      {reserveTopUpLoading ? 'Confirming top-up...' : 'Confirm Reserve Top-Up'}
                    </button>
                  </div>
                )}
                {fundingNeedsReconnect ? (
                  <button
                    onClick={handleReconnectSigner}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 sm:w-auto"
                  >
                    <LinkIcon className="w-4 h-4" />
                    Reconnect Wallet
                  </button>
                ) : (
                  <button
                    onClick={handleFund}
                    disabled={actionLoading === 'fund' || !canFundAgreement}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 sm:w-auto"
                  >
                    {actionLoading === 'fund' ? (
                      <>
                        <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                        Funding...
                      </>
                    ) : (
                      <>
                        <LinkIcon className="w-4 h-4" />
                        {fundingPending
                          ? 'Funding Awaiting Confirmation'
                          : fundingUnsupportedSigner
                            ? 'Funding Requires CKB Wallet'
                            : 'Lock Funds on CKB'}
                      </>
                    )}
                  </button>
                )}
              </div>
            )}

            <div id="review" className="scroll-mt-24" />

            {['FUNDED', 'PROOF_SUBMITTED'].includes(agreement.status) && isWorker && currentMilestone && ['ACTIVE', 'PROOF_SUBMITTED'].includes(currentMilestone.status) && (
              <div className="bg-agent-card border border-yellow-800/50 rounded-xl p-6">
                <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
                  <PaperClipIcon className="w-5 h-5 text-yellow-400" />
                  {canResubmitProofAfterInfoRequest ? 'Revise Proof for' : 'Submit Proof for'} {currentMilestone.title}
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                  {canResubmitProofAfterInfoRequest
                    ? 'A reviewer requested more information. Submit an updated proof bundle so PactAgent can re-check it against the milestone and the outstanding questions.'
                    : 'Submit a proof bundle with notes, links, files, or images for the active milestone before the agent reviews it.'}
                </p>
                <textarea
                  className="w-full bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-agent-accent mb-3 h-20 resize-none"
                  placeholder="Short proof summary..."
                  value={proofSummary}
                  onChange={(e) => setProofSummary(e.target.value)}
                />
                <textarea
                  className="w-full bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-agent-accent mb-3 h-24 resize-none"
                  placeholder="Detailed notes, delivery explanation, or acceptance context..."
                  value={proofContent}
                  onChange={(e) => setProofContent(e.target.value)}
                />
                <div className="mb-3 flex gap-2">
                  <input
                    type="url"
                    className="flex-1 bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-agent-accent"
                    placeholder="https://link-to-proof..."
                    value={proofUrlDraft}
                    onChange={(e) => setProofUrlDraft(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => appendUrlArtifact(proofUrlDraft, setProofArtifacts, () => setProofUrlDraft(''), 'Proof')}
                    className="rounded-lg border border-agent-border px-4 py-2 text-sm text-white hover:bg-agent-bg"
                  >
                    Add Link
                  </button>
                </div>
                <div className="mb-3 flex gap-2">
                  <input
                    type="text"
                    className="flex-1 bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-agent-accent"
                    placeholder="0x transaction hash..."
                    value={proofTxHashDraft}
                    onChange={(e) => setProofTxHashDraft(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => appendTxHashArtifact(proofTxHashDraft, setProofArtifacts, () => setProofTxHashDraft(''))}
                    className="rounded-lg border border-agent-border px-4 py-2 text-sm text-white hover:bg-agent-bg"
                  >
                    Add Tx Hash
                  </button>
                </div>
                <p className="mb-3 text-xs text-gray-500">
                  Add the on-chain transaction hash here when the milestone includes deploys, transfers, or payout-related proof.
                </p>
                <input
                  type="file"
                  multiple
                  className="mb-3 block w-full text-sm text-gray-300 file:mr-4 file:rounded-lg file:border-0 file:bg-agent-accent file:px-4 file:py-2 file:text-white"
                  onChange={async (e) => {
                    await appendFileArtifacts(e.target.files, setProofArtifacts);
                    e.target.value = '';
                  }}
                />
                <p className="mb-3 text-xs text-gray-500">Each uploaded image or attachment must be {MAX_ARTIFACT_SIZE_LABEL} or smaller.</p>
                <ArtifactPreviewList
                  artifacts={proofArtifacts}
                  onRemove={(artifactId) => removeArtifact(artifactId, setProofArtifacts)}
                />
                {submitAreaProofCheck ? (
                  <div className="mt-4 rounded-xl border border-agent-border bg-agent-bg/60 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-white">
                        {submitAreaProofCheck.lifecycleStatus === 'NEEDS_MORE_INFO' ? 'Outstanding checker warnings' : 'Latest checker result'}
                      </span>
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${submitAreaProofCheck.status === 'READY_FOR_HUMAN_REVIEW'
                          ? 'bg-emerald-950/40 text-emerald-300'
                          : submitAreaProofCheck.lifecycleStatus === 'NEEDS_MORE_INFO'
                            ? 'bg-orange-950/40 text-orange-300'
                            : 'bg-amber-950/40 text-amber-300'
                          }`}
                      >
                        {submitAreaProofCheck.status === 'READY_FOR_HUMAN_REVIEW'
                          ? 'Ready'
                          : submitAreaProofCheck.lifecycleStatus === 'NEEDS_MORE_INFO'
                            ? 'Waiting On Info'
                            : 'Issues Found'}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-gray-300">{submitAreaProofCheck.summary}</p>
                    {submitAreaProofCheck.warnings.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        {submitAreaProofCheck.warnings.map((warning, index) => (
                          <p key={`${warning}-${index}`} className="text-sm text-amber-100">
                            {warning}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {currentOpenInfoRequests.length > 0 ? (
                  <div className="mt-4 rounded-xl border border-orange-800/40 bg-orange-950/20 p-4">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-orange-300">Outstanding Info Requests</div>
                    <div className="mt-3 space-y-3">
                      {currentOpenInfoRequests.map((request) => (
                        <div key={request.requestId} className="rounded-lg border border-orange-800/40 bg-orange-950/10 px-3 py-3">
                          <div className="text-xs text-orange-100">{request.requestId}</div>
                          <div className="mt-2 space-y-2">
                            {request.questions.map((question, index) => (
                              <p key={`${request.requestId}-submit-${index}`} className="text-sm text-orange-50">
                                {index + 1}. {question}
                              </p>
                            ))}
                          </div>
                          {request.note ? (
                            <p className="mt-2 text-xs text-orange-100/80">Reviewer note: {request.note}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="mt-4 rounded-lg border border-agent-border bg-agent-bg/60 px-3 py-2 text-xs text-gray-400">
                  PactAgent can run a completeness check right after submission to flag missing links, transaction hashes, screenshots, or scope mismatches before the human review step.
                </div>
                <button
                  onClick={() => handleSubmitProof(currentMilestone.id)}
                  disabled={actionLoading === 'proof' || (!proofContent.trim() && !proofSummary.trim() && proofArtifacts.length === 0)}
                  className="mt-4 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  {actionLoading === 'proof' ? (
                    <>
                      <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <PaperClipIcon className="w-4 h-4" />
                      {canResubmitProofAfterInfoRequest ? 'Submit Revised Proof' : 'Submit Delivery Proof'}
                    </>
                  )}
                </button>
              </div>
            )}

            {canClientReview && currentMilestone && (
              <div className="bg-agent-card border border-emerald-800/50 rounded-xl p-6">
                <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
                  <ScaleIcon className="w-5 h-5 text-emerald-400" />
                  Review Current Milestone
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                  {agreement.escrowModel === 'ONCHAIN_LOCK'
                    ? `Sign the on-chain payout resolution for ${currentMilestone.title}.`
                    : currentMilestone.status === 'PROOF_SUBMITTED'
                      ? `The worker has submitted proof for ${currentMilestone.title}. Payout is already available while PactAgent continues the background review.`
                      : isImportedGrant
                        ? `Review ${currentMilestone.title}, message the worker for missing context when needed, and approve the payout only after manual review is complete.`
                        : `Approve payout for ${currentMilestone.title}, or open a dispute below. Refunds only happen after both client and worker agree inside the dispute thread.`}
                </p>
                <div className="mb-4">
                  <ProofCheckPanel
                    result={currentProofCheck}
                    checking={currentProofCheckLoading}
                    onCheck={() => {
                      void handleCheckProof(currentMilestone.id);
                    }}
                  />
                </div>
                {!isImportedGrant ? (
                  <div className="mb-4 rounded-xl border border-agent-border bg-agent-bg/60 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h4 className="text-sm font-semibold text-white">Request More Info</h4>
                        <p className="mt-1 text-xs text-gray-400">
                          Ask only for the missing evidence. Send a structured request here, then continue the conversation in the reviewer thread below.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void handleDraftInfoRequest(currentMilestone.id);
                        }}
                        disabled={draftInfoRequestLoading}
                        className="rounded-lg border border-agent-accent/40 px-3 py-2 text-xs font-medium text-agent-accent hover:bg-agent-accent/10 disabled:opacity-60"
                      >
                        {draftInfoRequestLoading ? 'Drafting...' : 'Suggest Questions'}
                      </button>
                    </div>
                    <textarea
                      className="mt-3 min-h-[110px] w-full rounded-lg border border-agent-border bg-agent-bg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-agent-accent"
                      placeholder="One follow-up request per line..."
                      value={followUpDraftText}
                      onChange={(e) => setFollowUpDraftText(e.target.value)}
                    />
                    {currentMilestoneInfoRequests.length ? (
                      <div className="mt-3 space-y-2">
                        {currentMilestoneInfoRequests.map((request) => (
                          <div key={request.requestId} className={`rounded-lg border px-3 py-2 ${getInfoRequestTone(request)}`}>
                            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] uppercase tracking-[0.16em]">
                              <span>{request.requestId}</span>
                              <span>{request.resolved ? 'Answered' : 'Open'}</span>
                            </div>
                            <div className="mt-2 space-y-1">
                              {request.questions.map((question, index) => (
                                <p key={`${request.requestId}-${index}`} className="text-sm">
                                  {index + 1}. {question}
                                </p>
                              ))}
                            </div>
                            {request.responsePreview ? (
                              <p className="mt-2 text-xs text-gray-300">Latest response: {request.responsePreview}</p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        void handleSendInfoRequest(currentMilestone.id);
                      }}
                      disabled={sendInfoRequestLoading || !followUpDraftText.trim()}
                      className="mt-3 rounded-lg border border-agent-border px-4 py-2 text-sm font-medium text-white hover:bg-agent-bg disabled:opacity-50"
                    >
                      {sendInfoRequestLoading ? 'Sending Request...' : 'Send Structured Request'}
                    </button>
                  </div>
                ) : currentMilestoneInfoRequests.length ? (
                  <div className="mb-4 rounded-xl border border-agent-border bg-agent-bg/60 p-4">
                    <h4 className="text-sm font-semibold text-white">Structured Review Requests</h4>
                    <p className="mt-1 text-xs text-gray-400">
                      Formal reviewer requests stay tracked here. Use the reviewer thread below for the actual conversation.
                    </p>
                    <div className="mt-3 space-y-2">
                      {currentMilestoneInfoRequests.map((request) => (
                        <div key={request.requestId} className={`rounded-lg border px-3 py-2 ${getInfoRequestTone(request)}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] uppercase tracking-[0.16em]">
                            <span>{request.requestId}</span>
                            <span>{request.resolved ? 'Answered' : 'Open'}</span>
                          </div>
                          <div className="mt-2 space-y-1">
                            {request.questions.map((question, index) => (
                              <p key={`${request.requestId}-${index}`} className="text-sm">
                                {index + 1}. {question}
                              </p>
                            ))}
                          </div>
                          {request.responsePreview ? (
                            <p className="mt-2 text-xs text-gray-300">Latest response: {request.responsePreview}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <ReviewerDecisionDraftPanel
                  reviewerDecisionNote={reviewerDecisionNote}
                  setReviewerDecisionNote={setReviewerDecisionNote}
                  humanApprovalConfirmed={humanApprovalConfirmed}
                  setHumanApprovalConfirmed={setHumanApprovalConfirmed}
                  acknowledgeProofCheck={acknowledgeProofCheck}
                  setAcknowledgeProofCheck={setAcknowledgeProofCheck}
                  acknowledgeAiSuggestion={acknowledgeAiSuggestion}
                  setAcknowledgeAiSuggestion={setAcknowledgeAiSuggestion}
                  displayedRecommendation={displayedRecommendation}
                  currentOpenInfoRequestsCount={currentOpenInfoRequests.length}
                  waitingForReview={currentMilestone.status === 'PROOF_SUBMITTED'}
                />
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <button
                    onClick={() => handleReviewAction('APPROVE')}
                    disabled={
                      !!actionLoading
                      || !humanApprovalConfirmed
                      || !reviewerDecisionNote.trim()
                      || !acknowledgeProofCheck
                      || (displayedRecommendation ? !acknowledgeAiSuggestion : false)
                    }
                    className="flex min-w-[150px] items-center justify-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {approveLoading ? (
                      <>
                        <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                        Approving...
                      </>
                    ) : (
                      <>
                        <CheckCircleIcon className="w-4 h-4" />
                        {agreement.escrowModel === 'ONCHAIN_LOCK' ? 'Sign Milestone Payout Transaction' : 'Approve Milestone Payout'}
                      </>
                    )}
                  </button>
                  {canOnchainRefundReview ? (
                    <button
                      onClick={() => handleReviewAction('REJECT')}
                      disabled={!!actionLoading}
                      className="flex min-w-[170px] items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {rejectLoading ? (
                        <>
                          <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                          Refunding...
                        </>
                      ) : (
                        <>
                          <XCircleIcon className="w-4 h-4" />
                          Sign Milestone Refund Transaction
                        </>
                      )}
                    </button>
                  ) : null}
                </div>
              </div>
            )}

            {isImportedGrant && currentMilestone && (isClient || isWorker) ? (
              <div className="bg-agent-card border border-sky-800/40 rounded-xl p-6">
                <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
                  <ClipboardDocumentCheckIcon className="w-5 h-5 text-sky-300" />
                  Reviewer Follow-up Thread
                </h3>
                <p className="text-sm text-gray-400">
                  Imported grants use this thread for direct reviewer and worker follow-up. Formal review requests stay summarized above when they exist.
                </p>
              </div>
            ) : null}

            {['FUNDED', 'PROOF_SUBMITTED', 'UNDER_REVIEW'].includes(agreement.status) && currentMilestone && !isImportedGrant && (
              <div className="bg-agent-card border border-red-800/30 rounded-xl p-6">
                <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
                  <ExclamationTriangleIcon className="w-5 h-5 text-orange-400" />
                  Open Milestone Dispute for {currentMilestone.title}
                </h3>
                <p className="mb-4 text-sm text-gray-400">
                  Use this only when proof, payout direction, or delivery quality is contested. The shared dispute thread below becomes the source of truth for both sides.
                </p>
                <textarea
                  className="w-full bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-red-500 mb-2 h-16 resize-none"
                  placeholder="Reason for dispute..."
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                />
                <textarea
                  className="w-full bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-red-500 mb-3 h-16 resize-none"
                  placeholder="Evidence notes (optional)..."
                  value={evidenceNotes}
                  onChange={(e) => setEvidenceNotes(e.target.value)}
                />
                <div className="mb-3 grid gap-3 md:grid-cols-2">
                  <select
                    className="bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-red-500"
                    value={disputeResolution}
                    onChange={(e) => setDisputeResolution(e.target.value as 'PAYOUT' | 'REFUND' | 'SPLIT')}
                  >
                    <option value="REFUND">Request Refund</option>
                    <option value="PAYOUT">Request Payout</option>
                    <option value="SPLIT">Request Split Settlement</option>
                  </select>
                  {disputeResolution === 'SPLIT' ? (
                    <div>
                      <input
                        type="number"
                        className={`w-full bg-agent-bg border rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-red-500 ${splitWorkerAmountError ? 'border-red-500/70' : 'border-agent-border'}`}
                        placeholder="Worker amount in CKB"
                        value={splitWorkerAmountCkb}
                        onChange={(e) => setSplitWorkerAmountCkb(e.target.value)}
                        min="0"
                        step="any"
                      />
                      {splitWorkerAmountError ? (
                        <p className="mt-1 text-xs text-red-300">{splitWorkerAmountError}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="mb-3 flex gap-2">
                  <input
                    type="url"
                    className="flex-1 bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-red-500"
                    placeholder="Add supporting link..."
                    value={disputeUrlDraft}
                    onChange={(e) => setDisputeUrlDraft(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => appendUrlArtifact(disputeUrlDraft, setDisputeArtifacts, () => setDisputeUrlDraft(''), 'Dispute')}
                    className="rounded-lg border border-agent-border px-4 py-2 text-sm text-white hover:bg-agent-bg"
                  >
                    Add Link
                  </button>
                </div>
                <input
                  type="file"
                  multiple
                  className="mb-3 block w-full text-sm text-gray-300 file:mr-4 file:rounded-lg file:border-0 file:bg-red-600 file:px-4 file:py-2 file:text-white"
                  onChange={async (e) => {
                    await appendFileArtifacts(e.target.files, setDisputeArtifacts);
                    e.target.value = '';
                  }}
                />
                <p className="mb-3 text-xs text-gray-500">Each uploaded image or attachment must be {MAX_ARTIFACT_SIZE_LABEL} or smaller.</p>
                <ArtifactPreviewList
                  artifacts={disputeArtifacts}
                  onRemove={(artifactId) => removeArtifact(artifactId, setDisputeArtifacts)}
                />
                <button
                  onClick={() => handleOpenDispute(currentMilestone.id)}
                  disabled={disputeLoading || !disputeReason.trim()}
                  className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg bg-red-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 sm:w-auto"
                >
                  {disputeLoading ? (
                    <>
                      <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      Opening Dispute...
                    </>
                  ) : (
                    <>
                      <ExclamationTriangleIcon className="w-4 h-4" />
                      Open Milestone Dispute
                    </>
                  )}
                </button>
              </div>
            )}

            {agreement.status === 'DISPUTED' && currentMilestone && currentOpenDispute && !isImportedGrant && (
              <div className="bg-agent-card border border-purple-800/50 rounded-xl p-6">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
                      <ScaleIcon className="w-5 h-5 text-purple-400" />
                      Dispute Conversation for {currentMilestone.title}
                    </h3>
                    <p className="text-sm text-gray-400">
                      Both participants can reply here. {wsConnected ? 'New replies appear automatically while this page is open.' : 'Reconnect to live updates to see new replies automatically.'}
                    </p>
                    {disputeWorkspaceState ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                        <StatusBadge status={disputeWorkspaceState.stage} />
                        {disputeWorkspaceState.responseDeadlineAt ? (
                          <span>Response deadline {new Date(disputeWorkspaceState.responseDeadlineAt).toLocaleString()}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <span
                    className={`rounded-full border px-3 py-1 text-[11px] font-medium ${wsConnected
                      ? 'border-emerald-800/40 bg-emerald-950/40 text-emerald-300'
                      : 'border-white/10 bg-slate-900/60 text-gray-300'
                      }`}
                  >
                    {wsConnected ? 'Live updates on' : 'Live updates off'}
                  </span>
                </div>

                <div className="mb-5 rounded-lg border border-red-900/50 bg-red-950/20 p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                    <span className="rounded-full bg-red-950/40 px-2 py-1 text-red-200">
                      {disputeOpenedByLabel} opened this dispute
                    </span>
                    <span>{new Date(currentOpenDispute.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="text-sm font-medium text-white whitespace-pre-wrap">{currentOpenDispute.reason}</p>
                  {currentOpenDispute.evidenceNotes ? (
                    <p className="mt-3 text-sm text-gray-300 whitespace-pre-wrap">
                      {currentOpenDispute.evidenceNotes}
                    </p>
                  ) : null}
                  {openerEvidenceBundle?.desiredResolution ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-300">
                      <span className="rounded-full bg-red-950/40 px-2 py-1 text-red-200">
                        Requested {openerEvidenceBundle.desiredResolution.replace(/_/g, ' ')}
                      </span>
                      {openerEvidenceBundle.desiredResolution === 'SPLIT' && openerEvidenceBundle.splitWorkerAmount ? (
                        <span>Worker amount {shannonsToCKB(openerEvidenceBundle.splitWorkerAmount)} CKB</span>
                      ) : null}
                    </div>
                  ) : null}
                  {openerEvidenceBundle?.artifacts?.length ? (
                    <div className="mt-3">
                      <ArtifactPreviewList artifacts={openerEvidenceBundle.artifacts} />
                    </div>
                  ) : null}
                </div>

                {agreement.escrowModel === 'TREASURY_BRIDGE' && (isClient || isWorker) && (
                  <div className="mb-5 grid gap-4 lg:grid-cols-2">
                    <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-4">
                      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-medium text-white">Mutual Refund Settlement</h4>
                          <p className="mt-1 text-xs text-gray-400">{mutualRefundStatusText}</p>
                        </div>
                        <button
                          onClick={handleApproveMutualRefund}
                          disabled={mutualRefundLoading || (!canProposeMutualRefund && !canAcceptMutualRefund)}
                          className="w-full rounded-lg border border-amber-600/40 px-4 py-2 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-900/30 disabled:opacity-50 sm:w-auto"
                        >
                          {mutualRefundLoading ? 'Saving...' : mutualRefundActionLabel}
                        </button>
                      </div>

                      {refundConsensus?.proposedBy ? (
                        <div className="grid gap-2 text-xs text-gray-300 sm:grid-cols-3">
                          <span>
                            Proposed by {getParticipantLabel(refundConsensus.proposedBy, agreement)}
                          </span>
                          <span>
                            Client {refundConsensus.clientApprovedAt ? 'approved' : 'pending'}
                          </span>
                          <span>
                            Worker {refundConsensus.workerApprovedAt ? 'approved' : 'pending'}
                          </span>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400">
                          {isClient
                            ? 'Use this only when both sides agree that the milestone should be refunded instead of paid out.'
                            : 'Wait for the client to propose the refund. Once they do, you can accept it here.'}
                        </p>
                      )}
                    </div>

                    <div className="rounded-lg border border-cyan-800/40 bg-cyan-950/20 p-4">
                      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-medium text-white">Split Settlement</h4>
                          <p className="mt-1 text-xs text-gray-400">{splitSettlementStatusText}</p>
                        </div>
                        <button
                          onClick={handleSplitSettlement}
                          disabled={splitLoading || (!canProposeSplitSettlement && !canAcceptSplitSettlement)}
                          className="w-full rounded-lg border border-cyan-600/40 px-4 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-900/30 disabled:opacity-50 sm:w-auto"
                        >
                          {splitLoading ? 'Saving...' : splitSettlementActionLabel}
                        </button>
                      </div>

                      {canProposeSplitSettlement ? (
                        <div className="mb-3">
                          <input
                            type="number"
                            className={`w-full bg-agent-bg border rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 ${splitWorkerAmountError ? 'border-red-500/70' : 'border-agent-border'}`}
                            placeholder="Worker amount in CKB"
                            value={splitWorkerAmountCkb}
                            onChange={(e) => setSplitWorkerAmountCkb(e.target.value)}
                            min="0"
                            step="any"
                          />
                          {splitWorkerAmountError ? (
                            <p className="mt-1 text-xs text-red-300">{splitWorkerAmountError}</p>
                          ) : null}
                        </div>
                      ) : null}

                      {splitConsensus?.proposedBy ? (
                        <div className="grid gap-2 text-xs text-gray-300 sm:grid-cols-3">
                          <span>Worker gets {splitConsensus.workerAmount ? `${shannonsToCKB(splitConsensus.workerAmount)} CKB` : 'Pending'}</span>
                          <span>Client gets {splitConsensus.clientRefundAmount ? `${shannonsToCKB(splitConsensus.clientRefundAmount)} CKB` : 'Pending'}</span>
                          <span>{splitConsensus.awaitingAddress ? `Waiting on ${getParticipantLabel(splitConsensus.awaitingAddress, agreement)}` : 'Ready'}</span>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400">
                          {isClient
                            ? 'Propose a partial payout amount for the worker. The remainder is refunded to the client after the worker accepts.'
                            : 'Wait for the client to propose a split amount. You can accept it here afterwards.'}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div className="mb-5 rounded-lg border border-agent-border bg-agent-bg/60 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-medium text-white">Replies</h4>
                      <p className="text-xs text-gray-500">This thread is where the client and worker answer each other.</p>
                    </div>
                    <span className="text-xs text-gray-500">
                      {disputeReplyCount} {disputeReplyCount === 1 ? 'reply' : 'replies'}
                    </span>
                  </div>

                  {displayedDisputeReplies.length ? (
                    <div className="mb-4 space-y-3">
                      {displayedDisputeReplies.map((entry: any) => {
                        const entryLabel = getParticipantLabel(entry.submittedBy, agreement);
                        const isPendingReply = Boolean(entry.optimistic);
                        const parsedEntry = parseDisputeEvidenceBundle(entry.content);

                        return (
                          <div
                            key={entry.id}
                            className={`rounded-lg border border-white/5 bg-slate-950/30 px-3 py-3 ${isPendingReply ? 'opacity-80' : ''
                              }`}
                          >
                            <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-gray-500">
                              <span
                                className={`rounded-full px-2 py-1 ${entryLabel === 'Client'
                                  ? 'bg-blue-950/40 text-blue-300'
                                  : entryLabel === 'Worker'
                                    ? 'bg-amber-950/40 text-amber-300'
                                    : 'bg-slate-900/60 text-gray-300'
                                  }`}
                              >
                                {entryLabel} reply
                              </span>
                              <span>{new Date(entry.createdAt).toLocaleString()}</span>
                              {isPendingReply ? (
                                <span className="text-emerald-300">Sending...</span>
                              ) : null}
                            </div>
                            <p className="text-sm text-gray-300 whitespace-pre-wrap">
                              {parsedEntry.message || entry.content}
                            </p>
                            {parsedEntry.desiredResolution ? (
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                                <span className="rounded-full bg-slate-900/60 px-2 py-1">
                                  {parsedEntry.desiredResolution}
                                </span>
                                {parsedEntry.desiredResolution === 'SPLIT' && parsedEntry.splitWorkerAmount ? (
                                  <span>Worker amount {shannonsToCKB(parsedEntry.splitWorkerAmount)} CKB</span>
                                ) : null}
                              </div>
                            ) : null}
                            {parsedEntry.artifacts.length ? (
                              <div className="mt-3">
                                <ArtifactPreviewList artifacts={parsedEntry.artifacts} />
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mb-4 text-sm text-gray-500">
                      No one has replied yet. The worker can answer the client dispute here, and the client can respond back in the same thread.
                    </p>
                  )}

                  {canReplyToDispute && (
                    <>
                      <label className="mb-2 block text-sm font-medium text-white">
                        {isWorker ? 'Worker Reply' : isClient ? 'Client Reply' : 'Reply'}
                      </label>
                      <textarea
                        className="w-full bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 mb-2 h-24 resize-none"
                        placeholder={replyPlaceholder}
                        value={additionalEvidence}
                        onChange={(e) => setAdditionalEvidence(e.target.value)}
                      />
                      <div className="mb-3 flex gap-2">
                        <input
                          type="url"
                          className="flex-1 bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                          placeholder="Add supporting link..."
                          value={replyUrlDraft}
                          onChange={(e) => setReplyUrlDraft(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => appendUrlArtifact(replyUrlDraft, setReplyArtifacts, () => setReplyUrlDraft(''), 'Reply')}
                          className="rounded-lg border border-agent-border px-4 py-2 text-sm text-white hover:bg-agent-bg"
                        >
                          Add Link
                        </button>
                      </div>
                      <input
                        type="file"
                        multiple
                        className="mb-3 block w-full text-sm text-gray-300 file:mr-4 file:rounded-lg file:border-0 file:bg-purple-600 file:px-4 file:py-2 file:text-white"
                        onChange={async (e) => {
                          await appendFileArtifacts(e.target.files, setReplyArtifacts);
                          e.target.value = '';
                        }}
                      />
                      <p className="mb-3 text-xs text-gray-500">Each uploaded image or attachment must be {MAX_ARTIFACT_SIZE_LABEL} or smaller.</p>
                      <ArtifactPreviewList
                        artifacts={replyArtifacts}
                        onRemove={(artifactId) => removeArtifact(artifactId, setReplyArtifacts)}
                      />
                      <p className="mb-3 text-xs text-gray-500">{replyHelpText}</p>
                      <button
                        onClick={handleSubmitDisputeEvidence}
                        disabled={!additionalEvidence.trim() && replyArtifacts.length === 0}
                        className="w-full rounded-lg border border-purple-600/40 px-4 py-2 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-900/20 disabled:opacity-50 sm:w-auto"
                      >
                        Send Reply
                      </button>
                    </>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                    <AgentIcon className="w-4 h-4 text-purple-400" />
                    AI Recommendation
                  </h4>

                  {displayedRecommendation ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <span className="rounded-full bg-purple-950/40 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-purple-300">
                          Suggested only
                        </span>
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-bold ${displayedRecommendation.recommendation === 'APPROVE_PAYOUT'
                            ? 'bg-green-900/50 text-green-300'
                            : displayedRecommendation.recommendation === 'REFUND_CLIENT'
                              ? 'bg-red-900/50 text-red-300'
                              : displayedRecommendation.recommendation === 'REQUEST_MORE_EVIDENCE'
                                ? 'bg-yellow-900/50 text-yellow-300'
                                : 'bg-purple-900/50 text-purple-300'
                            }`}
                        >
                          {displayedRecommendation.recommendation.replace(/_/g, ' ')}
                        </span>
                        <span className="text-xs text-gray-400">Confidence: {displayedRecommendation.confidence}%</span>
                      </div>
                      <p className="text-sm text-gray-300">{displayedRecommendation.summary}</p>
                      <p className="text-xs text-gray-400 italic">{displayedRecommendation.rationale}</p>
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-600">
                        <ClockIcon className="w-3 h-3" />
                        Suggested output only. A human reviewer still decides payout, and refunds still need both client and worker to agree.
                      </div>
                    </div>
                  ) : recommendationAvailability && !recommendationAvailability.ready ? (
                    <div className="rounded-lg border border-purple-900/40 bg-purple-950/20 px-4 py-3">
                      <p className="text-sm text-gray-300">{recommendationWaitMessage}</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-gray-400 mb-4">
                        Generate a recommendation for the disputed milestone now that the response step is complete.
                      </p>
                      <button
                        onClick={handleGetRecommendation}
                        disabled={actionLoading === 'recommend'}
                        className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2"
                      >
                        {actionLoading === 'recommend' ? (
                          <>
                            <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                            Analyzing...
                          </>
                        ) : (
                          <>
                            <AgentIcon className="w-4 h-4" />
                            Get Recommendation
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {displayedRecommendation ? (
                    <div className="mt-4">
                      <button
                        onClick={handleGetRecommendation}
                        disabled={actionLoading === 'recommend'}
                        className="rounded-lg border border-purple-600/40 px-4 py-2 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-900/20 disabled:opacity-50"
                      >
                        {actionLoading === 'recommend' ? 'Re-analyzing...' : 'Regenerate Recommendation'}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            {milestones.some((milestone: any) => (milestone.proofs?.length || 0) > 0) && (
              <div className="bg-agent-card border border-agent-border rounded-xl p-6">
                <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <ClipboardDocumentCheckIcon className="w-5 h-5 text-gray-400" />
                  Submitted Proofs
                </h3>
                <div className="space-y-3">
                  {milestones.flatMap((milestone: any) =>
                    (milestone.proofs || []).map((proof: any) => {
                      const parsedProof = parseProofBundle(proof.content);
                      const proofCheck = proofChecksByMilestone[milestone.id] || null;
                      const canRecheckPassedMilestone = !['APPROVED', 'PAID', 'REFUNDED', 'EXPIRED', 'CANCELLED'].includes(milestone.status);
                      return (
                        <div key={proof.id} className="bg-agent-bg rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-xs text-gray-500">Milestone {milestone.sortOrder}</span>
                            <span className="text-xs text-gray-300">{milestone.title}</span>
                            <span className="rounded-full bg-slate-900/60 px-2 py-0.5 text-[10px] text-slate-300">
                              Revision {parsedProof.revision}
                            </span>
                            <span className="text-[10px] text-gray-600">{new Date(proof.submittedAt).toLocaleString()}</span>
                          </div>
                          {parsedProof.summary ? (
                            <p className="text-sm font-medium text-white">{parsedProof.summary}</p>
                          ) : null}
                          {parsedProof.primaryText ? (
                            <p className="mt-2 text-sm text-gray-300 whitespace-pre-wrap break-all">{parsedProof.primaryText}</p>
                          ) : null}
                          {parsedProof.artifacts.length ? (
                            <div className="mt-3">
                              <ArtifactPreviewList artifacts={parsedProof.artifacts} />
                            </div>
                          ) : null}
                          {proofCheck?.proofId === proof.id ? (
                            <div className="mt-3">
                              <ProofCheckPanel
                                result={proofCheck}
                                checking={proofCheckLoadingMilestoneId === milestone.id}
                                onCheck={() => {
                                  void handleCheckProof(milestone.id);
                                }}
                                showCheckAction={canRecheckPassedMilestone}
                              />
                            </div>
                          ) : null}
                          <p className="text-[10px] font-mono text-gray-600 mt-2">Hash: {proof.contentHash.slice(0, 20)}...</p>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {agreement.status === 'PAID' && (
              <div className="bg-green-950/20 border border-green-800/50 rounded-xl p-6 flex items-center gap-3">
                <TrophyIcon className="w-6 h-6 text-green-400" />
                <div>
                  <h3 className="text-white font-semibold">All milestones settled</h3>
                  <p className="text-sm text-gray-400">This agreement has completed all milestone payouts successfully.</p>
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-1">
            <div className="space-y-5 lg:sticky lg:top-24">
              <div className="ui-panel p-5">
                <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">Case Rail</div>
                <h2 className="mt-2 text-xl font-semibold text-white">Next move</h2>
                <p className="mt-2 text-sm text-gray-400">{nextActionSummary}</p>

                <div className="mt-4 space-y-3">
                  <div className="rounded-2xl border border-agent-border bg-agent-bg/55 p-4">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Action owner</div>
                    <div className="mt-2 text-sm font-medium text-white">{nextActionOwner.label}</div>
                    <p className="mt-2 text-xs text-gray-500">{nextActionOwner.detail}</p>
                  </div>
                  <div className="rounded-2xl border border-agent-border bg-agent-bg/55 p-4">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Current milestone</div>
                    <div className="mt-2 text-sm font-medium text-white">{currentMilestoneSummary}</div>
                    <p className="mt-2 text-xs text-gray-500">{progressSummary}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-agent-border bg-agent-bg/55 p-4">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Deadline</div>
                      <div className="mt-2 text-sm text-white">{new Date(agreement.deadlineAt).toLocaleDateString()}</div>
                    </div>
                    <div className="rounded-2xl border border-agent-border bg-agent-bg/55 p-4">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Value</div>
                      <div className="mt-2 text-sm font-mono text-white">{shannonsToCKB(agreement.amount)} CKB</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="ui-panel p-5">
                <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">Jump Links</div>
                <div className="mt-4 flex flex-col gap-2 text-sm">
                  <a href="#overview" className="app-nav-link">Overview</a>
                  <a href="#milestones" className="app-nav-link">Milestones</a>
                  <a href="#review" className="app-nav-link">Proof & Review</a>
                  <a href="#funding" className="app-nav-link">Funding & Settlement</a>
                  <a href="#timeline" className="app-nav-link">Timeline</a>
                </div>
              </div>

              <div className="ui-panel p-5">
                <div className="mb-4 flex items-center gap-2 text-white">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
                  <h2 className="text-lg font-semibold">Agent Activity</h2>
                </div>
                <p className="mb-4 text-sm text-gray-400">
                  Live operational logs for this agreement.
                </p>
                <AgentLogPanel agreementId={id} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
