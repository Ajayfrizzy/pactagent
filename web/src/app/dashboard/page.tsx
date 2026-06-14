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
  ExclamationTriangleIcon,
  ClockIcon,
  SparklesIcon,
  BoltIcon,
  LinkIcon,
} from '@/components/Icons';

type AgreementRecord = {
  id: string;
  title: string;
  description: string;
  clientAddress: string;
  workerAddress: string;
  amount: string;
  deadlineAt: string;
  reviewerMode: string;
  payoutNetwork: string;
  settlementStatus?: string | null;
  status: string;
  nextParticipantAction?: string | null;
  workflowStage?: string;
  source?: {
    sourceType: string;
    sourceLabel: string;
    sponsorName?: string | null;
  } | null;
  milestones?: Array<{ status: string }>;
};

type DashboardFilter = 'ALL' | 'ACTION' | 'IN_FLIGHT' | 'DONE' | 'IMPORTED';

type ActionLane = {
  key: 'urgent' | 'attention' | 'in_flight' | 'done';
  label: string;
  title: string;
  description: string;
  count: number;
  accentClass: string;
  toneClass: string;
  agreements: AgreementRecord[];
};

type HighlightCard = {
  label: string;
  value: string;
  unit?: string;
  hint: string;
  icon: React.FC<{ className?: string }>;
  chipClass: string;
  accentClass: string;
};

const FILTER_OPTIONS: Array<{
  key: DashboardFilter;
  label: string;
  description: string;
}> = [
  { key: 'ALL', label: 'All agreements', description: 'Everything in your workspace' },
  { key: 'ACTION', label: 'Needs action', description: 'Draft, proof, review, or failed states' },
  { key: 'IN_FLIGHT', label: 'In flight', description: 'Funded work currently moving' },
  { key: 'DONE', label: 'Settled / closed', description: 'Paid, refunded, or expired agreements' },
  { key: 'IMPORTED', label: 'Imported', description: 'DAO and bounty sourced work' },
];

function getAgreementPriorityScore(agreement: AgreementRecord) {
  switch (agreement.status) {
    case 'FAILED':
      return 100;
    case 'DISPUTED':
      return 95;
    case 'UNDER_REVIEW':
      return 90;
    case 'PROOF_SUBMITTED':
      return 82;
    case 'DRAFT':
      return agreement.settlementStatus === 'FUNDING_PENDING' ? 78 : 72;
    case 'FUNDED':
      return 60;
    case 'APPROVED':
      return 52;
    case 'PAID':
      return 18;
    case 'REFUNDED':
      return 16;
    case 'EXPIRED':
      return 12;
    default:
      return 30;
  }
}

function getAgreementLane(agreement: AgreementRecord): ActionLane['key'] {
  if (['FAILED', 'DISPUTED', 'UNDER_REVIEW'].includes(agreement.status)) {
    return 'urgent';
  }

  if (['PROOF_SUBMITTED', 'DRAFT'].includes(agreement.status) || agreement.settlementStatus === 'FUNDING_PENDING') {
    return 'attention';
  }

  if (['FUNDED', 'APPROVED'].includes(agreement.status) || ['PAYOUT_PENDING', 'REFUND_PENDING', 'SPLIT_PENDING'].includes(agreement.settlementStatus || '')) {
    return 'in_flight';
  }

  return 'done';
}

function getAgreementRole(agreement: AgreementRecord, walletAddress: string | null) {
  if (!walletAddress) {
    return 'Observer';
  }

  if (walletAddress === agreement.clientAddress) {
    return 'Client Operator';
  }

  if (walletAddress === agreement.workerAddress) {
    return 'Worker / Builder';
  }

  return 'Observer';
}

function getModeLabel(agreement: AgreementRecord) {
  return agreement.source ? `${agreement.source.sourceType} Grant Mode` : 'Direct Agreement Mode';
}

function matchesFilter(agreement: AgreementRecord, filter: DashboardFilter) {
  switch (filter) {
    case 'ACTION':
      return ['FAILED', 'DISPUTED', 'UNDER_REVIEW', 'PROOF_SUBMITTED', 'DRAFT'].includes(agreement.status) || agreement.settlementStatus === 'FUNDING_PENDING';
    case 'IN_FLIGHT':
      return ['FUNDED', 'APPROVED'].includes(agreement.status) || ['PAYOUT_PENDING', 'REFUND_PENDING', 'SPLIT_PENDING'].includes(agreement.settlementStatus || '');
    case 'DONE':
      return ['PAID', 'REFUNDED', 'EXPIRED'].includes(agreement.status);
    case 'IMPORTED':
      return Boolean(agreement.source);
    case 'ALL':
    default:
      return true;
  }
}

function formatDashboardCkb(shannons: string, maximumFractionDigits = 2) {
  const ckbAmount = Number(shannonsToCKB(shannons));
  if (!Number.isFinite(ckbAmount)) {
    return shannonsToCKB(shannons);
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(ckbAmount);
}

function formatWalletAddress(address: string | null) {
  if (!address) {
    return 'Connect to unlock agreement actions';
  }

  if (address.length <= 24) {
    return address;
  }

  return `${address.slice(0, 16)}...${address.slice(-10)}`;
}

export default function DashboardPage() {
  useWebSocket();
  const walletAddress = useStore((s) => s.walletAddress);
  const authToken = useStore((s) => s.authToken);
  const isAdmin = useStore((s) => s.isAdmin);
  const updateCount = useStore((s) => s.agreementUpdateCount);
  const [agreements, setAgreements] = useState<AgreementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<DashboardFilter>('ALL');

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

  const sortedAgreements = useMemo(
    () => [...agreements].sort((left, right) => {
      const priorityDelta = getAgreementPriorityScore(right) - getAgreementPriorityScore(left);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return new Date(right.deadlineAt).getTime() - new Date(left.deadlineAt).getTime();
    }),
    [agreements],
  );

  const stats = useMemo(() => {
    const totalEscrow = agreements.reduce((sum, agreement) => sum + Number(agreement.amount || 0), 0);
    const activeCount = agreements.filter((agreement) => ['FUNDED', 'PROOF_SUBMITTED', 'UNDER_REVIEW', 'DISPUTED', 'APPROVED'].includes(agreement.status)).length;
    const reviewCount = agreements.filter((agreement) => ['UNDER_REVIEW', 'DISPUTED'].includes(agreement.status)).length;
    const completedCount = agreements.filter((agreement) => agreement.status === 'PAID').length;
    const urgentCount = agreements.filter((agreement) => getAgreementLane(agreement) === 'urgent').length;
    const attentionCount = agreements.filter((agreement) => getAgreementLane(agreement) === 'attention').length;
    const grantAgreements = agreements.filter((agreement) => Boolean(agreement.source)).length;

    return {
      totalEscrow,
      activeCount,
      reviewCount,
      completedCount,
      urgentCount,
      attentionCount,
      grantAgreements,
    };
  }, [agreements]);

  const highlightCards = useMemo<HighlightCard[]>(
    () => [
      {
        label: 'Urgent decisions',
        value: String(stats.urgentCount),
        hint: 'Disputes, failed settlement, or review bottlenecks',
        icon: ExclamationTriangleIcon,
        chipClass: 'border-rose-400/30 bg-rose-500/10',
        accentClass: 'text-rose-200',
      },
      {
        label: 'Needs action soon',
        value: String(stats.attentionCount),
        hint: 'Drafts, proof handoffs, and funding follow-through',
        icon: ClockIcon,
        chipClass: 'border-amber-400/30 bg-amber-500/10',
        accentClass: 'text-amber-200',
      },
      {
        label: 'Active value',
        value: formatDashboardCkb(String(stats.totalEscrow)),
        unit: 'CKB',
        hint: 'Value currently routed through your agreements',
        icon: CurrencyDollarIcon,
        chipClass: 'border-emerald-400/30 bg-emerald-500/10',
        accentClass: 'text-emerald-200',
      },
      {
        label: 'Imported work',
        value: String(stats.grantAgreements),
        hint: 'DAO and bounty sourced agreements',
        icon: SparklesIcon,
        chipClass: 'border-fuchsia-400/30 bg-fuchsia-500/10',
        accentClass: 'text-fuchsia-200',
      },
    ],
    [stats.attentionCount, stats.grantAgreements, stats.totalEscrow, stats.urgentCount],
  );

  const topAgreement = sortedAgreements[0] || null;

  const actionLanes = useMemo<ActionLane[]>(
    () => {
      const urgent = sortedAgreements.filter((agreement) => getAgreementLane(agreement) === 'urgent').slice(0, 3);
      const attention = sortedAgreements.filter((agreement) => getAgreementLane(agreement) === 'attention').slice(0, 4);
      const inFlight = sortedAgreements.filter((agreement) => getAgreementLane(agreement) === 'in_flight').slice(0, 4);
      const done = sortedAgreements.filter((agreement) => getAgreementLane(agreement) === 'done').slice(0, 3);

      return [
        {
          key: 'urgent',
          label: 'Act now',
          title: 'Decisions that can block trust or settlement',
          description: 'Open these first. They are the agreements most likely to stall a payout, review, or dispute process.',
          count: urgent.length,
          accentClass: 'text-rose-200',
          toneClass: 'border-rose-400/25 bg-rose-950/12',
          agreements: urgent,
        },
        {
          key: 'attention',
          label: 'Next up',
          title: 'Near-term tasks waiting for a human follow-through',
          description: 'These are not broken yet, but they need your next move to keep work flowing.',
          count: attention.length,
          accentClass: 'text-amber-200',
          toneClass: 'border-amber-400/20 bg-amber-950/10',
          agreements: attention,
        },
        {
          key: 'in_flight',
          label: 'In motion',
          title: 'Agreements progressing without immediate risk',
          description: 'Work is underway, funded, or settling. Use these for situational awareness instead of urgent triage.',
          count: inFlight.length,
          accentClass: 'text-sky-200',
          toneClass: 'border-sky-400/20 bg-sky-950/10',
          agreements: inFlight,
        },
        {
          key: 'done',
          label: 'Closed out',
          title: 'Settled or finished agreements',
          description: 'These are useful for audit history, reputation, and confirming what has already landed.',
          count: done.length,
          accentClass: 'text-emerald-200',
          toneClass: 'border-emerald-400/20 bg-emerald-950/10',
          agreements: done,
        },
      ];
    },
    [sortedAgreements],
  );

  const filteredAgreements = useMemo(
    () => sortedAgreements.filter((agreement) => matchesFilter(agreement, activeFilter)),
    [activeFilter, sortedAgreements],
  );

  const todayQueue = useMemo(
    () =>
      sortedAgreements
        .filter((agreement) => ['urgent', 'attention'].includes(getAgreementLane(agreement)))
        .slice(0, 4),
    [sortedAgreements],
  );

  const workflowGroups = useMemo(
    () => [
      {
        key: 'needs-action',
        label: 'Needs Action',
        description: 'Human decisions, review pressure, disputes, and drafts that are waiting on you.',
        agreements: sortedAgreements.filter((agreement) => ['urgent', 'attention'].includes(getAgreementLane(agreement))).slice(0, 5),
      },
      {
        key: 'in-progress',
        label: 'In Progress',
        description: 'Funded work and approvals currently moving through proof, review, or settlement.',
        agreements: sortedAgreements.filter((agreement) => getAgreementLane(agreement) === 'in_flight').slice(0, 5),
      },
      {
        key: 'waiting',
        label: 'Waiting On Others',
        description: 'Agreements that are healthy for now and mainly need counterparty follow-through.',
        agreements: sortedAgreements.filter((agreement) => ['FUNDED', 'APPROVED'].includes(agreement.status)).slice(0, 5),
      },
      {
        key: 'completed',
        label: 'Completed Recently',
        description: 'Recent closures kept nearby for auditability without crowding active work.',
        agreements: sortedAgreements.filter((agreement) => getAgreementLane(agreement) === 'done').slice(0, 4),
      },
    ],
    [sortedAgreements],
  );

  const visibleAgreementIds = useMemo(
    () => agreements.map((agreement) => agreement.id),
    [agreements],
  );

  async function handleCreateInvite(event: React.MouseEvent, agreement: AgreementRecord) {
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
          disputeWindowSecs: 86400,
          proofType: 'URL',
          reviewerMode: agreement.reviewerMode,
          releaseMode: 'PARTIAL',
          payoutNetwork: agreement.payoutNetwork,
          milestones: (agreement.milestones || []).map((milestone, index) => ({
            title: `Milestone ${index + 1}`,
            description: `Imported from ${agreement.title}`,
            amount: '0',
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
      <nav className="app-nav">
        <div className="app-nav-inner">
          <BrandLogo />
          <NavbarMenu>
            <Link href="/dashboard" className="app-nav-link">Dashboard</Link>
            <Link href="/agreement/import-bounty" className="app-nav-link">Imports</Link>
            {isAdmin ? <Link href="/admin" className="app-nav-link-accent">Admin</Link> : null}
          </NavbarMenu>
        </div>
      </nav>

      <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
        <Link href="/" className="page-back-link gap-2">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Home
        </Link>

        <section className="ui-panel overflow-hidden p-6 md:p-8">
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1.25fr)_340px]">
            <div>
              <div className="ui-kicker mb-4">
                <span className="h-2 w-2 animate-pulse rounded-full bg-agent-accent" />
                Command Bar
              </div>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-3xl">
                  <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Dashboard</h1>
                  <p className="mt-3 text-sm text-gray-400 sm:text-base">
                    {authToken
                      ? `${stats.urgentCount} agreement${stats.urgentCount === 1 ? '' : 's'} need immediate attention and ${stats.attentionCount} more are waiting for the next human move.`
                      : 'Connect your wallet to turn this into your live agreement command center.'}
                  </p>
                </div>
                <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end lg:ml-auto">
                  <Link href="/agreement/import-bounty" className="ui-button-secondary-sm ui-mobile-action">
                    <SparklesIcon className="h-4 w-4" />
                    Import Bounty
                  </Link>
                  <Link href="/agreement/new" className="ui-button-primary-sm ui-mobile-action">
                    <PlusIcon className="h-4 w-4" />
                    New Agreement
                  </Link>
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {highlightCards.map((card) => {
                  const Icon = card.icon;
                  return (
                    <div key={card.label} className="ui-panel-raised min-w-0 overflow-hidden p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">{card.label}</div>
                          <div className="mt-2 break-words text-[1.7rem] font-semibold leading-tight text-white">
                            {card.value}
                          </div>
                          {card.unit ? <div className="mt-1 text-xs uppercase tracking-[0.16em] text-gray-500">{card.unit}</div> : null}
                        </div>
                        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${card.chipClass}`}>
                          <Icon className={`h-5 w-5 ${card.accentClass}`} />
                        </div>
                      </div>
                      <p className="mt-3 text-sm text-gray-400">{card.hint}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            <aside className="ui-panel-soft p-5">
              <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">Workspace Snapshot</div>
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-agent-border bg-agent-card/65 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">Connected wallet</div>
                      <div className="mt-2 break-all font-mono text-xs text-gray-300">{formatWalletAddress(walletAddress)}</div>
                    </div>
                    <ShieldCheckIcon className="h-5 w-5 text-sky-300" />
                  </div>
                </div>
                <div className="rounded-2xl border border-agent-border bg-agent-card/65 p-4">
                  <div className="text-sm font-semibold text-white">Review pressure</div>
                  <p className="mt-2 text-sm text-gray-400">
                    {stats.reviewCount} agreement{stats.reviewCount === 1 ? '' : 's'} are currently sitting in review or dispute.
                  </p>
                </div>
                <div className="rounded-2xl border border-agent-border bg-agent-card/65 p-4">
                  <div className="text-sm font-semibold text-white">Delivery underway</div>
                  <p className="mt-2 text-sm text-gray-400">
                    {stats.activeCount} agreement{stats.activeCount === 1 ? '' : 's'} are funded and moving through delivery, review, or settlement.
                  </p>
                </div>
                <div className="rounded-2xl border border-agent-border bg-agent-card/65 p-4">
                  <div className="text-sm font-semibold text-white">Settled history</div>
                  <p className="mt-2 text-sm text-gray-400">
                    {stats.completedCount} agreement{stats.completedCount === 1 ? '' : 's'} have fully settled and now strengthen your operating record.
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </section>

        {!authToken ? (
          <WalletOnboardingCard
            title="Unlock your dashboard"
            description="Your dashboard, invites, webhooks, and agreement actions are all tied to your signed-in wallet."
          />
        ) : null}

        {authToken ? (
          <section className="ui-panel p-6">
            <div className="flex flex-col gap-3">
              <div>
                <div className="ui-kicker mb-2">Today</div>
                <h2 className="text-2xl font-semibold text-white">What needs attention now</h2>
                <p className="mt-1 text-sm text-gray-400">
                  Start here when you want the shortest path to unblocking trust, review, or settlement.
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 xl:grid-cols-2">
              {todayQueue.length ? todayQueue.map((agreement) => (
                <Link
                  key={agreement.id}
                  href={`/agreement/${agreement.id}`}
                  className="group rounded-3xl border border-agent-border bg-agent-card/80 p-5 transition-all hover:border-agent-accent/45"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={agreement.status} />
                        <StatusBadge status={agreement.settlementStatus || 'UNFUNDED'} />
                        <span className="ui-chip-muted">{getAgreementRole(agreement, walletAddress)}</span>
                      </div>
                      <h3 className="mt-3 text-lg font-semibold text-white group-hover:text-agent-accent">{agreement.title}</h3>
                      <p className="mt-2 text-sm text-gray-400">
                        {agreement.nextParticipantAction || getStatusMeta(agreement.status).hint || 'Open the agreement to continue the next step.'}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-agent-border bg-agent-bg/55 px-3 py-2 text-right">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500">Deadline</div>
                      <div className="mt-1 text-sm text-white">{new Date(agreement.deadlineAt).toLocaleDateString()}</div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-gray-400">
                    <NetworkBadge network={agreement.payoutNetwork} />
                    <span>{formatDashboardCkb(agreement.amount, 4)} CKB</span>
                    <span>{agreement.milestones?.length || 0} milestones</span>
                    {agreement.source ? <span>{agreement.source.sourceType} import</span> : null}
                  </div>
                </Link>
              )) : (
                <div className="rounded-2xl border border-agent-border bg-agent-bg/45 p-5 text-sm text-gray-400">
                  No urgent agreements are competing for attention right now.
                </div>
              )}
            </div>
          </section>
        ) : null}

        <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-6">
            {authToken ? (
              <section className="ui-panel p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="ui-kicker mb-2">Workflow Queue</div>
                    <h2 className="text-2xl font-semibold text-white">Run the queue with the right level of urgency</h2>
                    <p className="mt-1 text-sm text-gray-400">
                      Separate direct action from healthy in-flight work so fast decisions do not get buried under passive monitoring.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {FILTER_OPTIONS.map((filter) => (
                      <button
                        key={filter.key}
                        type="button"
                        onClick={() => setActiveFilter(filter.key)}
                        className={activeFilter === filter.key ? 'ui-button-primary-sm' : 'ui-button-secondary-sm'}
                      >
                        {filter.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-6 grid gap-4 xl:grid-cols-2">
                  {workflowGroups.map((group) => (
                    <div key={group.key} className="rounded-3xl border border-agent-border bg-agent-bg/50 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.18em] text-agent-accent">{group.label}</div>
                          <p className="mt-2 text-sm text-gray-400">{group.description}</p>
                        </div>
                        <div className="rounded-full border border-agent-border bg-agent-card/70 px-3 py-1 text-sm font-semibold text-white">
                          {group.agreements.length}
                        </div>
                      </div>
                      <div className="mt-4 space-y-3">
                        {group.agreements.length ? group.agreements.map((agreement) => (
                          <Link
                            key={`${group.key}-${agreement.id}`}
                            href={`/agreement/${agreement.id}`}
                            className="block rounded-2xl border border-agent-border bg-agent-card/70 p-4 transition-colors hover:border-agent-accent/40"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-white">{agreement.title}</div>
                                <p className="mt-1 text-xs text-gray-500">{agreement.nextParticipantAction || getStatusMeta(agreement.status).hint}</p>
                              </div>
                              <StatusBadge status={agreement.status} />
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                              <span>{formatDashboardCkb(agreement.amount, 4)} CKB</span>
                              <span>{new Date(agreement.deadlineAt).toLocaleDateString()}</span>
                              <NetworkBadge network={agreement.payoutNetwork} />
                            </div>
                          </Link>
                        )) : (
                          <div className="rounded-2xl border border-agent-border bg-agent-bg/45 p-4 text-sm text-gray-400">
                            No agreements currently sit in this queue.
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="ui-panel p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="ui-kicker mb-2">Agreements</div>
                  <h2 className="text-2xl font-semibold text-white">Browse the whole workspace with intent</h2>
                  <p className="mt-1 text-sm text-gray-400">
                    Use filters when you need focus, then drop into any agreement for proof, review, disputes, or settlement actions.
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-3 text-sm text-gray-400">
                {FILTER_OPTIONS.map((filter) => (
                  <div key={`desc-${filter.key}`} className={`rounded-full border px-3 py-1 ${activeFilter === filter.key ? 'border-agent-accent/30 bg-agent-accent/10 text-agent-accent' : 'border-agent-border bg-agent-bg/50'}`}>
                    {filter.description}
                  </div>
                ))}
              </div>
            </section>

            <section>
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
                <div className="ui-alert-error rounded-2xl p-6">{error}</div>
              ) : filteredAgreements.length === 0 ? (
                <div className="ui-panel p-12 text-center">
                  <DocumentTextIcon className="mx-auto mb-4 h-10 w-10 text-gray-600" />
                  <h3 className="mb-2 font-semibold text-white">
                    {agreements.length ? 'No agreements match this filter' : 'No agreements yet'}
                  </h3>
                  <p className="mb-4 text-sm text-gray-400">
                    {agreements.length
                      ? 'Try another filter or create a new agreement to add more work into the queue.'
                      : 'Start with a direct milestone agreement, or import DAO / bounty work and let PactAgent organize the full lifecycle from there.'}
                  </p>
                  <div className="flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                    <Link href="/agreement/new" className="ui-button-primary-sm ui-mobile-action px-6">
                      <PlusIcon className="h-4 w-4" />
                      Create Agreement
                    </Link>
                    <Link href="/agreement/import-bounty" className="ui-button-secondary-sm ui-mobile-action px-6">
                      Import DAO / Bounty
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {inviteMessage ? <div className="ui-alert-success">{inviteMessage}</div> : null}
                  {filteredAgreements.map((agreement) => {
                    const paidMilestones = agreement.milestones?.filter((milestone) => milestone.status === 'PAID').length ?? 0;
                    const totalMilestones = agreement.milestones?.length ?? 0;
                    const milestoneProgress = totalMilestones ? Math.round((paidMilestones / totalMilestones) * 100) : 0;
                    const primaryStatus = getStatusMeta(agreement.status);
                    const settlementStatus = getStatusMeta(agreement.settlementStatus || 'UNFUNDED');
                    const viewerRole = getAgreementRole(agreement, walletAddress);
                    const modeLabel = getModeLabel(agreement);

                    return (
                      <Link
                        key={agreement.id}
                        href={`/agreement/${agreement.id}`}
                        className="group block rounded-3xl border border-agent-border bg-agent-card p-5 transition-all hover:border-agent-accent/45"
                      >
                        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="mb-3 flex flex-wrap items-center gap-2">
                              <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] ${
                                agreement.source
                                  ? 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200'
                                  : 'border-sky-500/30 bg-sky-500/10 text-sky-200'
                              }`}>
                                {modeLabel}
                              </span>
                              <span className="ui-chip-muted">{viewerRole}</span>
                              {agreement.workflowStage ? <span className="ui-chip-muted">{agreement.workflowStage}</span> : null}
                            </div>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h3 className="text-lg font-semibold text-white transition-colors group-hover:text-agent-accent">
                                  {agreement.title}
                                </h3>
                                <p className="mt-1 text-xs text-gray-500">{agreement.id.slice(0, 8)}...</p>
                              </div>
                              <div className="flex flex-wrap gap-2 xl:justify-end">
                                <StatusBadge status={agreement.status} />
                                <StatusBadge status={agreement.settlementStatus || 'UNFUNDED'} />
                              </div>
                            </div>

                            <p className="mt-4 line-clamp-2 text-sm text-gray-400">{agreement.description}</p>

                            <div className="mt-4 rounded-2xl border border-agent-border bg-agent-bg/50 px-4 py-3">
                              <div className="text-[11px] uppercase tracking-[0.14em] text-gray-500">Next safe action</div>
                              <div className="mt-1 text-sm text-white">
                                {agreement.nextParticipantAction || primaryStatus.hint || 'Open the agreement to continue the next step.'}
                              </div>
                            </div>
                          </div>

                          <div className="w-full xl:max-w-[19rem]">
                            <div className="rounded-2xl border border-agent-border bg-agent-bg/55 p-4">
                              <div className="mb-3 flex items-center justify-between text-xs text-gray-500">
                                <span>Milestone progress</span>
                                <span>{paidMilestones}/{totalMilestones} paid</span>
                              </div>
                              <div className="h-2 rounded-full bg-agent-bg/80">
                                <div className="h-2 rounded-full bg-agent-accent transition-[width]" style={{ width: `${milestoneProgress}%` }} />
                              </div>
                              <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-gray-400">
                                <div>
                                  <div className="text-[11px] uppercase tracking-[0.14em] text-gray-500">Value</div>
                                  <div className="mt-1 font-mono text-white">{formatDashboardCkb(agreement.amount, 4)} CKB</div>
                                </div>
                                <div>
                                  <div className="text-[11px] uppercase tracking-[0.14em] text-gray-500">Deadline</div>
                                  <div className="mt-1 text-white">{new Date(agreement.deadlineAt).toLocaleDateString()}</div>
                                </div>
                                <div>
                                  <div className="text-[11px] uppercase tracking-[0.14em] text-gray-500">Settlement</div>
                                  <div className="mt-1 text-white">{settlementStatus.label}</div>
                                </div>
                                <div>
                                  <div className="text-[11px] uppercase tracking-[0.14em] text-gray-500">Payout</div>
                                  <div className="mt-1"><NetworkBadge network={agreement.payoutNetwork} /></div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {agreement.source ? (
                          <div className="mt-4 rounded-2xl border border-agent-border bg-agent-bg/45 px-4 py-3 text-xs text-gray-400">
                            Imported from <span className="font-medium text-white">{agreement.source.sourceLabel}</span>
                            {agreement.source.sponsorName ? ` · sponsored by ${agreement.source.sponsorName}` : ''}.
                          </div>
                        ) : null}

                        {agreement.status === 'DRAFT' ? (
                          <div className="mt-4 flex flex-wrap items-center gap-3">
                            <button
                              type="button"
                              onClick={(event) => void handleCreateInvite(event, agreement)}
                              className="ui-button-ghost"
                            >
                              <LinkIcon className="h-4 w-4" />
                              Copy Worker Invite
                            </button>
                            <span className="text-xs text-gray-500">
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
            <section className="ui-panel p-5">
              <div className="ui-kicker mb-3">Insights</div>
              <h2 className="text-xl font-semibold text-white">Keep the rest of the workspace in view</h2>
              <p className="mt-2 text-sm text-gray-400">
                Supporting context stays quieter here so active agreement work keeps the spotlight.
              </p>

              <div className="mt-5 space-y-3">
                <div className="ui-panel-soft p-4">
                  <h3 className="text-sm font-semibold text-white">Marketplace setup</h3>
                  <p className="mt-2 text-sm text-gray-400">
                    Improve trust and external visibility around your agreement operation.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3 text-sm">
                    <Link href="/settings/profile" className="app-nav-link-accent">Edit public profile</Link>
                    <Link href="/settings/webhooks" className="app-nav-link-accent">Manage webhooks</Link>
                    <Link href="/agreement/import-bounty" className="app-nav-link-accent">Import DAO / bounty</Link>
                  </div>
                </div>

                <div className="ui-panel-soft p-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Quick reads</div>
                  <div className="mt-3 space-y-3 text-sm text-gray-400">
                    <div className="flex items-start gap-3">
                      <ClipboardDocumentCheckIcon className="mt-0.5 h-4 w-4 text-sky-300" />
                      <span>Stabilize scope in draft, then fund once the milestone plan is trustworthy.</span>
                    </div>
                    <div className="flex items-start gap-3">
                      <ScaleIcon className="mt-0.5 h-4 w-4 text-amber-300" />
                      <span>Review and dispute states deserve the fastest turnaround because they directly affect trust.</span>
                    </div>
                    <div className="flex items-start gap-3">
                      <CurrencyDollarIcon className="mt-0.5 h-4 w-4 text-emerald-300" />
                      <span>Closed agreements are valuable history, but they should not outshine active decisions.</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="ui-panel p-5">
              <div className="mb-4 flex items-center gap-2 text-white">
                <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
                <h2 className="text-lg font-semibold">Agent Activity</h2>
              </div>
              <p className="mb-4 text-sm text-gray-400">
                Live operational logs from the agreement watcher, reviewer, and settlement routines.
              </p>
              <AgentLogPanel allowedAgreementIds={visibleAgreementIds} />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
