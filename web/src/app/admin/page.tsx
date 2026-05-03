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
  fetchFiberAdminChannels,
  fetchFiberAdminHealth,
  fetchFiberAdminInfo,
  replayAgreementJob,
} from '@/lib/api';
import { AgentIcon, ArrowLeftIcon, ShieldCheckIcon } from '@/components/Icons';

export default function AdminPage() {
  const authToken = useStore((s) => s.authToken);
  const isAdmin = useStore((s) => s.isAdmin);
  const walletAddress = useStore((s) => s.walletAddress);
  const [agreements, setAgreements] = useState<any[]>([]);
  const [selectedAgreementId, setSelectedAgreementId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [fiberHealth, setFiberHealth] = useState<any>(null);
  const [fiberInfo, setFiberInfo] = useState<any>(null);
  const [fiberChannels, setFiberChannels] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [jobLoadingId, setJobLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAdminData() {
      if (!authToken || !isAdmin) {
        setLoading(false);
        return;
      }

      try {
        const [agreementList, health, info, channels] = await Promise.all([
          fetchAgreements(),
          fetchFiberAdminHealth(),
          fetchFiberAdminInfo().catch(() => null),
          fetchFiberAdminChannels().catch(() => null),
        ]);

        if (cancelled) {
          return;
        }

        setAgreements(agreementList);
        setSelectedAgreementId((current) => current || agreementList[0]?.id || null);
        setFiberHealth(health);
        setFiberInfo(info);
        setFiberChannels(channels);
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
              <StatusBadge status={fiberHealth?.healthy ? 'CONFIRMED' : 'FAILED'} />
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
                  <div>Channels: {fiberChannels?.count ?? 0}</div>
                  <div className="break-all">Node ID: {fiberInfo?.node_id || 'Unavailable'}</div>
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

            <section className="rounded-2xl border border-agent-border bg-agent-card/70 p-5">
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
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
