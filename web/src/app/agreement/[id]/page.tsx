'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ccc } from '@ckb-ccc/connector-react';
import { WalletConnect } from '@/components/WalletConnect';
import { NavbarMenu } from '@/components/NavbarMenu';
import { AgentLogPanel } from '@/components/AgentLogPanel';
import { StatusBadge, NetworkBadge, getStatusMeta } from '@/components/StatusBadge';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useStore } from '@/lib/store';
import {
  ckbToShannons,
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
} from '@/components/Icons';

const currentMilestoneStatuses = ['ACTIVE', 'PROOF_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'DISPUTED'];

function canSignerFundAgreement(signer: ccc.Signer | undefined) {
  return signer?.type === ccc.SignerType.CKB || signer?.type === ccc.SignerType.EVM;
}

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

type PendingDisputeReply = {
  id: string;
  submittedBy: string;
  content: string;
  createdAt: string;
  optimistic: true;
};

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
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publicConfig, setPublicConfig] = useState<any>(null);
  const [fundingStatus, setFundingStatus] = useState<string | null>(null);
  const [proofSummary, setProofSummary] = useState('');
  const [proofContent, setProofContent] = useState('');
  const [proofUrlDraft, setProofUrlDraft] = useState('');
  const [proofArtifacts, setProofArtifacts] = useState<DraftArtifact[]>([]);
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
  const [commentContent, setCommentContent] = useState('');
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
    let cancelled = false;

    async function loadAuditLogs() {
      if (!hasHydrated || !authToken) {
        if (!cancelled) {
          setAuditLogs([]);
        }
        return;
      }

      try {
        const logs = await api.fetchAgreementAuditLogs(id, 40);
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

  async function appendFileArtifacts(
    files: FileList | null,
    setter: (next: DraftArtifact[] | ((prev: DraftArtifact[]) => DraftArtifact[])) => void,
  ) {
    if (!files?.length) {
      return;
    }

    const artifacts = await readFilesAsArtifacts(files);
    setter((prev) => [...prev, ...artifacts]);
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

      // Validate minimum CKB amount before doing anything else
      if (BigInt(agreement.amount) < MIN_CELL_CAPACITY) {
        throw new Error(
          `Agreement amount is too low. CKB requires at least 61 CKB per transaction output. Current amount: ${shannonsToCKB(agreement.amount)} CKB.`,
        );
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

      if (agreement.escrowModel === 'ONCHAIN_LOCK') {
        const funding = await sendOnchainEscrowFunding({
          signer,
          agreement,
          onProgress: (step) => setFundingStatus(step),
        });
        txHash = funding.txHash;
        milestoneOutputs = funding.milestoneOutputs;
      } else {
        txHash = await sendCapacityTransfer({
          signer,
          fromAddress: walletAddress,
          toAddress: fundingAddress,
          amount: agreement.amount,
          onProgress: (step) => setFundingStatus(step),
        });
      }

      setFundingStatus('Confirming with server...');
      await withTimeout(
        api.fundAgreement(id, String(txHash), milestoneOutputs),
        30_000,
        'Timed out confirming the funding with the server. The transaction may have been sent — please refresh the page.',
      );

      setFundingStatus(null);
      await refreshAgreement().catch(() => {});
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
      setProofArtifacts([]);
      applyAgreementPayload(response);
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

    if (disputeResolution === 'SPLIT' && !splitWorkerAmountCkb.trim()) {
      setError('Enter the worker amount for the split settlement request.');
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
        const response = await api.reviewAction(id, action, walletAddress);
        applyAgreementPayload(response);
        return;
      }
      await refreshAgreement();
    } catch (err) {
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
    if (!workerAmount) {
      setError('Enter the worker amount for the split settlement.');
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

    setActionLoading('comment');
    setError(null);

    try {
      const response = await api.addAgreementComment(id, {
        authorAddress: walletAddress,
        content: commentContent,
      });
      setCommentContent('');
      applyAgreementPayload(response);
    } catch (err) {
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
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md w-full rounded-xl border border-agent-border bg-agent-card p-6 text-center">
          <h1 className="mb-2 text-xl font-semibold text-white">Agreement unavailable</h1>
          <p className="text-sm text-gray-400">
            {error || 'This agreement could not be loaded. It may not belong to the connected wallet, or it may no longer exist.'}
          </p>
        </div>
      </div>
    );
  }

  const milestones = agreement.milestones || [];
  const currentMilestone =
    milestones.find((milestone: any) => currentMilestoneStatuses.includes(milestone.status)) ||
    milestones.find((milestone: any) => milestone.status === 'PENDING') ||
    null;
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
  const awaitingHybridReview =
    agreement.reviewerMode === 'HYBRID' && currentMilestone?.status === 'PROOF_SUBMITTED';
  const canClientReview =
    isClient &&
    (agreement.reviewerMode !== 'AUTO' || agreement.status === 'DISPUTED') &&
    currentMilestone != null &&
    ['UNDER_REVIEW', 'DISPUTED'].includes(currentMilestone.status);
  const canOnchainRefundReview =
    agreement.escrowModel === 'ONCHAIN_LOCK' &&
    currentMilestone != null &&
    isWorker &&
    ['PROOF_SUBMITTED', 'UNDER_REVIEW', 'DISPUTED'].includes(currentMilestone.status);
  const fundingPending = agreement.settlementStatus === 'FUNDING_PENDING';
  const payoutPending = agreement.settlementStatus === 'PAYOUT_PENDING';
  const splitPending = agreement.settlementStatus === 'SPLIT_PENDING';
  const refundPending = agreement.settlementStatus === 'REFUND_PENDING';
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
            body: `The worker has delivered ${currentMilestone.title}. Approve the payout, reject it, or open a dispute based on the submitted proof.`,
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

  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-50 border-b border-agent-border bg-agent-card/50 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="flex min-w-0 items-center gap-2">
              <AgentIcon className="h-5 w-5 shrink-0 text-agent-accent" />
              <span className="truncate text-lg font-bold text-white">PactAgent</span>
            </Link>
            <span className="text-gray-600">/</span>
            <span className="truncate text-sm text-gray-400">{agreement.title}</span>
          </div>
          <NavbarMenu>
            <Link href="/dashboard" className="text-sm text-gray-400 transition-colors hover:text-white">
              Dashboard
            </Link>
            {isAdmin ? (
              <Link href="/admin" className="text-sm text-agent-accent transition-colors hover:text-blue-300">
                Admin
              </Link>
            ) : null}
          </NavbarMenu>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6">
        <Link
          href="/dashboard"
          className="mb-5 inline-flex items-center gap-2 text-sm text-gray-300 transition-colors hover:text-white"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-agent-card border border-agent-border rounded-xl p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h1 className="text-2xl font-bold text-white mb-1">{agreement.title}</h1>
                  <p className="text-xs font-mono text-gray-500">{agreement.id}</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <StatusBadge status={agreement.status} />
                  <StatusBadge status={agreement.settlementStatus || 'UNFUNDED'} />
                  <NetworkBadge network={agreement.payoutNetwork} />
                </div>
              </div>

              <p className="text-sm text-gray-300 mb-6">{agreement.description}</p>

              <div className="mb-6 rounded-2xl border border-agent-border bg-agent-bg/60 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">What Needs Attention</div>
                    <h2 className="mt-2 text-lg font-semibold text-white">{actionPanel.title}</h2>
                    <p className="mt-1 text-sm text-gray-400">{actionPanel.body}</p>
                  </div>
                  <div className="rounded-xl border border-agent-border bg-agent-card/70 px-4 py-3 text-sm">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Current Milestone</div>
                    <div className="mt-2 text-white">{currentMilestoneSummary}</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <span className="text-[10px] uppercase text-gray-500 block mb-1">Total Value</span>
                  <span className="text-sm font-mono text-white">{shannonsToCKB(agreement.amount)} CKB</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-gray-500 block mb-1">Deadline</span>
                  <span className="text-sm text-white">{new Date(agreement.deadlineAt).toLocaleDateString()}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-gray-500 block mb-1">Reviewer</span>
                  <span className="text-sm text-white">{agreement.reviewerMode}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-gray-500 block mb-1">Milestone Progress</span>
                  <span className="text-sm text-white">
                    {paidMilestones}/{milestones.length} milestones paid
                  </span>
                </div>
              </div>

              {(agreement.workflowStage || agreement.nextParticipantAction) && (
                <div className="mt-4 rounded-lg border border-agent-border bg-agent-bg/60 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {agreement.workflowStage ? <StatusBadge status={agreement.workflowStage} /> : null}
                    {agreement.nextParticipantAction ? (
                      <span className="text-sm text-gray-300">{agreement.nextParticipantAction}</span>
                    ) : null}
                  </div>
                </div>
              )}

              <div className={`mt-4 pt-4 border-t border-agent-border grid gap-4 ${
                agreement.payoutNetwork === 'FIBER' && agreement.workerFiberPubkey ? 'grid-cols-1 md:grid-cols-4' : 'grid-cols-3'
              }`}>
                <div>
                  <span className="text-[10px] uppercase text-gray-500 block mb-1">Client</span>
                  <span className="text-xs font-mono text-gray-300">{agreement.clientAddress.slice(0, 20)}...</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-gray-500 block mb-1">Worker</span>
                  <span className="text-xs font-mono text-gray-300">{agreement.workerAddress.slice(0, 20)}...</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-gray-500 block mb-1">Refund Rule</span>
                  <span className="text-xs text-gray-300">
                    Client and worker must both approve a refund during a dispute.
                  </span>
                </div>
                {agreement.payoutNetwork === 'FIBER' && agreement.workerFiberPubkey && (
                  <div>
                    <span className="text-[10px] uppercase text-gray-500 block mb-1">Worker Fiber Key</span>
                    <span className="text-xs font-mono text-gray-300 break-all">{agreement.workerFiberPubkey}</span>
                  </div>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-agent-border grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <span className="text-[10px] uppercase text-gray-500 block mb-1">Funding Address</span>
                  <span className="text-xs font-mono text-gray-300 break-all">
                    {escrowAddress || 'Awaiting configuration'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-gray-500 block mb-1">Agreement Digest</span>
                  <span className="text-xs font-mono text-gray-300 break-all">
                    {agreement.agreementDigest || 'Pending'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-gray-500 block mb-1">Milestone Digest</span>
                  <span className="text-xs font-mono text-gray-300 break-all">
                    {agreement.milestoneDigest || 'Pending'}
                  </span>
                </div>
                {agreement.escrowModel === 'ONCHAIN_LOCK' && (
                  <>
                    <div>
                      <span className="text-[10px] uppercase text-gray-500 block mb-1">Lock Code Hash</span>
                      <span className="text-xs font-mono text-gray-300 break-all">
                        {agreement.escrowLockCodeHash || 'Pending'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-gray-500 block mb-1">Lock Args</span>
                      <span className="text-xs font-mono text-gray-300 break-all">
                        {agreement.escrowLockArgs || 'Pending'}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {(agreement.ckbTxHashFund || agreement.ckbTxHashRelease || agreement.fiberPaymentReference || agreement.lastSettlementError) && (
                <div className="mt-4 pt-4 border-t border-agent-border grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <span className="text-[10px] uppercase text-gray-500 block mb-1">Funding Tx</span>
                    <span className="text-xs font-mono text-gray-300 break-all">
                      {agreement.ckbTxHashFund || 'Pending'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase text-gray-500 block mb-1">Settlement Tx</span>
                    <span className="text-xs font-mono text-gray-300 break-all">
                      {agreement.ckbTxHashRelease || 'Not settled yet'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase text-gray-500 block mb-1">Fiber Reference</span>
                    <span className="text-xs font-mono text-gray-300 break-all">
                      {agreement.fiberPaymentReference || 'Not used'}
                    </span>
                  </div>
                  {agreement.lastSettlementError ? (
                    <div className="md:col-span-3">
                      <span className="text-[10px] uppercase text-gray-500 block mb-1">Last Settlement Error</span>
                      <span className="text-xs text-rose-300">{agreement.lastSettlementError}</span>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            <div className="bg-agent-card border border-agent-border rounded-xl p-6">
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
                  const milestoneStatusMeta = getStatusMeta(milestone.status);
                  const milestoneProgressIndex = milestones.findIndex((item: any) => item.id === milestone.id);
                  const isCompleted = ['PAID', 'REFUNDED', 'EXPIRED'].includes(milestone.status);

                  return (
                    <div
                      key={milestone.id}
                      className={`rounded-xl border p-4 ${
                        isCurrent ? 'border-agent-accent bg-blue-950/20 shadow-[0_0_0_1px_rgba(59,130,246,0.18)]' : 'border-agent-border bg-agent-bg/60'
                      }`}
                    >
                      <div className="flex gap-4">
                        <div className="flex w-9 shrink-0 flex-col items-center">
                          <div className={`flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold ${
                            isCurrent
                              ? 'border-agent-accent bg-agent-accent/15 text-agent-accent'
                              : isCompleted
                                ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                                : 'border-agent-border bg-agent-card/80 text-gray-300'
                          }`}>
                            {milestone.sortOrder}
                          </div>
                          {milestoneProgressIndex < milestones.length - 1 ? (
                            <div className={`mt-2 h-full min-h-10 w-px ${
                              isCompleted ? 'bg-emerald-500/40' : 'bg-agent-border'
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

            <div className="bg-agent-card border border-agent-border rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-white font-semibold">Settlement History</h2>
                  <p className="text-xs text-gray-400 mt-1">On-chain funding, payout, and refund attempts are tracked separately from workflow.</p>
                </div>
                <div className="text-xs text-gray-500">{settlementHistory.length} records</div>
              </div>

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
            </div>

            {agreement.source ? (
              <div className="bg-agent-card border border-agent-border rounded-xl p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-white font-semibold">Source Attribution</h2>
                    <p className="text-xs text-gray-400 mt-1">This agreement was created from DAO or bounty source metadata.</p>
                  </div>
                  <StatusBadge status={agreement.source.sourceType} />
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-agent-border bg-agent-bg/60 p-4">
                    <div className="text-xs uppercase tracking-wide text-gray-500">Source Label</div>
                    <div className="mt-2 text-sm text-white">{agreement.source.sourceLabel}</div>
                  </div>
                  <div className="rounded-lg border border-agent-border bg-agent-bg/60 p-4">
                    <div className="text-xs uppercase tracking-wide text-gray-500">Sponsor</div>
                    <div className="mt-2 text-sm text-white">{agreement.source.sponsorName || 'Not provided'}</div>
                  </div>
                  <div className="rounded-lg border border-agent-border bg-agent-bg/60 p-4 md:col-span-2">
                    <div className="text-xs uppercase tracking-wide text-gray-500">External URL</div>
                    <a href={agreement.source.externalUrl} target="_blank" rel="noreferrer" className="mt-2 block break-all text-sm text-agent-accent hover:text-blue-300">
                      {agreement.source.externalUrl}
                    </a>
                  </div>
                  {agreement.source.governanceNotes ? (
                    <div className="rounded-lg border border-agent-border bg-agent-bg/60 p-4 md:col-span-2">
                      <div className="text-xs uppercase tracking-wide text-gray-500">Governance Notes</div>
                      <div className="mt-2 whitespace-pre-wrap text-sm text-gray-300">{agreement.source.governanceNotes}</div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="bg-agent-card border border-agent-border rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-white font-semibold">Audit Trail</h2>
                  <p className="text-xs text-gray-400 mt-1">Participant and operator actions recorded for this agreement.</p>
                </div>
                <div className="text-xs text-gray-500">{auditLogs.length} entries</div>
              </div>

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
            </div>

            <div className="bg-agent-card border border-agent-border rounded-xl p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-white font-semibold">Agreement Thread</h2>
                  <p className="text-xs text-gray-400 mt-1">Participant comments and coordination outside the dispute workspace.</p>
                </div>
                <div className="text-xs text-gray-500">{agreement.comments?.length || 0} messages</div>
              </div>

              <div className="space-y-3">
                {(agreement.comments || []).length ? (
                  (agreement.comments || []).map((comment: any) => (
                    <div key={comment.id} className="rounded-lg border border-agent-border bg-agent-bg/60 p-4">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        <span className="rounded-full bg-slate-900/60 px-2 py-1 text-gray-300">
                          {getParticipantLabel(comment.authorAddress, agreement)}
                        </span>
                        <span>{new Date(comment.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-gray-300">{comment.content}</p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-agent-border bg-agent-bg/60 p-4 text-sm text-gray-400">
                    No messages yet. Use this thread for normal coordination that does not belong in the formal dispute workspace.
                  </div>
                )}
              </div>

              {(isClient || isWorker) && (
                <div className="mt-4">
                  <textarea
                    className="w-full bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-agent-accent min-h-[96px]"
                    placeholder="Message the other participant..."
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
            </div>

            {agreement.status !== 'DRAFT' && agreement.status !== 'CANCELLED' && (
              <div className="bg-agent-card border border-agent-border rounded-xl p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-white font-semibold">Amendment Proposals</h2>
                    <p className="text-xs text-gray-400 mt-1">Propose post-funding changes and have the counterparty accept or reject them.</p>
                  </div>
                  <div className="text-xs text-gray-500">{agreement.amendments?.length || 0} proposals</div>
                </div>

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
              </div>
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
                  <input
                    className="bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white"
                    value={draftForm.title}
                    onChange={(e) => setDraftForm((prev) => prev ? { ...prev, title: e.target.value } : prev)}
                    placeholder="Agreement title"
                  />
                  <input
                    className="bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white"
                    value={draftForm.workerAddress}
                    onChange={(e) => setDraftForm((prev) => prev ? { ...prev, workerAddress: e.target.value } : prev)}
                    placeholder="Worker address"
                  />
                  <textarea
                    className="md:col-span-2 bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white min-h-[100px]"
                    value={draftForm.description}
                    onChange={(e) => setDraftForm((prev) => prev ? { ...prev, description: e.target.value } : prev)}
                    placeholder="Agreement description"
                  />
                  <input
                    type="datetime-local"
                    className="bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white"
                    value={draftForm.deadlineAt}
                    onChange={(e) => setDraftForm((prev) => prev ? { ...prev, deadlineAt: e.target.value } : prev)}
                  />
                  <input
                    type="number"
                    className="bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white"
                    value={draftForm.disputeWindowHours}
                    onChange={(e) => setDraftForm((prev) => prev ? { ...prev, disputeWindowHours: e.target.value } : prev)}
                    placeholder="Dispute window (hours)"
                  />
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
                        <input
                          className="bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white"
                          value={milestone.title}
                          onChange={(e) => setDraftMilestones((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, title: e.target.value } : item))}
                          placeholder="Milestone title"
                        />
                        <input
                          className="bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white"
                          value={shannonsToCKB(milestone.amount)}
                          onChange={(e) => setDraftMilestones((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, amount: ckbToShannons(e.target.value || '0').toString() } : item))}
                          placeholder="Amount in CKB"
                        />
                        <textarea
                          className="md:col-span-2 bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white min-h-[80px]"
                          value={milestone.description}
                          onChange={(e) => setDraftMilestones((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, description: e.target.value } : item))}
                          placeholder="Milestone description"
                        />
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
                  Lock {shannonsToCKB(agreement.amount)} CKB once, then the agent will release milestone payouts as work is approved.
                </p>
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
                {fundingNeedsReconnect ? (
                  <button
                    onClick={handleReconnectSigner}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                  >
                    <LinkIcon className="w-4 h-4" />
                    Reconnect Wallet
                  </button>
                ) : (
                  <button
                    onClick={handleFund}
                    disabled={actionLoading === 'fund' || !canFundAgreement}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
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

            {agreement.status === 'FUNDED' && isWorker && currentMilestone?.status === 'ACTIVE' && (
              <div className="bg-agent-card border border-yellow-800/50 rounded-xl p-6">
                <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
                  <PaperClipIcon className="w-5 h-5 text-yellow-400" />
                  Submit Proof for {currentMilestone.title}
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                  Submit a proof bundle with notes, links, files, or images for the active milestone before the agent reviews it.
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
                <input
                  type="file"
                  multiple
                  className="mb-3 block w-full text-sm text-gray-300 file:mr-4 file:rounded-lg file:border-0 file:bg-agent-accent file:px-4 file:py-2 file:text-white"
                  onChange={async (e) => {
                    await appendFileArtifacts(e.target.files, setProofArtifacts);
                    e.target.value = '';
                  }}
                />
                <ArtifactPreviewList
                  artifacts={proofArtifacts}
                  onRemove={(artifactId) => removeArtifact(artifactId, setProofArtifacts)}
                />
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
                      Submit Delivery Proof
                    </>
                  )}
                </button>
              </div>
            )}

            {awaitingHybridReview && currentMilestone && (
              <div className="bg-agent-card border border-yellow-800/40 rounded-xl p-6">
                <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
                  <ClockIcon className="w-5 h-5 text-yellow-400" />
                  Awaiting Agent Review
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                  {isClient
                    ? `The worker has submitted proof for ${currentMilestone.title}. In HYBRID mode, the agent checks the proof first and then your payout approval controls will appear here.`
                    : isWorker
                      ? `Your proof for ${currentMilestone.title} has been submitted. The agent is reviewing it before the client can approve payout or open a dispute.`
                      : `Proof has been submitted for ${currentMilestone.title}. The agent needs to review it before the client can take action.`}
                </p>
                <button
                  onClick={() => void refreshAgreement('refresh')}
                  disabled={refreshingStatus}
                  className="rounded-lg border border-yellow-600/40 px-4 py-2 text-sm font-medium text-yellow-300 transition-colors hover:bg-yellow-900/20 disabled:opacity-60 flex items-center gap-2"
                >
                  {refreshingStatus ? (
                    <>
                      <div className="animate-spin w-4 h-4 border-2 border-yellow-300 border-t-transparent rounded-full" />
                      Refreshing...
                    </>
                  ) : (
                    'Refresh Status'
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
                      : `Approve payout for ${currentMilestone.title}, or open a dispute below. Refunds only happen after both client and worker agree inside the dispute thread.`}
                  </p>
                  <div className="flex gap-3 flex-wrap">
                    <button
                      onClick={() => handleReviewAction('APPROVE')}
                      disabled={!!actionLoading}
                      className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 min-w-[150px] justify-center"
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
                  </div>
                </div>
              )}

            {canOnchainRefundReview && currentMilestone && (
              <div className="bg-agent-card border border-red-800/40 rounded-xl p-6">
                <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
                  <XCircleIcon className="w-5 h-5 text-red-400" />
                  Refund Current Milestone
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                  Sign the on-chain refund resolution for {currentMilestone.title}. This sends the milestone amount back to the client from the escrow cell.
                </p>
                <button
                  onClick={() => handleReviewAction('REJECT')}
                  disabled={!!actionLoading}
                  className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 min-w-[170px] justify-center"
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
              </div>
            )}

            {['FUNDED', 'PROOF_SUBMITTED', 'UNDER_REVIEW'].includes(agreement.status) && currentMilestone && (
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
                    <input
                      type="number"
                      className="bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-red-500"
                      placeholder="Worker amount in CKB"
                      value={splitWorkerAmountCkb}
                      onChange={(e) => setSplitWorkerAmountCkb(e.target.value)}
                      min="0"
                      step="any"
                    />
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
                <ArtifactPreviewList
                  artifacts={disputeArtifacts}
                  onRemove={(artifactId) => removeArtifact(artifactId, setDisputeArtifacts)}
                />
                <button
                  onClick={() => handleOpenDispute(currentMilestone.id)}
                  disabled={disputeLoading || !disputeReason.trim()}
                  className="mt-4 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-sm font-medium flex items-center gap-1.5"
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

            {agreement.status === 'DISPUTED' && currentMilestone && currentOpenDispute && (
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
                    className={`rounded-full border px-3 py-1 text-[11px] font-medium ${
                      wsConnected
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
                          className="rounded-lg border border-amber-600/40 px-4 py-2 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-900/30 disabled:opacity-50"
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
                          className="rounded-lg border border-cyan-600/40 px-4 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-900/30 disabled:opacity-50"
                        >
                          {splitLoading ? 'Saving...' : splitSettlementActionLabel}
                        </button>
                      </div>

                      {canProposeSplitSettlement ? (
                        <input
                          type="number"
                          className="mb-3 w-full bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
                          placeholder="Worker amount in CKB"
                          value={splitWorkerAmountCkb}
                          onChange={(e) => setSplitWorkerAmountCkb(e.target.value)}
                          min="0"
                          step="any"
                        />
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
                            className={`rounded-lg border border-white/5 bg-slate-950/30 px-3 py-3 ${
                              isPendingReply ? 'opacity-80' : ''
                            }`}
                          >
                            <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-gray-500">
                              <span
                                className={`rounded-full px-2 py-1 ${
                                  entryLabel === 'Client'
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
                      <ArtifactPreviewList
                        artifacts={replyArtifacts}
                        onRemove={(artifactId) => removeArtifact(artifactId, setReplyArtifacts)}
                      />
                      <p className="mb-3 text-xs text-gray-500">{replyHelpText}</p>
                      <button
                        onClick={handleSubmitDisputeEvidence}
                        disabled={!additionalEvidence.trim() && replyArtifacts.length === 0}
                        className="rounded-lg border border-purple-600/40 px-4 py-2 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-900/20 disabled:opacity-50"
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
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-bold ${
                            displayedRecommendation.recommendation === 'APPROVE_PAYOUT'
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
                        Advisory only. Payout still needs client approval, and refunds still need both client and worker to agree.
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
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Agent Activity
            </h2>
            <AgentLogPanel agreementId={id} />
          </div>
        </div>
      </div>
    </div>
  );
}
