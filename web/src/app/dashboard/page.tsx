'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { NavbarMenu } from '@/components/NavbarMenu';
import { AgentLogPanel } from '@/components/AgentLogPanel';
import { StatusBadge, NetworkBadge } from '@/components/StatusBadge';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useStore } from '@/lib/store';
import { createInvite, fetchAgreements } from '@/lib/api';
import { shannonsToCKB } from '@/lib/ckb';
import {
  AgentIcon,
  ArrowLeftIcon,
  PlusIcon,
  DocumentTextIcon,
  CurrencyDollarIcon,
  CheckCircleIcon,
  ScaleIcon,
  ClipboardDocumentCheckIcon,
  ShieldCheckIcon,
  RocketLaunchIcon,
} from '@/components/Icons';

export default function DashboardPage() {
  useWebSocket();
  const walletAddress = useStore((s) => s.walletAddress);
  const authToken = useStore((s) => s.authToken);
  const isAdmin = useStore((s) => s.isAdmin);
  const updateCount = useStore((s) => s.agreementUpdateCount);
  const [agreements, setAgreements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!authToken) {
        setAgreements([]);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const data = await fetchAgreements(walletAddress || undefined);
        setAgreements(data);
        setError(null);
      } catch (err) {
        console.error('Failed to load agreements:', err);
        setError(err instanceof Error ? err.message : 'Failed to load agreements');
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [authToken, walletAddress, updateCount]);

  const stats = useMemo(() => {
    const totalEscrow = agreements.reduce(
      (sum, agreement) => sum + Number(agreement.amount || 0),
      0
    );
    const activeCount = agreements.filter((agreement) =>
      ['FUNDED', 'PROOF_SUBMITTED', 'UNDER_REVIEW', 'DISPUTED'].includes(agreement.status)
    ).length;
    const reviewCount = agreements.filter((agreement) =>
      ['UNDER_REVIEW', 'DISPUTED'].includes(agreement.status)
    ).length;
    const completedCount = agreements.filter((agreement) => agreement.status === 'PAID').length;

    return {
      totalEscrow,
      activeCount,
      reviewCount,
      completedCount,
    };
  }, [agreements]);

  const glanceCards = useMemo(
    () => [
      {
        label: 'Agreements',
        value: String(agreements.length),
        hint: 'Total contracts tracked',
        icon: ClipboardDocumentCheckIcon,
        accent: 'text-sky-300',
        chip: 'bg-sky-500/15 border-sky-400/20',
      },
      {
        label: 'Active Escrows',
        value: String(stats.activeCount),
        hint: 'Currently in motion',
        icon: RocketLaunchIcon,
        accent: 'text-emerald-300',
        chip: 'bg-emerald-500/15 border-emerald-400/20',
      },
      {
        label: 'Needs Review',
        value: String(stats.reviewCount),
        hint: 'Awaiting a decision',
        icon: ScaleIcon,
        accent: 'text-amber-300',
        chip: 'bg-amber-500/15 border-amber-400/20',
      },
      {
        label: 'Escrowed Value',
        value: `${shannonsToCKB(stats.totalEscrow)} CKB`,
        hint: 'Locked across milestones',
        icon: CurrencyDollarIcon,
        accent: 'text-violet-300',
        chip: 'bg-violet-500/15 border-violet-400/20',
      },
    ],
    [agreements.length, stats.activeCount, stats.reviewCount, stats.totalEscrow]
  );

  async function handleCreateInvite(event: React.MouseEvent, agreement: any) {
    event.preventDefault();
    event.stopPropagation();

    if (!walletAddress) {
      setError('Connect and authenticate your wallet first.');
      return;
    }

    try {
      const invite = await createInvite({
        createdByAddress: walletAddress,
        creatorRole: 'CLIENT',
        targetRole: 'WORKER',
        title: `${agreement.title} worker invite`,
        description: agreement.description,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        agreementTemplate: {
          title: agreement.title,
          description: agreement.description,
          deadlineAt: agreement.deadlineAt,
          disputeWindowSecs: agreement.disputeWindowSecs,
          proofType: agreement.proofType,
          reviewerMode: agreement.reviewerMode,
          releaseMode: agreement.releaseMode,
          payoutNetwork: agreement.payoutNetwork,
          escrowModel: agreement.escrowModel,
          workerFiberPubkey: agreement.workerFiberPubkey || undefined,
          milestones: (agreement.milestones || []).map((milestone: any) => ({
            title: milestone.title,
            description: milestone.description,
            amount: milestone.amount,
          })),
        },
      });

      const inviteUrl = `${window.location.origin}/invites/${invite.token}`;
      await navigator.clipboard.writeText(inviteUrl);
      setInviteMessage(`Copied invite link for "${agreement.title}"`);
      window.setTimeout(() => setInviteMessage(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invite');
    }
  }

  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-50 border-b border-agent-border bg-agent-card/50 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-2">
            <AgentIcon className="h-5 w-5 shrink-0 text-agent-accent" />
            <span className="truncate text-lg font-bold text-white">PactAgent</span>
          </Link>
          <NavbarMenu>
            <Link href="/" className="text-sm text-gray-400 transition-colors hover:text-white">
              Home
            </Link>
            {isAdmin ? (
              <Link href="/admin" className="text-sm text-agent-accent transition-colors hover:text-blue-300">
                Admin
              </Link>
            ) : null}
          </NavbarMenu>
        </div>
      </nav>

      <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
        <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-3 text-sm text-gray-300 transition-colors hover:text-white"
          >
            <ArrowLeftIcon className="h-5 w-5" />
            Back to Home
          </Link>
          <Link
            href="/agreement/new"
            className="inline-flex items-center justify-center gap-2 self-start rounded-xl bg-agent-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 sm:self-auto"
          >
            <PlusIcon className="h-4 w-4" />
            New Agreement
          </Link>
        </section>

        <section className="rounded-3xl border border-agent-border bg-agent-card/80 p-5 sm:p-6 md:p-8">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-2xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-agent-border bg-agent-bg/70 px-3 py-1 text-xs uppercase tracking-[0.2em] text-agent-accent">
                <span className="h-2 w-2 animate-pulse rounded-full bg-agent-accent" />
                Mission Control
              </div>
              <h1 className="mb-3 text-2xl font-bold text-white sm:text-3xl md:text-4xl">Milestone escrow at a glance</h1>
              <p className="text-sm text-gray-400 md:text-base">
                Track funding, proof review, disputes, and settlement activity from one place while the agent keeps each agreement moving.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:min-w-[470px] xl:max-w-[520px] xl:flex-1">
              {glanceCards.map((card) => {
                const Icon = card.icon;
                return (
                  <div
                    key={card.label}
                    className="rounded-2xl border border-agent-border bg-gradient-to-br from-agent-bg/85 to-agent-card/90 p-4 shadow-[0_14px_35px_rgba(15,23,42,0.2)]"
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">{card.label}</div>
                        <div className="mt-2 text-xl font-semibold text-white sm:text-2xl">{card.value}</div>
                      </div>
                      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${card.chip}`}>
                        <Icon className={`h-5 w-5 ${card.accent}`} />
                      </div>
                    </div>
                    <p className="text-sm text-gray-400">{card.hint}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <section className="rounded-2xl border border-agent-border bg-agent-card/70 p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-white sm:text-xl">Dashboard</h2>
                  <p className="mt-1 text-sm text-gray-400">
                    Your current operating snapshot for every active agreement.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 text-sm">
                  <div className="min-w-[180px] rounded-xl border border-agent-border bg-agent-bg/60 px-4 py-3">
                    <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">Completed payouts</div>
                    <div className="flex items-center gap-2 font-medium text-white">
                      <CheckCircleIcon className="h-4 w-4 text-green-400" />
                      {stats.completedCount} settled agreements
                    </div>
                  </div>
                  <div className="min-w-[180px] rounded-xl border border-agent-border bg-agent-bg/60 px-4 py-3">
                    <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">Connected wallet</div>
                    <div className="break-all font-mono text-xs text-white">
                      {walletAddress || 'Connect to unlock agreement actions'}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section>
              <div className="mb-4 flex items-center justify-between gap-4">
                <h2 className="text-lg font-bold text-white sm:text-xl">Your Agreements</h2>
                <Link
                  href="/agreement/new"
                  className="text-sm text-agent-accent transition-colors hover:text-blue-300"
                >
                  Create another
                </Link>
              </div>

              {loading ? (
                <div className="flex items-center justify-center rounded-2xl border border-agent-border bg-agent-card/60 py-20 text-gray-500">
                  <div className="mr-3 h-6 w-6 animate-spin rounded-full border-2 border-agent-accent border-t-transparent" />
                  Loading agreements...
                </div>
              ) : !authToken ? (
                <div className="rounded-2xl border border-agent-border bg-agent-card p-12 text-center">
                  <DocumentTextIcon className="mx-auto mb-4 h-10 w-10 text-gray-600" />
                  <h3 className="mb-2 font-semibold text-white">Connect your wallet to continue</h3>
                  <p className="text-sm text-gray-400">
                    Agreement access is tied to your authenticated wallet session.
                  </p>
                </div>
              ) : error ? (
                <div className="rounded-2xl border border-red-800 bg-red-900/30 p-6 text-sm text-red-200">
                  {error}
                </div>
              ) : agreements.length === 0 ? (
                <div className="rounded-2xl border border-agent-border bg-agent-card p-12 text-center">
                  <DocumentTextIcon className="mx-auto mb-4 h-10 w-10 text-gray-600" />
                  <h3 className="mb-2 font-semibold text-white">No agreements yet</h3>
                  <p className="mb-6 text-sm text-gray-400">Create your first payment agreement to get started.</p>
                  <Link
                    href="/agreement/new"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-agent-accent px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Create Agreement
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {inviteMessage ? (
                    <div className="rounded-xl border border-emerald-800 bg-emerald-900/20 p-4 text-sm text-emerald-200">
                      {inviteMessage}
                    </div>
                  ) : null}
                  {agreements.map((ag) => {
                    const paidMilestones =
                      ag.milestones?.filter((milestone: any) => milestone.status === 'PAID').length ?? 0;
                    const totalMilestones = ag.milestones?.length ?? 0;

                    return (
                      <Link
                        key={ag.id}
                        href={`/agreement/${ag.id}`}
                        className="group block rounded-2xl border border-agent-border bg-agent-card p-5 transition-all hover:border-agent-accent/50"
                      >
                        <div className="mb-3 flex items-start justify-between gap-4">
                          <div>
                            <h3 className="font-semibold text-white transition-colors group-hover:text-agent-accent">
                              {ag.title}
                            </h3>
                            <p className="mt-1 text-xs text-gray-500">{ag.id.slice(0, 8)}...</p>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <StatusBadge status={ag.status} />
                            <StatusBadge status={ag.settlementStatus || 'UNFUNDED'} />
                          </div>
                        </div>
                        <p className="mb-4 line-clamp-2 text-sm text-gray-400">{ag.description}</p>
                        <div className="grid grid-cols-2 gap-3 text-xs text-gray-500 md:grid-cols-5">
                          <span className="font-mono text-gray-300">{shannonsToCKB(ag.amount)} CKB</span>
                          <NetworkBadge network={ag.payoutNetwork} />
                          <span>
                            Milestones {paidMilestones}/{totalMilestones}
                          </span>
                          <span>Mode {ag.reviewerMode}</span>
                          <span>{new Date(ag.deadlineAt).toLocaleDateString()}</span>
                        </div>
                        {ag.status === 'DRAFT' ? (
                          <div className="mt-4 flex flex-wrap gap-3">
                            <button
                              type="button"
                              onClick={(event) => void handleCreateInvite(event, ag)}
                              className="rounded-lg border border-agent-accent/40 bg-agent-accent/10 px-3 py-2 text-xs font-medium text-agent-accent hover:bg-agent-accent/20"
                            >
                              Create Worker Invite
                            </button>
                            <span className="self-center text-xs text-gray-500">
                              Generates a shareable link and copies it to your clipboard.
                            </span>
                          </div>
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-2xl border border-agent-border bg-agent-card/70 p-4 sm:p-5">
              <div className="mb-4 rounded-xl border border-agent-border bg-agent-bg/50 p-4">
                <h3 className="text-sm font-semibold text-white">Marketplace Setup</h3>
                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                  <Link href="/settings/profile" className="text-agent-accent hover:text-blue-300">
                    Edit public profile
                  </Link>
                  <Link href="/settings/webhooks" className="text-agent-accent hover:text-blue-300">
                    Manage webhooks
                  </Link>
                  <Link href="/agreement/import-bounty" className="text-agent-accent hover:text-blue-300">
                    Import DAO / bounty
                  </Link>
                </div>
              </div>
              <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-white sm:text-lg">
                <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
                Agent Activity
              </h2>
              <p className="mb-4 text-sm text-gray-400">
                Live operational logs from the agreement watcher, reviewer, and settlement routines.
              </p>
              <AgentLogPanel allowedAgreementIds={agreements.map((agreement) => agreement.id)} />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
