'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { NavbarMenu } from '@/components/NavbarMenu';
import { AgentLogPanel } from '@/components/AgentLogPanel';
import { StatusBadge, NetworkBadge, getStatusMeta } from '@/components/StatusBadge';
import { WalletOnboardingCard } from '@/components/WalletOnboardingCard';
import { BrandLogo } from '@/components/BrandLogo';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useStore } from '@/lib/store';
import { createInvite, fetchAgreements } from '@/lib/api';
import { shannonsToCKB } from '@/lib/ckb';
import {
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

  const agreementsNeedingAttention = agreements.filter((agreement) =>
    ['UNDER_REVIEW', 'DISPUTED', 'PROOF_SUBMITTED', 'FAILED'].includes(agreement.status)
  ).length;
  const priorityAgreements = agreements.filter((agreement) =>
    ['PROOF_SUBMITTED', 'UNDER_REVIEW', 'DISPUTED', 'FAILED', 'DRAFT'].includes(agreement.status)
  );
  const grantAgreements = agreements.filter((agreement) => Boolean(agreement.source)).length;
  const lifecycleLanes = useMemo(
    () => [
      {
        label: 'Draft & Funding',
        value: agreements.filter((agreement) => agreement.status === 'DRAFT' || agreement.settlementStatus === 'FUNDING_PENDING').length,
        hint: 'Still being finalized or funded',
      },
      {
        label: 'Delivery',
        value: agreements.filter((agreement) => ['FUNDED', 'PROOF_SUBMITTED'].includes(agreement.status)).length,
        hint: 'Work is underway or proof just landed',
      },
      {
        label: 'Review & Dispute',
        value: agreements.filter((agreement) => ['UNDER_REVIEW', 'DISPUTED'].includes(agreement.status)).length,
        hint: 'A human decision is required',
      },
      {
        label: 'Settlement & Done',
        value: agreements.filter((agreement) => ['PAID', 'REFUNDED', 'EXPIRED'].includes(agreement.status) || ['PAYOUT_PENDING', 'REFUND_PENDING', 'SPLIT_PENDING'].includes(agreement.settlementStatus || '')).length,
        hint: 'Payout, refund, or closure in progress',
      },
    ],
    [agreements],
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
          <BrandLogo />
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

        {!authToken ? (
          <WalletOnboardingCard
            title="Unlock your dashboard"
            description="Your dashboard, invites, webhooks, and agreement actions are all tied to your signed-in wallet."
          />
        ) : null}

        <section className="rounded-3xl border border-agent-border bg-agent-card/80 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.28)] sm:p-6 md:p-8">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-2xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-agent-border bg-agent-bg/70 px-3 py-1 text-xs uppercase tracking-[0.2em] text-agent-accent">
                <span className="h-2 w-2 animate-pulse rounded-full bg-agent-accent" />
                Action Overview
              </div>
              <h1 className="mb-3 text-2xl font-bold text-white sm:text-3xl md:text-4xl">What needs your attention right now</h1>
              <p className="text-sm text-gray-400 md:text-base">
                Start with urgent agreements, then drop into lifecycle views, settings, and activity when you need more context.
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-agent-border bg-agent-bg/60 p-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-amber-300">Needs review</div>
                  <p className="mt-2 text-sm text-gray-300">
                    {stats.reviewCount} agreement{stats.reviewCount === 1 ? '' : 's'} are waiting for a payout or dispute decision.
                  </p>
                </div>
                <div className="rounded-2xl border border-agent-border bg-agent-bg/60 p-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-sky-300">In progress</div>
                  <p className="mt-2 text-sm text-gray-300">
                    {stats.activeCount} agreement{stats.activeCount === 1 ? '' : 's'} are funded and moving through delivery.
                  </p>
                </div>
                <div className="rounded-2xl border border-agent-border bg-agent-bg/60 p-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-orange-300">Imported work</div>
                  <p className="mt-2 text-sm text-gray-300">
                    {grantAgreements} agreement{grantAgreements === 1 ? '' : 's'} came from DAO, bounty, or CKBoost sources.
                  </p>
                </div>
              </div>
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

        {authToken && priorityAgreements.length > 0 ? (
          <section className="rounded-3xl border border-agent-border bg-agent-card/75 p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">Priority Queue</div>
                <h2 className="mt-2 text-xl font-semibold text-white">Start here</h2>
                <p className="mt-1 text-sm text-gray-400">
                  These agreements are closest to needing a concrete decision, funding step, or participant handoff.
                </p>
              </div>
              <Link
                href="/agreement/new"
                className="inline-flex items-center justify-center rounded-xl border border-agent-accent/35 bg-agent-accent/10 px-4 py-2.5 text-sm font-medium text-agent-accent hover:bg-agent-accent/20"
              >
                Create another agreement
              </Link>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {priorityAgreements.slice(0, 4).map((agreement) => (
                <Link
                  key={agreement.id}
                  href={`/agreement/${agreement.id}`}
                  className="rounded-2xl border border-agent-border bg-agent-bg/45 p-4 transition-colors hover:border-agent-accent/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{agreement.title}</div>
                      <p className="mt-1 text-xs text-gray-500">{agreement.id.slice(0, 8)}...</p>
                    </div>
                    <StatusBadge status={agreement.status} />
                  </div>
                  <div className="mt-3 rounded-xl border border-agent-border bg-agent-card/60 px-3 py-2.5">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-gray-500">Do this next</div>
                    <div className="mt-1 text-sm text-white">
                      {agreement.nextParticipantAction || getStatusMeta(agreement.status).hint || 'Open the agreement to continue the next step.'}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                    <NetworkBadge network={agreement.payoutNetwork} />
                    <span>{shannonsToCKB(agreement.amount)} CKB</span>
                    <span>{agreement.milestones?.length || 0} milestones</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <section className="rounded-3xl border border-agent-border bg-agent-card/70 p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">Lifecycle Lanes</div>
              <h2 className="mt-2 text-xl font-semibold text-white">See where agreements are clustered right now</h2>
              <p className="mt-1 text-sm text-gray-400">
                PactAgent now reads as an operating system for agreement progression. These lanes show whether your work is still being drafted, delivered, reviewed, or settled.
              </p>
            </div>
            <div className="rounded-2xl border border-agent-border bg-agent-bg/60 px-4 py-3 text-sm text-gray-300">
              <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Imported grants / bounties</div>
              <div className="mt-2 text-xl font-semibold text-white">{grantAgreements}</div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {lifecycleLanes.map((lane) => (
              <div key={lane.label} className="rounded-2xl border border-agent-border bg-agent-bg/55 p-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">{lane.label}</div>
                <div className="mt-2 text-2xl font-semibold text-white">{lane.value}</div>
                <p className="mt-2 text-sm text-gray-400">{lane.hint}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <section className="rounded-2xl border border-agent-border bg-agent-card/70 p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-white sm:text-xl">Dashboard</h2>
              </div>
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
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
                      <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">Needs attention</div>
                      <div className="flex items-center gap-2 font-medium text-white">
                        <ShieldCheckIcon className="h-4 w-4 text-amber-300" />
                        {agreementsNeedingAttention} agreements
                      </div>
                    </div>
                    <div className="min-w-[180px] rounded-xl border border-agent-border bg-agent-bg/60 px-4 py-3">
                      <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">Connected wallet</div>
                      <div className="break-all font-mono text-xs text-white">
                        {walletAddress || 'Connect to unlock agreement actions'}
                      </div>
                    </div>
                    <Link
                      href="/agreement/import-ckboost"
                      className="inline-flex min-w-[180px] items-center justify-center rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm font-medium text-orange-200 transition-colors hover:bg-orange-500/20"
                    >
                      Create from CKBoost
                    </Link>
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
                <WalletOnboardingCard
                  title="Finish wallet access before using the dashboard"
                  description="Once your wallet is connected and signed in, this page turns into your action list for agreements, invites, webhooks, and profile settings."
                />
              ) : error ? (
                <div className="rounded-2xl border border-red-800 bg-red-900/30 p-6 text-sm text-red-200">
                  {error}
                </div>
              ) : agreements.length === 0 ? (
                <div className="rounded-2xl border border-agent-border bg-agent-card p-12 text-center">
                  <DocumentTextIcon className="mx-auto mb-4 h-10 w-10 text-gray-600" />
                  <h3 className="mb-2 font-semibold text-white">No agreements yet</h3>
                  <p className="mb-3 text-sm text-gray-400">
                    Start with a direct milestone agreement, or import a DAO / bounty grant and fund the full milestone plan from one place.
                  </p>
                  <div className="mb-6 flex flex-wrap items-center justify-center gap-3 text-xs text-gray-500">
                    <span className="rounded-full border border-agent-border px-3 py-1">1. Define milestones</span>
                    <span className="rounded-full border border-agent-border px-3 py-1">2. Fund once</span>
                    <span className="rounded-full border border-agent-border px-3 py-1">3. Review and release</span>
                  </div>
                  <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
                    <Link
                      href="/agreement/new"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-agent-accent px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
                    >
                      <PlusIcon className="h-4 w-4" />
                      Create Agreement
                    </Link>
                    <Link
                      href="/agreement/import-bounty"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-agent-border px-6 py-2.5 text-sm font-medium text-gray-200 transition-colors hover:bg-agent-bg"
                    >
                      Import DAO / Bounty
                    </Link>
                    <Link
                      href="/agreement/import-ckboost"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-orange-500/30 px-6 py-2.5 text-sm font-medium text-orange-200 transition-colors hover:bg-orange-500/10"
                    >
                      Create from CKBoost
                    </Link>
                  </div>
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
                    const milestoneProgress = totalMilestones ? Math.round((paidMilestones / totalMilestones) * 100) : 0;
                    const primaryStatus = getStatusMeta(ag.status);
                    const settlementStatus = getStatusMeta(ag.settlementStatus || 'UNFUNDED');
                    const viewerRole = walletAddress === ag.clientAddress ? 'Client Operator' : walletAddress === ag.workerAddress ? 'Worker / Builder' : 'Observer';
                    const modeLabel = ag.source ? `${ag.source.sourceType} Grant Mode` : 'Direct Agreement Mode';

                    return (
                      <Link
                        key={ag.id}
                        href={`/agreement/${ag.id}`}
                        className="group block rounded-2xl border border-agent-border bg-agent-card p-5 transition-all hover:border-agent-accent/50"
                      >
                        <div className="mb-3 flex items-start justify-between gap-4">
                          <div>
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] ${
                                ag.source
                                  ? 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200'
                                  : 'border-sky-500/30 bg-sky-500/10 text-sky-200'
                              }`}>
                                {modeLabel}
                              </span>
                              <span className="rounded-full border border-agent-border bg-agent-bg/70 px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-gray-300">
                                {viewerRole}
                              </span>
                            </div>
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
                        <div className="mb-4 rounded-xl border border-agent-border bg-agent-bg/50 px-4 py-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <div className="text-[11px] uppercase tracking-[0.14em] text-gray-500">What happens next</div>
                              <div className="mt-1 text-sm text-white">{ag.nextParticipantAction || primaryStatus.hint || 'Open the agreement to continue the next step.'}</div>
                            </div>
                            <div className="text-right text-xs text-gray-400">
                              <div>{primaryStatus.label}</div>
                              <div>{settlementStatus.label}</div>
                            </div>
                          </div>
                        </div>
                        <div className="mb-4">
                          <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
                            <span>Milestone progress</span>
                            <span>{paidMilestones}/{totalMilestones} paid</span>
                          </div>
                          <div className="h-2 rounded-full bg-agent-bg/80">
                            <div
                              className="h-2 rounded-full bg-agent-accent transition-[width]"
                              style={{ width: `${milestoneProgress}%` }}
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-xs text-gray-500 md:grid-cols-5">
                          <span className="font-mono text-gray-300">{shannonsToCKB(ag.amount)} CKB</span>
                          <NetworkBadge network={ag.payoutNetwork} />
                          <span>
                            Milestones {paidMilestones}/{totalMilestones}
                          </span>
                          <span>{ag.reviewerMode} review</span>
                          <span>{new Date(ag.deadlineAt).toLocaleDateString()}</span>
                        </div>
                        {ag.source ? (
                          <div className="mt-4 rounded-xl border border-agent-border bg-agent-bg/50 px-4 py-3 text-xs text-gray-400">
                            Imported from <span className="font-medium text-white">{ag.source.sourceLabel}</span>
                            {ag.source.sponsorName ? ` · sponsored by ${ag.source.sponsorName}` : ''}.
                          </div>
                        ) : null}
                        {ag.status === 'DRAFT' ? (
                          <div className="mt-4 flex flex-wrap gap-3">
                            <button
                              type="button"
                              onClick={(event) => void handleCreateInvite(event, ag)}
                              className="rounded-lg border border-agent-accent/40 bg-agent-accent/10 px-3 py-2 text-xs font-medium text-agent-accent hover:bg-agent-accent/20"
                            >
                              Create and Copy Worker Invite
                            </button>
                            <span className="self-center text-xs text-gray-500">
                              Generates a shareable invite link and copies it to your clipboard automatically.
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
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-white sm:text-xl">Operations</h2>
              </div>
                <div className="mb-4 rounded-xl border border-agent-border bg-agent-bg/50 p-4">
                  <h3 className="text-sm font-semibold text-white">Marketplace Setup</h3>
                  <p className="mt-2 text-xs text-gray-400">
                    Configure the surfaces that help people discover, trust, and integrate your agreements.
                  </p>
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
