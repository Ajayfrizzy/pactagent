'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { WalletConnect } from '@/components/WalletConnect';
import { NavbarMenu } from '@/components/NavbarMenu';
import { StatusBadge, NetworkBadge } from '@/components/StatusBadge';
import { useStore } from '@/lib/store';
import {
  fetchAgreements,
  fetchAgreementJobs,
  fetchConfig,
  fetchFiberAdminChannels,
  fetchFiberDiagnostics,
  fetchFiberAdminHealth,
  fetchFiberAdminInfo,
  replayAgreementJob,
  syncAgreementSource,
  updateAgreementSourcePublishState,
} from '@/lib/api';
import { AgentIcon, ArrowLeftIcon, ShieldCheckIcon } from '@/components/Icons';

export default function AdminPage() {
  const authToken = useStore((s) => s.authToken);
  const isAdmin = useStore((s) => s.isAdmin);
  const walletAddress = useStore((s) => s.walletAddress);
  const [agreements, setAgreements] = useState<any[]>([]);
  const [selectedAgreementId, setSelectedAgreementId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [publicConfig, setPublicConfig] = useState<any>(null);
  const [fiberHealth, setFiberHealth] = useState<any>(null);
  const [fiberInfo, setFiberInfo] = useState<any>(null);
  const [fiberChannels, setFiberChannels] = useState<any>(null);
  const [fiberDiagnostics, setFiberDiagnostics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [jobLoadingId, setJobLoadingId] = useState<string | null>(null);
  const [sourceActionLoading, setSourceActionLoading] = useState<string | null>(null);
  const [sourceThreadUrl, setSourceThreadUrl] = useState('');
  const [sourceSummaryOverride, setSourceSummaryOverride] = useState('');
  const [sourceDraftUpdate, setSourceDraftUpdate] = useState('');
  const [sourceReviewerApproved, setSourceReviewerApproved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAdminData() {
      if (!authToken || !isAdmin) {
        setLoading(false);
        return;
      }

      try {
        const [agreementList, health, info, channels, configData, diagnostics] = await Promise.all([
          fetchAgreements(),
          fetchFiberAdminHealth(),
          fetchFiberAdminInfo().catch(() => null),
          fetchFiberAdminChannels().catch(() => null),
          fetchConfig().catch(() => null),
          fetchFiberDiagnostics().catch(() => null),
        ]);

        if (cancelled) {
          return;
        }

        setAgreements(agreementList);
        setSelectedAgreementId((current) => current || agreementList[0]?.id || null);
        setFiberHealth(health);
        setFiberInfo(info);
        setFiberChannels(channels);
        setPublicConfig(configData);
        setFiberDiagnostics(diagnostics);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load admin data');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadAdminData();
    return () => {
      cancelled = true;
    };
  }, [authToken, isAdmin]);

  useEffect(() => {
    let cancelled = false;

    async function loadJobs() {
      if (!authToken || !isAdmin || !selectedAgreementId) {
        setJobs([]);
        return;
      }

      try {
        const data = await fetchAgreementJobs(selectedAgreementId, 80);
        if (!cancelled) {
          setJobs(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load agreement jobs');
        }
      }
    }

    void loadJobs();
    return () => {
      cancelled = true;
    };
  }, [authToken, isAdmin, selectedAgreementId]);

  const selectedAgreement = useMemo(
    () => agreements.find((agreement) => agreement.id === selectedAgreementId) || null,
    [agreements, selectedAgreementId],
  );
  const forumPublishEnabled = Boolean(publicConfig?.forumPublishEnabled);
  const forumPublishReady = Boolean(publicConfig?.forumPublishReady);
  const forumPublishProvider = typeof publicConfig?.forumPublishProvider === 'string'
    ? publicConfig.forumPublishProvider
    : null;
  const publishBlockedReason = !forumPublishEnabled
    ? 'Direct forum publishing is disabled on the server.'
    : !forumPublishReady
      ? `Direct forum publishing is enabled but not fully configured for ${forumPublishProvider || 'the current provider'}.`
      : !selectedAgreement?.source?.reviewedAt
        ? 'Mark the draft as reviewed before publishing it outward.'
        : !sourceReviewerApproved
          ? 'Explicitly confirm reviewer approval before publishing externally.'
        : !sourceDraftUpdate.trim()
          ? 'Add or save a draft update before publishing.'
          : null;
  const fiberStatus = fiberDiagnostics?.status || (fiberHealth?.healthy ? 'CONFIRMED' : 'FAILED');
  const fiberNodePublicKey = fiberDiagnostics?.live?.nodePublicKey || fiberInfo?.public_key || fiberInfo?.node_id || 'Unavailable';
  const fiberChannelCount = fiberDiagnostics?.live?.openChannelCount ?? fiberChannels?.count ?? 0;
  const fiberUsableOutboundCount = fiberDiagnostics?.live?.usableOutboundChannelCount ?? 0;

  useEffect(() => {
    setSourceThreadUrl(selectedAgreement?.source?.forumThreadUrl || selectedAgreement?.source?.externalUrl || '');
    setSourceSummaryOverride('');
    setSourceDraftUpdate(selectedAgreement?.source?.draftUpdate || '');
    setSourceReviewerApproved(false);
  }, [selectedAgreementId, selectedAgreement?.source?.forumThreadUrl, selectedAgreement?.source?.externalUrl, selectedAgreement?.source?.latestSummary, selectedAgreement?.source?.draftUpdate]);

  async function refreshAgreements() {
    const agreementList = await fetchAgreements();
    setAgreements(agreementList);
    return agreementList;
  }

  async function handleReplayJob(jobId: string) {
    if (!selectedAgreementId) {
      return;
    }

    setJobLoadingId(jobId);
    setError(null);

    try {
      await replayAgreementJob(selectedAgreementId, jobId);
      const refreshedJobs = await fetchAgreementJobs(selectedAgreementId, 80);
      setJobs(refreshedJobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to replay job');
    } finally {
      setJobLoadingId(null);
    }
  }

  async function handleSyncSource() {
    if (!selectedAgreementId) {
      return;
    }

    setSourceActionLoading('sync');
    setError(null);

    try {
      await syncAgreementSource(selectedAgreementId, {
        forumThreadUrl: sourceThreadUrl.trim() || undefined,
        manualSummary: sourceSummaryOverride.trim() || undefined,
      });
      await refreshAgreements();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync source thread');
    } finally {
      setSourceActionLoading(null);
    }
  }

  async function handleDraftSourceUpdate() {
    if (!selectedAgreementId || !sourceDraftUpdate.trim()) {
      return;
    }

    setSourceActionLoading('draft');
    setError(null);

    try {
      await updateAgreementSourcePublishState(selectedAgreementId, {
        action: 'DRAFT',
        content: sourceDraftUpdate.trim(),
      });
      await refreshAgreements();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save source draft update');
    } finally {
      setSourceActionLoading(null);
    }
  }

  async function handleReviewSourceUpdate() {
    if (!selectedAgreementId) {
      return;
    }

    setSourceActionLoading('review');
    setError(null);

    try {
      await updateAgreementSourcePublishState(selectedAgreementId, {
        action: 'REVIEW',
      });
      await refreshAgreements();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark source update as reviewed');
    } finally {
      setSourceActionLoading(null);
    }
  }

  async function handlePublishSourceUpdate() {
    if (!selectedAgreementId || !sourceDraftUpdate.trim()) {
      return;
    }

    if (!sourceReviewerApproved) {
      setError('Explicit reviewer approval is required before publishing a source update.');
      return;
    }

    setSourceActionLoading('publish');
    setError(null);

    try {
      await updateAgreementSourcePublishState(selectedAgreementId, {
        action: 'PUBLISH',
        content: sourceDraftUpdate.trim(),
        reviewerApproved: true,
      });
      await refreshAgreements();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish source update');
    } finally {
      setSourceActionLoading(null);
    }
  }

  if (!authToken) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md w-full bg-agent-card border border-agent-border rounded-xl p-6 text-center">
          <h1 className="text-xl font-semibold text-white mb-2">Connect your wallet to open admin tools</h1>
          <p className="text-sm text-gray-400 mb-4">Admin access is controlled by the backend admin wallet list.</p>
          <div className="flex justify-center">
            <WalletConnect />
          </div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-lg w-full bg-agent-card border border-agent-border rounded-xl p-6 text-center">
          <ShieldCheckIcon className="mx-auto mb-4 h-10 w-10 text-amber-400" />
          <h1 className="text-xl font-semibold text-white mb-2">Admin access required</h1>
          <p className="text-sm text-gray-400">
            The authenticated wallet `{walletAddress}` is not in the server `ADMIN_ADDRESSES` list.
          </p>
        </div>
      </div>
    );
  }

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
            <span className="truncate text-sm text-gray-400">Admin</span>
          </div>
          <NavbarMenu>
            <Link href="/dashboard" className="text-sm text-gray-400 transition-colors hover:text-white">
              Dashboard
            </Link>
          </NavbarMenu>
        </div>
      </nav>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Link
          href="/dashboard"
          className="mb-5 inline-flex items-center gap-2 text-sm text-gray-300 transition-colors hover:text-white"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Dashboard
        </Link>

        <div className="mb-8 rounded-2xl border border-agent-border bg-agent-card/70 p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-agent-border bg-agent-bg/70 px-3 py-1 text-xs uppercase tracking-[0.18em] text-agent-accent">
                <ShieldCheckIcon className="h-3.5 w-3.5" />
                Admin Console
              </div>
              <h1 className="text-2xl font-bold text-white">Operational Controls</h1>
              <p className="mt-2 text-sm text-gray-400">
                Monitor worker jobs, replay failed automation, and inspect Fiber admin state from one place.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <StatusBadge status={fiberStatus} />
              <NetworkBadge network="CKB" />
            </div>
          </div>
        </div>

        {error ? (
          <div className="mb-6 rounded-2xl border border-red-800 bg-red-900/30 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-2xl border border-agent-border bg-agent-card/60 py-20 text-center text-gray-400">
            Loading admin data...
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-8 xl:grid-cols-[320px_minmax(0,1fr)]">
            <section className="space-y-6">
              <div className="rounded-2xl border border-agent-border bg-agent-card/70 p-5">
                <h2 className="text-lg font-semibold text-white mb-3">Fiber Node</h2>
                <div className="space-y-2 text-sm text-gray-300">
                  <div>Healthy: {String(Boolean(fiberHealth?.healthy))}</div>
                  <div>Channels: {fiberChannelCount}</div>
                  <div>Usable Outbound Channels: {fiberUsableOutboundCount}</div>
                  <div className="break-all">Node Public Key: {fiberNodePublicKey}</div>
                </div>
              </div>

              <div className="rounded-2xl border border-agent-border bg-agent-card/70 p-5">
                <h2 className="text-lg font-semibold text-white mb-3">Fiber Diagnosis</h2>
                <div className="mb-3 flex items-center gap-2">
                  <StatusBadge status={fiberStatus} />
                </div>
                <div className="space-y-3 text-sm text-gray-300">
                  <p>{fiberDiagnostics?.summary || 'No Fiber diagnostics available yet.'}</p>
                  {fiberDiagnostics?.interpretation ? (
                    <p className="text-gray-400">{fiberDiagnostics.interpretation}</p>
                  ) : null}
                  {fiberDiagnostics?.history?.evidence?.length ? (
                    <div>
                      <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">Evidence</div>
                      <ul className="space-y-1 text-xs text-gray-400">
                        {fiberDiagnostics.history.evidence.map((item: string, index: number) => (
                          <li key={`${index}-${item}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {fiberDiagnostics ? (
                    <div className="grid gap-2 text-xs text-gray-400">
                      <div>Configured for Fiber Agreements: {fiberDiagnostics.history.agreementsConfiguredForFiber}</div>
                      <div>Confirmed Fiber Settlements: {fiberDiagnostics.history.confirmedFiberSettlements}</div>
                      <div>Fiber Payout Initiations: {fiberDiagnostics.history.attemptedFiberPayoutLogs}</div>
                      <div>Fiber Confirmation Logs: {fiberDiagnostics.history.confirmedFiberPayoutLogs}</div>
                      <div>Fallback Release Logs: {fiberDiagnostics.history.fallbackReleaseLogs}</div>
                      <div>Last Confirmed Fiber Settlement: {fiberDiagnostics.history.lastConfirmedFiberSettlementAt || 'Never'}</div>
                      <div>Last CKB Fallback: {fiberDiagnostics.history.lastFallbackAt || 'Never recorded'}</div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-agent-border bg-agent-card/70 p-5">
                <h2 className="text-lg font-semibold text-white mb-3">Agreements</h2>
                <div className="space-y-2">
                  {agreements.map((agreement) => (
                    <button
                      key={agreement.id}
                      type="button"
                      onClick={() => setSelectedAgreementId(agreement.id)}
                      className={`w-full rounded-xl border p-3 text-left transition-colors ${
                        selectedAgreementId === agreement.id
                          ? 'border-agent-accent bg-agent-accent/10'
                          : 'border-agent-border bg-agent-bg/60 hover:border-agent-accent/40'
                      }`}
                    >
                      <div className="font-medium text-white">{agreement.title}</div>
                      <div className="mt-1 text-xs text-gray-500">{agreement.id}</div>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="space-y-6">
              <div className="rounded-2xl border border-agent-border bg-agent-card/70 p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Agreement Jobs</h2>
                    <p className="text-sm text-gray-400">
                      {selectedAgreement ? `Job queue for ${selectedAgreement.title}` : 'Select an agreement to inspect jobs.'}
                    </p>
                  </div>
                  {selectedAgreement ? <StatusBadge status={selectedAgreement.status} /> : null}
                </div>

                {!selectedAgreement ? (
                  <div className="rounded-xl border border-agent-border bg-agent-bg/60 p-8 text-sm text-gray-500">
                    No agreement selected.
                  </div>
                ) : jobs.length === 0 ? (
                  <div className="rounded-xl border border-agent-border bg-agent-bg/60 p-8 text-sm text-gray-500">
                    No jobs found for this agreement yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {jobs.map((job) => (
                      <div key={job.id} className="rounded-xl border border-agent-border bg-agent-bg/60 p-4">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={job.status} />
                            <span className="text-sm font-medium text-white">{job.kind}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleReplayJob(job.id)}
                            disabled={jobLoadingId === job.id}
                            className="rounded-lg border border-agent-border px-3 py-1.5 text-xs text-white hover:bg-agent-card disabled:opacity-50"
                          >
                            {jobLoadingId === job.id ? 'Replaying...' : 'Replay'}
                          </button>
                        </div>
                        <div className="grid gap-2 text-xs text-gray-400 md:grid-cols-2">
                          <span>Attempts: {job.attempts}/{job.maxAttempts}</span>
                          <span>Available: {new Date(job.availableAt).toLocaleString()}</span>
                          <span>Locked By: {job.lockedBy || '—'}</span>
                          <span>Last Error: {job.lastError || '—'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-agent-border bg-agent-card/70 p-5">
                <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Source Sync Controls</h2>
                    <p className="text-sm text-gray-400">
                      {selectedAgreement?.source
                        ? 'Capture the source thread, refresh the latest forum summary, draft the outbound update, and require reviewer approval before publication.'
                        : 'Select an imported grant agreement to manage its source thread sync state.'}
                    </p>
                  </div>
                  {selectedAgreement?.source ? <StatusBadge status={selectedAgreement.source.syncStatus || 'READY_TO_SYNC'} /> : null}
                </div>

                {!selectedAgreement ? (
                  <div className="rounded-xl border border-agent-border bg-agent-bg/60 p-8 text-sm text-gray-500">
                    No agreement selected.
                  </div>
                ) : !selectedAgreement.source ? (
                  <div className="rounded-xl border border-agent-border bg-agent-bg/60 p-8 text-sm text-gray-500">
                    This agreement was not imported from a bounty or DAO source, so there is no source thread to sync.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className={`rounded-xl border p-4 ${
                      forumPublishReady
                        ? 'border-emerald-800/40 bg-emerald-950/20'
                        : 'border-amber-800/40 bg-amber-950/20'
                    }`}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-wide text-gray-500">Forum Publish Readiness</div>
                          <div className="mt-2 text-sm text-white">
                            {forumPublishReady
                              ? `Direct publishing is ready via ${forumPublishProvider}.`
                              : forumPublishEnabled
                                ? `Publishing is enabled but not fully configured for ${forumPublishProvider || 'the selected provider'}.`
                                : 'Direct publishing is currently disabled on the server.'}
                          </div>
                        </div>
                        <StatusBadge status={forumPublishReady ? 'CONFIRMED' : 'PENDING'} />
                      </div>
                      <div className="mt-3 text-xs text-gray-300">
                        {forumPublishReady
                          ? 'Approved updates can be posted directly from this panel.'
                          : forumPublishEnabled
                            ? 'Finish the server publish credentials first, then this panel will allow outbound posting.'
                            : 'Enable forum publishing in the server environment before using the direct publish path.'}
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-xl border border-agent-border bg-agent-bg/60 p-4">
                        <div className="text-xs uppercase tracking-wide text-gray-500">Forum Thread URL</div>
                        <input
                          value={sourceThreadUrl}
                          onChange={(e) => setSourceThreadUrl(e.target.value)}
                          placeholder="https://forum.example.com/t/grant-update-thread"
                          className="mt-3 w-full rounded-lg border border-agent-border bg-agent-card px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-agent-accent focus:outline-none"
                        />
                        <div className="mt-2 text-xs text-gray-400">
                          External source: {selectedAgreement.source.externalUrl}
                        </div>
                      </div>
                      <div className="rounded-xl border border-agent-border bg-agent-bg/60 p-4">
                        <div className="text-xs uppercase tracking-wide text-gray-500">Current Sync State</div>
                        <div className="mt-3 space-y-2 text-sm text-gray-300">
                          <div>Last synced: {selectedAgreement.source.lastSyncedAt ? new Date(selectedAgreement.source.lastSyncedAt).toLocaleString() : 'Never'}</div>
                          <div>Last published: {selectedAgreement.source.lastPublishedAt ? new Date(selectedAgreement.source.lastPublishedAt).toLocaleString() : 'Not published yet'}</div>
                          <div>Reviewed: {selectedAgreement.source.reviewedAt ? new Date(selectedAgreement.source.reviewedAt).toLocaleString() : 'Not reviewed yet'}</div>
                        </div>
                        {selectedAgreement.source.lastPublishedUrl ? (
                          <a
                            href={selectedAgreement.source.lastPublishedUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-3 block break-all text-xs text-agent-accent hover:text-blue-300"
                          >
                            {selectedAgreement.source.lastPublishedUrl}
                          </a>
                        ) : null}
                        {selectedAgreement.source.lastPublishError ? (
                          <div className="mt-3 text-xs text-rose-300">
                            Last publish error: {selectedAgreement.source.lastPublishError}
                          </div>
                        ) : null}
                        {selectedAgreement.source.latestSummary ? (
                          <div className="mt-3 rounded-lg border border-agent-border bg-agent-card/80 p-3 text-xs text-gray-300">
                            {selectedAgreement.source.latestSummary}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="rounded-xl border border-agent-border bg-agent-bg/60 p-4">
                      <div className="text-xs uppercase tracking-wide text-gray-500">Latest Synced Summary Override</div>
                      <textarea
                        value={sourceSummaryOverride}
                        onChange={(e) => setSourceSummaryOverride(e.target.value)}
                        placeholder="Optional manual summary. Leave blank to fetch and summarize the live thread URL."
                        className="mt-3 min-h-[110px] w-full rounded-lg border border-agent-border bg-agent-card px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-agent-accent focus:outline-none"
                      />
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={handleSyncSource}
                          disabled={sourceActionLoading === 'sync'}
                          className="rounded-lg border border-agent-accent/40 px-4 py-2 text-sm text-agent-accent hover:bg-agent-accent/10 disabled:opacity-50"
                        >
                          {sourceActionLoading === 'sync' ? 'Syncing...' : 'Sync Source Thread'}
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-agent-border bg-agent-bg/60 p-4">
                      <div className="text-xs uppercase tracking-wide text-gray-500">Draft Update</div>
                      <textarea
                        value={sourceDraftUpdate}
                        onChange={(e) => setSourceDraftUpdate(e.target.value)}
                        placeholder="Draft the reviewer-approved update that should be published back to the source thread."
                        className="mt-3 min-h-[140px] w-full rounded-lg border border-agent-border bg-agent-card px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-agent-accent focus:outline-none"
                      />
                      <div className="mt-4 flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={handleDraftSourceUpdate}
                          disabled={sourceActionLoading === 'draft' || !sourceDraftUpdate.trim()}
                          className="rounded-lg border border-agent-border px-4 py-2 text-sm text-white hover:bg-agent-card disabled:opacity-50"
                        >
                          {sourceActionLoading === 'draft' ? 'Saving Draft...' : 'Draft Update'}
                        </button>
                        <button
                          type="button"
                          onClick={handleReviewSourceUpdate}
                          disabled={sourceActionLoading === 'review'}
                          className="rounded-lg border border-agent-border px-4 py-2 text-sm text-white hover:bg-agent-card disabled:opacity-50"
                        >
                          {sourceActionLoading === 'review' ? 'Marking...' : 'Mark as Reviewed'}
                        </button>
                        <label className="flex items-start gap-2 rounded-lg border border-agent-border px-3 py-2 text-xs text-gray-300">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={sourceReviewerApproved}
                            onChange={(e) => setSourceReviewerApproved(e.target.checked)}
                          />
                          <span>I confirm this draft has been explicitly reviewed and is ready to post outward.</span>
                        </label>
                        <button
                          type="button"
                          onClick={handlePublishSourceUpdate}
                          disabled={sourceActionLoading === 'publish' || Boolean(publishBlockedReason)}
                          className="rounded-lg border border-emerald-500/40 px-4 py-2 text-sm text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-50"
                        >
                          {sourceActionLoading === 'publish' ? 'Publishing...' : 'Publish Update'}
                        </button>
                      </div>
                      <div className="mt-3 text-xs text-gray-400">
                        {publishBlockedReason || 'Publish is reviewer-approved and the server is ready, so this will post the update to the configured forum provider now.'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
