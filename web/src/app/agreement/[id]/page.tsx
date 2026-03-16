'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ccc } from '@ckb-ccc/connector-react';
import { WalletConnect } from '@/components/WalletConnect';
import { NavbarMenu } from '@/components/NavbarMenu';
import { AgentLogPanel } from '@/components/AgentLogPanel';
import { StatusBadge, NetworkBadge } from '@/components/StatusBadge';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useStore } from '@/lib/store';
import { sendCapacityTransfer, shannonsToCKB, withTimeout } from '@/lib/ckb';
import * as api from '@/lib/api';
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
  const signer = ccc.useSigner();
  const walletAddress = useStore((s) => s.walletAddress);
  const authToken = useStore((s) => s.authToken);
  const updateCount = useStore((s) => s.agreementUpdateCount);

  const [agreement, setAgreement] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publicConfig, setPublicConfig] = useState<any>(null);
  const [proofContent, setProofContent] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [evidenceNotes, setEvidenceNotes] = useState('');
  const [recommendation, setRecommendation] = useState<any>(null);

  useEffect(() => {
    async function load() {
      if (!authToken) {
        setAgreement(null);
        setLoading(false);
        return;
      }

      try {
        const [agreementData, configData] = await Promise.all([
          api.fetchAgreement(id),
          api.fetchConfig(),
        ]);
        setAgreement(agreementData);
        setPublicConfig(configData);
        setError(null);
      } catch (err) {
        console.error('Failed to load agreement:', err);
        setError(err instanceof Error ? err.message : 'Failed to load agreement');
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [authToken, id, updateCount]);

  async function refreshAgreement() {
    const data = await api.fetchAgreement(id);
    setAgreement(data);
  }

  async function handleFund() {
    if (!signer) {
      setError('Connect a CCC wallet before funding this agreement');
      return;
    }

    if (!publicConfig?.treasuryAddress) {
      setError('Treasury address is not configured on the server');
      return;
    }

    setActionLoading('fund');
    setError(null);

    try {
      // Use the wallet address already stored from auth — avoids calling signer
      // methods that rely on the wallet extension background messaging which
      // can become unresponsive between navigations.
      if (!walletAddress) {
        throw new Error('Wallet session not found. Please reconnect your wallet.');
      }

      if (walletAddress !== agreement.clientAddress) {
        // Quick check using locally-known addresses before touching the signer
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
          // If the deep check timed out, the plain-string comparison already
          // failed above so the addresses definitely differ on the surface.
          if (err instanceof Error && err.message !== 'skip') throw err;
        }
      }

      const txHash = await sendCapacityTransfer({
        signer,
        fromAddress: walletAddress,
        toAddress: publicConfig.treasuryAddress,
        amount: agreement.amount,
      });

      await withTimeout(
        api.fundAgreement(id, String(txHash)),
        30_000,
        'Timed out confirming the funding with the server. The transaction may have been sent - please refresh the page.',
      );

      // Best-effort refresh; the WebSocket update will also trigger a re-fetch
      await refreshAgreement().catch(() => {});
    } catch (err) {
      console.error('[Fund] Error:', err);
      setError(err instanceof Error ? err.message : 'Funding failed');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSubmitProof(milestoneId: string) {
    if (!proofContent.trim()) {
      return;
    }

    setActionLoading('proof');
    setError(null);

    try {
      await api.submitProof(id, {
        milestoneId,
        proofType: agreement.proofType,
        content: proofContent,
      });
      setProofContent('');
      await refreshAgreement();
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

    setActionLoading('dispute');
    setError(null);

    try {
      await api.openDispute(id, {
        milestoneId,
        openedBy: walletAddress,
        reason: disputeReason,
        evidenceNotes: evidenceNotes || undefined,
      });
      setDisputeReason('');
      setEvidenceNotes('');
      setRecommendation(null);
      await refreshAgreement();
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
      const rec = await api.getDisputeRecommendation(id);
      setRecommendation(rec);
      await refreshAgreement();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get recommendation');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReviewAction(action: string) {
    if (!walletAddress) {
      return;
    }

    setActionLoading(action);
    setError(null);

    try {
      await api.reviewAction(id, action, walletAddress);
      await refreshAgreement();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review action failed');
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
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
            Viewing agreement details and taking milestone actions now requires an authenticated wallet session.
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
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        {error || 'Agreement not found'}
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
          <NavbarMenu />
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
                <div className="flex items-center gap-2">
                  <StatusBadge status={agreement.status} />
                  <NetworkBadge network={agreement.payoutNetwork} />
                </div>
              </div>

              <p className="text-sm text-gray-300 mb-6">{agreement.description}</p>

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
                  <span className="text-[10px] uppercase text-gray-500 block mb-1">Progress</span>
                  <span className="text-sm text-white">
                    {paidMilestones}/{milestones.length} milestones paid
                  </span>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-agent-border grid grid-cols-2 gap-4">
                <div>
                  <span className="text-[10px] uppercase text-gray-500 block mb-1">Client</span>
                  <span className="text-xs font-mono text-gray-300">{agreement.clientAddress.slice(0, 20)}...</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-gray-500 block mb-1">Worker</span>
                  <span className="text-xs font-mono text-gray-300">{agreement.workerAddress.slice(0, 20)}...</span>
                </div>
              </div>

              {(agreement.ckbTxHashFund || agreement.ckbTxHashRelease || agreement.fiberPaymentReference) && (
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
                </div>
              )}
            </div>

            <div className="bg-agent-card border border-agent-border rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-white font-semibold">Milestone Timeline</h2>
                  <p className="text-xs text-gray-400 mt-1">The agent processes one milestone at a time.</p>
                </div>
                <div className="text-xs text-gray-500">{milestones.length} milestones</div>
              </div>

              <div className="space-y-3">
                {milestones.map((milestone: any) => {
                  const isCurrent = currentMilestone?.id === milestone.id;
                  const latestProof = milestone.proofs?.[0];
                  const openDispute = milestone.disputes?.find((dispute: any) => !dispute.resolvedAt);

                  return (
                    <div
                      key={milestone.id}
                      className={`rounded-xl border p-4 ${
                        isCurrent ? 'border-agent-accent bg-blue-950/20' : 'border-agent-border bg-agent-bg/60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs uppercase tracking-wide text-gray-500">
                              Milestone {milestone.sortOrder}
                            </span>
                            {isCurrent && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-agent-accent/20 text-agent-accent">
                                Current
                              </span>
                            )}
                          </div>
                          <h3 className="text-white font-semibold">{milestone.title}</h3>
                        </div>
                        <div className="text-right">
                          <StatusBadge status={milestone.status} />
                          <div className="text-xs font-mono text-gray-400 mt-1">{shannonsToCKB(milestone.amount)} CKB</div>
                        </div>
                      </div>

                      <p className="text-sm text-gray-400 mb-3">{milestone.description}</p>

                      <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                        <span>Proofs: {milestone.proofs?.length || 0}</span>
                        <span>Disputes: {milestone.disputes?.length || 0}</span>
                        {latestProof && <span>Latest proof: {new Date(latestProof.submittedAt).toLocaleString()}</span>}
                      </div>

                      {openDispute && (
                        <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2 text-xs text-red-200">
                          Open dispute: {openDispute.reason}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            {agreement.status === 'DRAFT' && isClient && (
              <div className="bg-agent-card border border-blue-800/50 rounded-xl p-6">
                <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
                  <CurrencyDollarIcon className="w-5 h-5 text-blue-400" />
                  Fund Agreement
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                  Lock {shannonsToCKB(agreement.amount)} CKB once, then the agent will release milestone payouts as work is approved.
                </p>
                <div className="mb-4 rounded-lg border border-agent-border bg-agent-bg/60 px-3 py-2 text-xs text-gray-400">
                  Funds will be sent to the configured treasury wallet:
                  <div className="mt-1 font-mono text-gray-300 break-all">
                    {publicConfig?.treasuryAddress || 'Treasury not configured'}
                  </div>
                </div>
                <button
                  onClick={handleFund}
                  disabled={actionLoading === 'fund' || !signer || !publicConfig?.treasuryAddress}
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
                      Fund on CKB
                    </>
                  )}
                </button>
              </div>
            )}

            {agreement.status === 'FUNDED' && isWorker && currentMilestone?.status === 'ACTIVE' && (
              <div className="bg-agent-card border border-yellow-800/50 rounded-xl p-6">
                <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
                  <PaperClipIcon className="w-5 h-5 text-yellow-400" />
                  Submit Proof for {currentMilestone.title}
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                  Submit proof for the active milestone before the agent reviews it.
                </p>
                <textarea
                  className="w-full bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-agent-accent mb-3 h-24 resize-none"
                  placeholder={agreement.proofType === 'URL' ? 'https://...' : 'Enter proof content...'}
                  value={proofContent}
                  onChange={(e) => setProofContent(e.target.value)}
                />
                <button
                  onClick={() => handleSubmitProof(currentMilestone.id)}
                  disabled={actionLoading === 'proof' || !proofContent.trim()}
                  className="bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  {actionLoading === 'proof' ? (
                    <>
                      <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <PaperClipIcon className="w-4 h-4" />
                      Submit Proof
                    </>
                  )}
                </button>
              </div>
            )}

            {(agreement.status === 'UNDER_REVIEW' || agreement.status === 'DISPUTED') &&
              agreement.reviewerMode !== 'AUTO' &&
              isClient &&
              currentMilestone && (
                <div className="bg-agent-card border border-emerald-800/50 rounded-xl p-6">
                  <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
                    <ScaleIcon className="w-5 h-5 text-emerald-400" />
                    Review Current Milestone
                  </h3>
                  <p className="text-sm text-gray-400 mb-4">
                    Decide whether to approve payout or refund {currentMilestone.title}.
                  </p>
                  <div className="flex gap-3 flex-wrap">
                    <button
                      onClick={() => handleReviewAction('APPROVE')}
                      disabled={!!actionLoading}
                      className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5"
                    >
                      <CheckCircleIcon className="w-4 h-4" />
                      Approve Payout
                    </button>
                    <button
                      onClick={() => handleReviewAction('REJECT')}
                      disabled={!!actionLoading}
                      className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5"
                    >
                      <XCircleIcon className="w-4 h-4" />
                      Refund & Close
                    </button>
                  </div>
                </div>
              )}

            {['FUNDED', 'PROOF_SUBMITTED', 'UNDER_REVIEW'].includes(agreement.status) && currentMilestone && (
              <div className="bg-agent-card border border-red-800/30 rounded-xl p-6">
                <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
                  <ExclamationTriangleIcon className="w-5 h-5 text-orange-400" />
                  Open Dispute on {currentMilestone.title}
                </h3>
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
                <button
                  onClick={() => handleOpenDispute(currentMilestone.id)}
                  disabled={actionLoading === 'dispute' || !disputeReason.trim()}
                  className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-sm font-medium flex items-center gap-1.5"
                >
                  <ExclamationTriangleIcon className="w-4 h-4" />
                  Open Dispute
                </button>
              </div>
            )}

            {agreement.status === 'DISPUTED' && currentMilestone && (
              <div className="bg-agent-card border border-purple-800/50 rounded-xl p-6">
                <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
                  <AgentIcon className="w-5 h-5 text-purple-400" />
                  AI Recommendation for {currentMilestone.title}
                </h3>

                {recommendation ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-bold ${
                          recommendation.recommendation === 'APPROVE_PAYOUT'
                            ? 'bg-green-900/50 text-green-300'
                            : recommendation.recommendation === 'REFUND_CLIENT'
                              ? 'bg-red-900/50 text-red-300'
                              : recommendation.recommendation === 'REQUEST_MORE_EVIDENCE'
                                ? 'bg-yellow-900/50 text-yellow-300'
                                : 'bg-purple-900/50 text-purple-300'
                        }`}
                      >
                        {recommendation.recommendation.replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs text-gray-400">Confidence: {recommendation.confidence}%</span>
                    </div>
                    <p className="text-sm text-gray-300">{recommendation.summary}</p>
                    <p className="text-xs text-gray-400 italic">{recommendation.rationale}</p>
                    <div className="flex items-center gap-1.5 text-[10px] text-gray-600">
                      <ClockIcon className="w-3 h-3" />
                      Advisory only, the final action still follows your reviewer mode.
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-gray-400 mb-4">Generate a recommendation for the disputed milestone.</p>
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
                    (milestone.proofs || []).map((proof: any) => (
                      <div key={proof.id} className="bg-agent-bg rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xs text-gray-500">Milestone {milestone.sortOrder}</span>
                          <span className="text-xs text-gray-300">{milestone.title}</span>
                          <span className="text-[10px] text-gray-600">{new Date(proof.submittedAt).toLocaleString()}</span>
                        </div>
                        <p className="text-sm text-gray-300 break-all">{proof.content}</p>
                        <p className="text-[10px] font-mono text-gray-600 mt-1">Hash: {proof.contentHash.slice(0, 20)}...</p>
                      </div>
                    ))
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
