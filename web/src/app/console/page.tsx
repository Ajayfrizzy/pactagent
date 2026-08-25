'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  Shield,
  Trash2,
} from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { NavbarMenu } from '@/components/NavbarMenu';
import { WalletConnect } from '@/features/wallet';
import { useStore } from '@/lib/store';
import {
  INFRASTRUCTURE_API_KEY_SCOPES,
  INFRASTRUCTURE_EVENT_TYPES,
  acceptInfrastructureAgreement,
  createIdempotencyKey,
  createInfrastructureAgreement,
  createInfrastructureApiKey,
  createInfrastructureApp,
  createInfrastructureEscrow,
  createInfrastructureMilestone,
  createInfrastructureProof,
  createInfrastructureWebhookEndpoint,
  deleteInfrastructureWebhookEndpoint,
  disableInfrastructureApp,
  fetchInfrastructureAdminHealth,
  fetchInfrastructureAdminList,
  fetchInfrastructureAgreements,
  fetchInfrastructureApiKeys,
  fetchInfrastructureApps,
  fetchInfrastructureAuditLogs,
  fetchInfrastructureCurrentApp,
  fetchInfrastructureDisputes,
  fetchInfrastructureEscrows,
  fetchInfrastructureEvents,
  fetchInfrastructureHealth,
  fetchInfrastructureMilestones,
  fetchInfrastructureProofs,
  fetchInfrastructureReady,
  fetchInfrastructureReviews,
  fetchInfrastructureTransactions,
  fetchInfrastructureWebhookDeliveries,
  fetchInfrastructureWebhookEndpoints,
  markInfrastructureEscrowFunded,
  moveInfrastructureAgreementToFundingRequired,
  refundInfrastructureEscrow,
  releaseInfrastructureEscrow,
  retryInfrastructureWebhookDelivery,
  reviewInfrastructureProof,
  revokeInfrastructureApiKey,
  updateInfrastructureWebhookEndpoint,
} from '@/lib/api';

type TabKey = 'overview' | 'developer' | 'data' | 'webhooks' | 'workbench' | 'admin';

const TABS: Array<{ id: TabKey; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'developer', label: 'Developer' },
  { id: 'data', label: 'Data' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'workbench', label: 'Workbench' },
  { id: 'admin', label: 'Admin' },
];

const SCOPE_GROUPS = [
  {
    label: 'Apps',
    scopes: ['apps:read'],
  },
  {
    label: 'Agreements',
    scopes: ['agreements:create', 'agreements:read', 'agreements:update', 'agreements:cancel', 'milestones:create', 'milestones:read'],
  },
  {
    label: 'Escrow',
    scopes: ['escrows:create', 'escrows:read', 'escrows:fund', 'escrows:release', 'escrows:refund', 'transactions:read'],
  },
  {
    label: 'Proofs and Disputes',
    scopes: ['proofs:create', 'proofs:read', 'proofs:review', 'disputes:create', 'disputes:read', 'disputes:resolve'],
  },
  {
    label: 'Events and Webhooks',
    scopes: ['events:read', 'webhooks:manage', 'webhooks:read'],
  },
  {
    label: 'Admin',
    scopes: ['admin:read', 'admin:write'],
  },
].map((group) => ({
  ...group,
  scopes: group.scopes.filter((scope) => INFRASTRUCTURE_API_KEY_SCOPES.includes(scope as any)),
}));

function formatDate(value?: string | null) {
  if (!value) {
    return 'Never';
  }

  return new Date(value).toLocaleString();
}

function truncate(value?: string | null, length = 10) {
  if (!value) {
    return '-';
  }

  return value.length > length * 2 ? `${value.slice(0, length)}...${value.slice(-length)}` : value;
}

function statusClass(status?: string | null) {
  const normalized = String(status || '').toLowerCase();
  if (['active', 'accepted', 'approved', 'funded', 'released', 'delivered', 'ok', 'confirmed'].includes(normalized)) {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  }
  if (['failed', 'rejected', 'disabled', 'suspended', 'refunded', 'disputed'].includes(normalized)) {
    return 'border-red-500/30 bg-red-500/10 text-red-200';
  }
  if (['sandbox', 'pending', 'pending_acceptance', 'funding_required', 'release_pending', 'refund_pending', 'under_review'].includes(normalized)) {
    return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200';
  }

  return 'border-slate-500/30 bg-slate-500/10 text-slate-200';
}

function Badge({ children, status }: { children: React.ReactNode; status?: string | null }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-medium uppercase tracking-wide ${statusClass(status || String(children))}`}>
      {children}
    </span>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="ui-panel min-w-0 overflow-hidden p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-white">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function DataTable({ columns, rows, empty }: {
  columns: string[];
  rows: Array<Array<React.ReactNode>>;
  empty: string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-agent-border">
      <table className="min-w-full divide-y divide-agent-border text-left text-sm">
        <thead className="bg-agent-bg/70 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            {columns.map((column) => (
              <th key={column} className="whitespace-nowrap px-3 py-2 font-medium">{column}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-agent-border bg-agent-card/40">
          {rows.length ? rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="max-w-[320px] whitespace-nowrap px-3 py-2 text-gray-300">
                  {cell}
                </td>
              ))}
            </tr>
          )) : (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-sm text-gray-500">{empty}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function metricCount(rows: unknown[] | undefined) {
  return rows?.length ?? 0;
}

export default function InfrastructureConsolePage() {
  const authToken = useStore((state) => state.authToken);
  const isAdmin = useStore((state) => state.isAdmin);
  const infrastructureApiKey = useStore((state) => state.infrastructureApiKey);
  const selectedInfrastructureAppId = useStore((state) => state.selectedInfrastructureAppId);
  const setInfrastructureApiKey = useStore((state) => state.setInfrastructureApiKey);
  const setSelectedInfrastructureAppId = useStore((state) => state.setSelectedInfrastructureAppId);

  const [tab, setTab] = useState<TabKey>('overview');
  const [apps, setApps] = useState<any[]>([]);
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [currentApp, setCurrentApp] = useState<any | null>(null);
  const [agreements, setAgreements] = useState<any[]>([]);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [escrows, setEscrows] = useState<any[]>([]);
  const [proofs, setProofs] = useState<any[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [disputes, setDisputes] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [webhookEndpoints, setWebhookEndpoints] = useState<any[]>([]);
  const [webhookDeliveries, setWebhookDeliveries] = useState<any[]>([]);
  const [adminHealth, setAdminHealth] = useState<any | null>(null);
  const [adminRows, setAdminRows] = useState<Record<string, any[]>>({});
  const [health, setHealth] = useState<any | null>(null);
  const [ready, setReady] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);

  const [appForm, setAppForm] = useState({
    name: 'Sandbox Project',
    slug: `sandbox-project-${Math.random().toString(36).slice(2, 7)}`,
    environment: 'sandbox' as 'sandbox' | 'production',
    defaultCurrency: 'CKB',
    defaultNetwork: 'sandbox',
  });
  const [apiKeyForm, setApiKeyForm] = useState({
    name: 'Sandbox integration key',
    scopes: [
      'apps:read',
      'agreements:create',
      'agreements:read',
      'agreements:update',
      'milestones:create',
      'milestones:read',
      'escrows:create',
      'escrows:read',
      'escrows:fund',
      'escrows:release',
      'escrows:refund',
      'proofs:create',
      'proofs:read',
      'proofs:review',
      'events:read',
      'webhooks:manage',
      'webhooks:read',
    ],
  });
  const [manualApiKey, setManualApiKey] = useState(infrastructureApiKey || '');
  const [webhookForm, setWebhookForm] = useState({
    url: '',
    description: 'Lifecycle receiver',
    subscribedEvents: ['agreement.created', 'proof.submitted', 'escrow.released', 'escrow.failed'],
  });
  const [workbench, setWorkbench] = useState({
    title: 'Sandbox escrow workflow',
    clientExternalId: 'client_demo',
    workerExternalId: 'worker_demo',
    amount: '1000',
    milestoneTitle: 'Demo milestone',
    proofContent: 'Work completed in sandbox.',
    proofLink: 'https://example.com/proof',
    lastAgreementId: '',
    lastMilestoneId: '',
    lastEscrowId: '',
    lastProofId: '',
  });

  const selectedApp = useMemo(
    () => apps.find((app) => app.id === selectedInfrastructureAppId) || currentApp || apps[0] || null,
    [apps, selectedInfrastructureAppId, currentApp],
  );

  async function runAction<T>(action: () => Promise<T>, success?: string) {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      if (success) {
        setNotice(success);
      }
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function loadManagement() {
    if (!authToken) {
      setApps([]);
      setApiKeys([]);
      return;
    }

    const [appList, keyList] = await Promise.all([
      fetchInfrastructureApps(100),
      fetchInfrastructureApiKeys(selectedInfrastructureAppId, 100).catch(() => ({ data: [] })),
    ]);
    setApps(appList.data);
    setApiKeys(keyList.data);
    if (!selectedInfrastructureAppId && appList.data[0]?.id) {
      setSelectedInfrastructureAppId(appList.data[0].id);
    }
  }

  async function loadAppScopedData() {
    if (!infrastructureApiKey) {
      setCurrentApp(null);
      setAgreements([]);
      setMilestones([]);
      setEscrows([]);
      setProofs([]);
      setReviews([]);
      setDisputes([]);
      setEvents([]);
      setAuditLogs([]);
      setTransactions([]);
      setWebhookEndpoints([]);
      setWebhookDeliveries([]);
      return;
    }

    const [
      resolvedApp,
      agreementList,
      milestoneList,
      escrowList,
      proofList,
      reviewList,
      disputeList,
      eventList,
      auditList,
      transactionList,
      endpointList,
      deliveryList,
    ] = await Promise.all([
      fetchInfrastructureCurrentApp(),
      fetchInfrastructureAgreements(50),
      fetchInfrastructureMilestones(50),
      fetchInfrastructureEscrows(50),
      fetchInfrastructureProofs(50),
      fetchInfrastructureReviews(50).catch(() => ({ data: [] })),
      fetchInfrastructureDisputes(50),
      fetchInfrastructureEvents(50),
      fetchInfrastructureAuditLogs(50),
      fetchInfrastructureTransactions(50),
      fetchInfrastructureWebhookEndpoints(50),
      fetchInfrastructureWebhookDeliveries(50),
    ]);

    setCurrentApp(resolvedApp);
    setAgreements(agreementList.data);
    setMilestones(milestoneList.data);
    setEscrows(escrowList.data);
    setProofs(proofList.data);
    setReviews(reviewList.data);
    setDisputes(disputeList.data);
    setEvents(eventList.data);
    setAuditLogs(auditList.data);
    setTransactions(transactionList.data);
    setWebhookEndpoints(endpointList.data);
    setWebhookDeliveries(deliveryList.data);
    setSelectedInfrastructureAppId(resolvedApp.id);
  }

  async function loadAdminData() {
    if (!authToken || !isAdmin) {
      setAdminHealth(null);
      setAdminRows({});
      return;
    }

    const [systemHealth, appsRows, escrowRows, eventRows, webhookRows, auditRows] = await Promise.all([
      fetchInfrastructureAdminHealth(),
      fetchInfrastructureAdminList('apps', 20),
      fetchInfrastructureAdminList('escrows', 20),
      fetchInfrastructureAdminList('events', 20),
      fetchInfrastructureAdminList('webhook-deliveries', 20),
      fetchInfrastructureAdminList('audit-logs', 20),
    ]);

    setAdminHealth(systemHealth);
    setAdminRows({
      apps: appsRows.data,
      escrows: escrowRows.data,
      events: eventRows.data,
      webhooks: webhookRows.data,
      auditLogs: auditRows.data,
    });
  }

  async function refreshAll() {
    await runAction(async () => {
      const [healthResult, readyResult] = await Promise.all([
        fetchInfrastructureHealth().catch(() => null),
        fetchInfrastructureReady().catch(() => null),
      ]);
      setHealth(healthResult);
      setReady(readyResult);
      await Promise.all([
        loadManagement(),
        loadAppScopedData(),
        loadAdminData(),
      ]);
    });
  }

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, infrastructureApiKey, isAdmin]);

  useEffect(() => {
    if (!authToken) {
      return;
    }

    void runAction(loadManagement);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInfrastructureAppId]);

  async function handleCreateApp(event: React.FormEvent) {
    event.preventDefault();
    await runAction(async () => {
      const created = await createInfrastructureApp(appForm);
      setSelectedInfrastructureAppId(created.id);
      await loadManagement();
      return created;
    }, 'App created.');
  }

  async function handleCreateApiKey(event: React.FormEvent) {
    event.preventDefault();
    const appId = selectedApp?.id;
    if (!appId) {
      setError('Create or select an app first.');
      return;
    }

    await runAction(async () => {
      const created = await createInfrastructureApiKey({
        appId,
        name: apiKeyForm.name,
        scopes: apiKeyForm.scopes,
      });
      setRevealedKey(created.key);
      setInfrastructureApiKey(created.key);
      setManualApiKey(created.key);
      await loadManagement();
      await loadAppScopedData();
      return created;
    }, 'API key created. The raw key is shown once.');
  }

  async function copyText(value: string, message = 'Copied.') {
    await navigator.clipboard.writeText(value);
    setNotice(message);
  }

  function toggleScope(scope: string) {
    setApiKeyForm((prev) => ({
      ...prev,
      scopes: prev.scopes.includes(scope)
        ? prev.scopes.filter((item) => item !== scope)
        : [...prev.scopes, scope],
    }));
  }

  async function handleConnectApiKey(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = manualApiKey.trim();
    if (!trimmed) {
      setInfrastructureApiKey(null);
      return;
    }

    await runAction(async () => {
      const app = await fetchInfrastructureCurrentApp(trimmed);
      setInfrastructureApiKey(trimmed);
      setSelectedInfrastructureAppId(app.id);
      return app;
    }, 'Infrastructure API key connected.');
  }

  async function handleCreateWebhook(event: React.FormEvent) {
    event.preventDefault();
    await runAction(async () => {
      const created = await createInfrastructureWebhookEndpoint(webhookForm);
      await loadAppScopedData();
      return created;
    }, 'Webhook endpoint created. Copy the secret now if shown in the response history.');
  }

  async function workbenchStep(step: 'agreement' | 'milestone' | 'fundingRequired' | 'escrow' | 'funded' | 'proof' | 'approve' | 'reject' | 'release' | 'refund') {
    await runAction(async () => {
      if (step === 'agreement') {
        const agreement = await createInfrastructureAgreement({
          title: workbench.title,
          description: 'Created from the sandbox workbench.',
          clientExternalId: workbench.clientExternalId,
          workerExternalId: workbench.workerExternalId,
          totalAmount: workbench.amount,
          currency: 'CKB',
          releaseMode: 'milestone',
          disputeMode: 'app_managed',
          metadata: { source: 'console-workbench' },
        }, createIdempotencyKey('agreement'));
        await acceptInfrastructureAgreement(agreement.id).catch(() => null);
        setWorkbench((prev) => ({ ...prev, lastAgreementId: agreement.id }));
      }

      if (step === 'milestone') {
        if (!workbench.lastAgreementId) throw new Error('Create an agreement first.');
        const milestone = await createInfrastructureMilestone(workbench.lastAgreementId, {
          title: workbench.milestoneTitle,
          description: 'Sandbox milestone',
          amount: workbench.amount,
          currency: 'CKB',
          order: 1,
        });
        setWorkbench((prev) => ({ ...prev, lastMilestoneId: milestone.id }));
      }

      if (step === 'fundingRequired') {
        if (!workbench.lastAgreementId) throw new Error('Create an agreement first.');
        await moveInfrastructureAgreementToFundingRequired(workbench.lastAgreementId);
      }

      if (step === 'escrow') {
        if (!workbench.lastAgreementId || !workbench.lastMilestoneId) throw new Error('Create an agreement and milestone first.');
        const escrow = await createInfrastructureEscrow({
          agreementId: workbench.lastAgreementId,
          milestoneId: workbench.lastMilestoneId,
          amount: workbench.amount,
          currency: 'CKB',
          rail: 'mock',
          network: 'sandbox',
        }, createIdempotencyKey('escrow'));
        setWorkbench((prev) => ({ ...prev, lastEscrowId: escrow.id }));
      }

      if (step === 'funded') {
        if (!workbench.lastEscrowId) throw new Error('Create an escrow first.');
        await markInfrastructureEscrowFunded(workbench.lastEscrowId);
      }

      if (step === 'proof') {
        if (!workbench.lastAgreementId || !workbench.lastMilestoneId) throw new Error('Create an agreement and milestone first.');
        const proof = await createInfrastructureProof({
          agreementId: workbench.lastAgreementId,
          milestoneId: workbench.lastMilestoneId,
          submittedByExternalId: workbench.workerExternalId,
          type: 'url',
          content: workbench.proofContent,
          links: [workbench.proofLink],
          fileRefs: [],
        }, createIdempotencyKey('proof'));
        setWorkbench((prev) => ({ ...prev, lastProofId: proof.id }));
      }

      if (step === 'approve' || step === 'reject') {
        if (!workbench.lastProofId) throw new Error('Submit proof first.');
        await reviewInfrastructureProof(workbench.lastProofId, {
          reviewerExternalId: workbench.clientExternalId,
          decision: step === 'approve' ? 'approved' : 'rejected',
          note: step === 'approve' ? 'Approved from sandbox workbench.' : 'Rejected from sandbox workbench.',
        });
      }

      if (step === 'release') {
        if (!workbench.lastEscrowId) throw new Error('Create and fund an escrow first.');
        await releaseInfrastructureEscrow(workbench.lastEscrowId, createIdempotencyKey('release'));
      }

      if (step === 'refund') {
        if (!workbench.lastEscrowId) throw new Error('Create and fund an escrow first.');
        await refundInfrastructureEscrow(workbench.lastEscrowId, createIdempotencyKey('refund'));
      }

      await loadAppScopedData();
    }, 'Sandbox action completed.');
  }

  const appScopedReady = Boolean(infrastructureApiKey);
  const dashboardMetrics = [
    ['Agreements', metricCount(agreements)],
    ['Milestones', metricCount(milestones)],
    ['Escrows', metricCount(escrows)],
    ['Proofs', metricCount(proofs)],
    ['Reviews', metricCount(reviews)],
    ['Disputes', metricCount(disputes)],
    ['Events', metricCount(events)],
    ['Webhook deliveries', metricCount(webhookDeliveries)],
  ];

  return (
    <div className="min-h-screen">
      <nav className="app-nav">
        <div className="app-nav-inner">
          <BrandLogo />
          <NavbarMenu>
            <Link href="/console" className="app-nav-link-accent">Console</Link>
            <Link href="/docs" className="app-nav-link">Docs</Link>
            <Link href="/openapi.json" className="app-nav-link">OpenAPI</Link>
          </NavbarMenu>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <section className="ui-panel p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="ui-kicker mb-2">Infrastructure Console</div>
              <h1 className="text-2xl font-semibold text-white">App-scoped backend operations</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">
                Manage projects, API keys, webhooks, sandbox escrow flows, and admin monitoring for the `/v1` infrastructure API.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <select
                className="ui-input min-w-[260px]"
                value={selectedApp?.id || ''}
                onChange={(event) => setSelectedInfrastructureAppId(event.target.value || null)}
              >
                <option value="">No app selected</option>
                {apps.map((app) => (
                  <option key={app.id} value={app.id}>{app.name} ({app.environment})</option>
                ))}
              </select>
              {selectedApp ? <Badge status={selectedApp.environment}>{selectedApp.environment}</Badge> : null}
              {selectedApp ? <Badge status={selectedApp.status}>{selectedApp.status}</Badge> : null}
              <button type="button" className="ui-button-secondary-sm" onClick={() => void refreshAll()} disabled={loading}>
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${tab === item.id ? 'border-agent-accent bg-agent-accent/15 text-white' : 'border-agent-border bg-agent-bg/40 text-gray-400 hover:text-white'}`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        {error ? <div className="ui-alert-error">{error}</div> : null}
        {notice ? <div className="ui-alert-success">{notice}</div> : null}

        {tab === 'overview' ? (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-4">
              {dashboardMetrics.map(([label, value]) => (
                <div key={label} className="ui-panel p-4">
                  <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
                  <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
                </div>
              ))}
            </div>

            <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
              <Section title="Runtime">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="ui-panel-soft p-4">
                    <div className="text-xs uppercase tracking-wide text-gray-500">Health</div>
                    <div className="mt-2"><Badge status={health?.status}>{health?.status || 'unknown'}</Badge></div>
                  </div>
                  <div className="ui-panel-soft p-4">
                    <div className="text-xs uppercase tracking-wide text-gray-500">Readiness</div>
                    <div className="mt-2"><Badge status={ready?.status}>{ready?.status || 'unknown'}</Badge></div>
                  </div>
                </div>
              </Section>

              <Section title="Current App">
                {selectedApp ? (
                  <div className="grid gap-2 text-sm text-gray-300">
                    <div><span className="text-gray-500">Name:</span> {selectedApp.name}</div>
                    <div><span className="text-gray-500">App ID:</span> <code>{selectedApp.id}</code></div>
                    <div><span className="text-gray-500">Slug:</span> {selectedApp.slug}</div>
                    <div><span className="text-gray-500">Defaults:</span> {selectedApp.defaultCurrency} on {selectedApp.defaultNetwork}</div>
                  </div>
                ) : (
                  <div className="text-sm text-gray-500">Create or connect an app to populate app-scoped data.</div>
                )}
              </Section>
            </div>
          </div>
        ) : null}

        {tab === 'developer' ? (
          <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-5">
              <Section title="Wallet Management Session">
                <p className="mb-4 text-sm text-gray-400">Use wallet auth to create apps and manage API keys.</p>
                <WalletConnect />
              </Section>

              <Section title="Create App / Project">
                <form className="space-y-3" onSubmit={handleCreateApp}>
                  <input className="ui-input" value={appForm.name} onChange={(event) => setAppForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="App name" />
                  <input className="ui-input" value={appForm.slug} onChange={(event) => setAppForm((prev) => ({ ...prev, slug: event.target.value }))} placeholder="app-slug" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <select className="ui-input" value={appForm.environment} onChange={(event) => setAppForm((prev) => ({ ...prev, environment: event.target.value as any, defaultNetwork: event.target.value === 'production' ? 'mainnet' : 'sandbox' }))}>
                      <option value="sandbox">sandbox</option>
                      <option value="production">production</option>
                    </select>
                    <input className="ui-input" value={appForm.defaultCurrency} onChange={(event) => setAppForm((prev) => ({ ...prev, defaultCurrency: event.target.value }))} />
                  </div>
                  <button type="submit" className="ui-button-primary-sm" disabled={!authToken || loading}>Create App</button>
                </form>
              </Section>

              <Section title="Connect Existing API Key">
                <form className="space-y-3" onSubmit={handleConnectApiKey}>
                  <div className="flex gap-2">
                    <input
                      className="ui-input font-mono"
                      type={showApiKeyInput ? 'text' : 'password'}
                      value={manualApiKey}
                      onChange={(event) => setManualApiKey(event.target.value)}
                      placeholder="pa_test_..."
                    />
                    <button type="button" className="ui-icon-button" onClick={() => setShowApiKeyInput((value) => !value)} aria-label="Toggle API key visibility">
                      {showApiKeyInput ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" className="ui-button-secondary-sm">Use Key</button>
                    <button type="button" className="ui-button-plain" onClick={() => { setManualApiKey(''); setInfrastructureApiKey(null); }}>Clear</button>
                  </div>
                </form>
              </Section>
            </div>

            <div className="space-y-5">
              <Section title="API Key Creation" action={selectedApp ? <Badge status={selectedApp.environment}>{selectedApp.environment}</Badge> : null}>
                <form className="space-y-4" onSubmit={handleCreateApiKey}>
                  <input className="ui-input" value={apiKeyForm.name} onChange={(event) => setApiKeyForm((prev) => ({ ...prev, name: event.target.value }))} />
                  <div className="grid gap-4 lg:grid-cols-2">
                    {SCOPE_GROUPS.map((group) => (
                      <div key={group.label} className="ui-panel-soft p-3">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{group.label}</div>
                        <div className="space-y-2">
                          {group.scopes.map((scope) => (
                            <label key={scope} className="flex items-center gap-2 text-sm text-gray-300">
                              <input type="checkbox" checked={apiKeyForm.scopes.includes(scope)} onChange={() => toggleScope(scope)} />
                              <code>{scope}</code>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button type="submit" className="ui-button-primary-sm" disabled={!selectedApp || !authToken || !apiKeyForm.scopes.length}>
                    <KeyRound className="h-4 w-4" />
                    Create API Key
                  </button>
                </form>
              </Section>

              {revealedKey ? (
                <Section title="Copy-Once API Key">
                  <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-yellow-100">
                      <AlertTriangle className="h-4 w-4" />
                      This key is only shown once.
                    </div>
                    <div className="flex gap-2">
                      <code className="min-w-0 flex-1 overflow-x-auto rounded bg-agent-bg px-3 py-2 text-xs text-gray-200">{revealedKey}</code>
                      <button type="button" className="ui-button-secondary-sm" onClick={() => void copyText(revealedKey, 'API key copied.')}>
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </Section>
              ) : null}

              <Section title="API Keys">
                <DataTable
                  columns={['Name', 'Masked', 'Scopes', 'Last Used', 'Status', 'Action']}
                  empty="No API keys for the selected app."
                  rows={apiKeys
                    .filter((key) => !selectedApp?.id || key.appId === selectedApp.id)
                    .map((key) => [
                      key.name,
                      <code key="masked">{key.maskedKey}</code>,
                      <span key="scopes" className="text-xs">{key.scopes?.length || 0} scopes</span>,
                      formatDate(key.lastUsedAt),
                      <Badge key="status" status={key.status}>{key.status}</Badge>,
                      <button key="revoke" type="button" className="ui-button-ghost-danger px-3 py-1.5 text-xs" onClick={() => void runAction(async () => { await revokeInfrastructureApiKey(key.id); await loadManagement(); }, 'API key revoked.')}>
                        <Trash2 className="h-3 w-3" />
                        Revoke
                      </button>,
                    ])}
                />
              </Section>
            </div>
          </div>
        ) : null}

        {tab === 'data' ? (
          <div className="space-y-5">
            {!appScopedReady ? <div className="ui-alert-warning">Connect an app API key in the Developer tab to load app-scoped dashboards.</div> : null}
            <div className="grid gap-5 xl:grid-cols-2">
              <Section title="Agreements">
                <DataTable columns={['Title', 'Status', 'Amount', 'Updated']} empty="No agreements." rows={agreements.map((item) => [item.title, <Badge key="status" status={item.status}>{item.status}</Badge>, `${item.totalAmount} ${item.currency}`, formatDate(item.updatedAt)])} />
              </Section>
              <Section title="Milestones">
                <DataTable columns={['Title', 'Status', 'Amount', 'Agreement']} empty="No milestones." rows={milestones.map((item) => [item.title, <Badge key="status" status={item.status}>{item.status}</Badge>, `${item.amount} ${item.currency}`, <code key="id">{truncate(item.agreementId)}</code>])} />
              </Section>
              <Section title="Escrows">
                <DataTable columns={['Rail', 'Status', 'Amount', 'Tx']} empty="No escrows." rows={escrows.map((item) => [item.rail, <Badge key="status" status={item.status}>{item.status}</Badge>, `${item.amount} ${item.currency}`, <code key="tx">{truncate(item.releaseTxHash || item.refundTxHash || item.lockTxHash)}</code>])} />
              </Section>
              <Section title="Proofs">
                <DataTable columns={['Type', 'Status', 'Submitted By', 'Milestone']} empty="No proofs." rows={proofs.map((item) => [item.type, <Badge key="status" status={item.status}>{item.status}</Badge>, item.submittedByExternalId, <code key="id">{truncate(item.milestoneId)}</code>])} />
              </Section>
              <Section title="Reviews">
                <DataTable columns={['Decision', 'Reviewer', 'Proof', 'Created']} empty="No reviews." rows={reviews.map((item) => [<Badge key="decision" status={item.decision}>{item.decision}</Badge>, item.reviewerExternalId, <code key="id">{truncate(item.proofSubmissionId)}</code>, formatDate(item.createdAt)])} />
              </Section>
              <Section title="Disputes">
                <DataTable columns={['Status', 'Opened By', 'Reason', 'Created']} empty="No disputes." rows={disputes.map((item) => [<Badge key="status" status={item.status}>{item.status}</Badge>, item.openedByExternalId, truncate(item.reason, 20), formatDate(item.createdAt)])} />
              </Section>
              <Section title="Events">
                <DataTable columns={['Type', 'Agreement', 'Created']} empty="No events." rows={events.map((item) => [<code key="type">{item.type}</code>, <code key="id">{truncate(item.agreementId)}</code>, formatDate(item.createdAt)])} />
              </Section>
              <Section title="Audit Logs">
                <DataTable columns={['Action', 'Actor', 'Target', 'Created']} empty="No audit logs." rows={auditLogs.map((item) => [<code key="action">{item.action}</code>, item.actorType, `${item.targetType}:${truncate(item.targetId)}`, formatDate(item.createdAt)])} />
              </Section>
              <Section title="Transactions">
                <DataTable columns={['Type', 'Status', 'Rail', 'Amount']} empty="No transactions." rows={transactions.map((item) => [item.type, <Badge key="status" status={item.status}>{item.status}</Badge>, item.rail, `${item.amount} ${item.currency}`])} />
              </Section>
              <Section title="Webhook Deliveries">
                <DataTable columns={['Event', 'Status', 'Attempts', 'Next Retry']} empty="No webhook deliveries." rows={webhookDeliveries.map((item) => [<code key="type">{item.eventType}</code>, <Badge key="status" status={item.status}>{item.status}</Badge>, item.attemptCount, formatDate(item.nextRetryAt)])} />
              </Section>
            </div>
          </div>
        ) : null}

        {tab === 'webhooks' ? (
          <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
            <Section title="Create Webhook Endpoint">
              <form className="space-y-4" onSubmit={handleCreateWebhook}>
                <input className="ui-input" value={webhookForm.url} onChange={(event) => setWebhookForm((prev) => ({ ...prev, url: event.target.value }))} placeholder="https://example.com/webhooks/pactagent" />
                <input className="ui-input" value={webhookForm.description} onChange={(event) => setWebhookForm((prev) => ({ ...prev, description: event.target.value }))} />
                <div className="grid max-h-[420px] gap-2 overflow-y-auto pr-2 sm:grid-cols-2">
                  {INFRASTRUCTURE_EVENT_TYPES.map((eventType) => (
                    <label key={eventType} className="flex items-center gap-2 rounded-lg border border-agent-border bg-agent-bg/40 px-3 py-2 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={webhookForm.subscribedEvents.includes(eventType)}
                        onChange={(event) => setWebhookForm((prev) => ({
                          ...prev,
                          subscribedEvents: event.target.checked
                            ? [...prev.subscribedEvents, eventType]
                            : prev.subscribedEvents.filter((item) => item !== eventType),
                        }))}
                      />
                      <code>{eventType}</code>
                    </label>
                  ))}
                </div>
                <button type="submit" className="ui-button-primary-sm" disabled={!appScopedReady || !webhookForm.subscribedEvents.length}>
                  <Send className="h-4 w-4" />
                  Create Endpoint
                </button>
              </form>
            </Section>

            <div className="space-y-5">
              <Section title="Signing Contract">
                <div className="space-y-3 text-sm text-gray-300">
                  <div>Headers sent by `/v1` webhook delivery:</div>
                  <code className="block rounded bg-agent-bg p-3 text-xs text-agent-accent">PactAgent-Event-Id</code>
                  <code className="block rounded bg-agent-bg p-3 text-xs text-agent-accent">PactAgent-Timestamp</code>
                  <code className="block rounded bg-agent-bg p-3 text-xs text-agent-accent">PactAgent-Signature</code>
                  <div className="text-gray-500">Signature payload is <code>timestamp + "." + rawBody</code> using HMAC SHA256.</div>
                </div>
              </Section>

              <Section title="Endpoints">
                <DataTable
                  columns={['URL', 'Events', 'Status', 'Action']}
                  empty="No webhook endpoints."
                  rows={webhookEndpoints.map((endpoint) => [
                    <span key="url" className="inline-block max-w-[280px] truncate">{endpoint.url}</span>,
                    endpoint.subscribedEvents?.length || 0,
                    <Badge key="status" status={endpoint.status}>{endpoint.status}</Badge>,
                    <div key="actions" className="flex gap-2">
                      <button type="button" className="ui-button-secondary-sm px-3 py-1.5 text-xs" onClick={() => void runAction(async () => { await updateInfrastructureWebhookEndpoint(endpoint.id, { status: endpoint.status === 'active' ? 'disabled' : 'active' }); await loadAppScopedData(); }, 'Webhook endpoint updated.')}>
                        {endpoint.status === 'active' ? 'Disable' : 'Enable'}
                      </button>
                      <button type="button" className="ui-button-ghost-danger px-3 py-1.5 text-xs" onClick={() => void runAction(async () => { await deleteInfrastructureWebhookEndpoint(endpoint.id); await loadAppScopedData(); }, 'Webhook endpoint disabled.')}>Delete</button>
                    </div>,
                  ])}
                />
              </Section>

              <Section title="Deliveries">
                <DataTable
                  columns={['Event', 'Status', 'Attempts', 'Response', 'Action']}
                  empty="No deliveries."
                  rows={webhookDeliveries.map((delivery) => [
                    <code key="event">{delivery.eventType}</code>,
                    <Badge key="status" status={delivery.status}>{delivery.status}</Badge>,
                    delivery.attemptCount,
                    delivery.responseStatus || delivery.lastError || '-',
                    <button key="retry" type="button" className="ui-button-secondary-sm px-3 py-1.5 text-xs" disabled={delivery.status === 'delivered'} onClick={() => void runAction(async () => { await retryInfrastructureWebhookDelivery(delivery.id); await loadAppScopedData(); }, 'Webhook delivery queued for retry.')}>
                      <RotateCcw className="h-3 w-3" />
                      Retry
                    </button>,
                  ])}
                />
              </Section>
            </div>
          </div>
        ) : null}

        {tab === 'workbench' ? (
          <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
            <Section title="Sandbox Inputs">
              <div className="space-y-3">
                <input className="ui-input" value={workbench.title} onChange={(event) => setWorkbench((prev) => ({ ...prev, title: event.target.value }))} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <input className="ui-input" value={workbench.clientExternalId} onChange={(event) => setWorkbench((prev) => ({ ...prev, clientExternalId: event.target.value }))} />
                  <input className="ui-input" value={workbench.workerExternalId} onChange={(event) => setWorkbench((prev) => ({ ...prev, workerExternalId: event.target.value }))} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <input className="ui-input" value={workbench.amount} onChange={(event) => setWorkbench((prev) => ({ ...prev, amount: event.target.value }))} />
                  <input className="ui-input" value={workbench.milestoneTitle} onChange={(event) => setWorkbench((prev) => ({ ...prev, milestoneTitle: event.target.value }))} />
                </div>
                <textarea className="ui-input min-h-24" value={workbench.proofContent} onChange={(event) => setWorkbench((prev) => ({ ...prev, proofContent: event.target.value }))} />
                <input className="ui-input" value={workbench.proofLink} onChange={(event) => setWorkbench((prev) => ({ ...prev, proofLink: event.target.value }))} />
              </div>
            </Section>

            <Section title="Mock Escrow Flow">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ['agreement', 'Create agreement'],
                  ['milestone', 'Create milestone'],
                  ['fundingRequired', 'Move funding required'],
                  ['escrow', 'Create mock escrow'],
                  ['funded', 'Mark funded'],
                  ['proof', 'Submit proof'],
                  ['approve', 'Approve proof'],
                  ['reject', 'Reject proof'],
                  ['release', 'Release escrow'],
                  ['refund', 'Refund escrow'],
                ].map(([step, label]) => (
                  <button key={step} type="button" className="ui-button-secondary-sm justify-start" disabled={!appScopedReady || loading} onClick={() => void workbenchStep(step as any)}>
                    <Play className="h-4 w-4" />
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-5 grid gap-3 text-sm text-gray-300 sm:grid-cols-2">
                <div><span className="text-gray-500">Agreement:</span> <code>{truncate(workbench.lastAgreementId)}</code></div>
                <div><span className="text-gray-500">Milestone:</span> <code>{truncate(workbench.lastMilestoneId)}</code></div>
                <div><span className="text-gray-500">Escrow:</span> <code>{truncate(workbench.lastEscrowId)}</code></div>
                <div><span className="text-gray-500">Proof:</span> <code>{truncate(workbench.lastProofId)}</code></div>
              </div>
            </Section>
          </div>
        ) : null}

        {tab === 'admin' ? (
          <div className="space-y-5">
            {!isAdmin ? <div className="ui-alert-warning">Admin monitoring requires an authenticated internal admin wallet.</div> : null}
            <Section title="System Health" action={<Shield className="h-5 w-5 text-agent-accent" />}>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="ui-panel-soft p-4"><div className="text-xs text-gray-500">Status</div><div className="mt-2"><Badge status={adminHealth?.status}>{adminHealth?.status || 'unknown'}</Badge></div></div>
                <div className="ui-panel-soft p-4"><div className="text-xs text-gray-500">Apps</div><div className="mt-2 text-xl text-white">{adminHealth?.counts?.apps ?? '-'}</div></div>
                <div className="ui-panel-soft p-4"><div className="text-xs text-gray-500">Escrows</div><div className="mt-2 text-xl text-white">{adminHealth?.counts?.escrows ?? '-'}</div></div>
                <div className="ui-panel-soft p-4"><div className="text-xs text-gray-500">Failed Webhooks</div><div className="mt-2 text-xl text-white">{adminHealth?.counts?.failedWebhookDeliveries ?? '-'}</div></div>
              </div>
            </Section>

            <div className="grid gap-5 xl:grid-cols-2">
              <Section title="Apps">
                <DataTable columns={['Name', 'Environment', 'Status', 'Created']} empty="No apps." rows={(adminRows.apps || []).map((item) => [item.name, <Badge key="env" status={item.environment}>{item.environment}</Badge>, <Badge key="status" status={item.status}>{item.status}</Badge>, formatDate(item.createdAt)])} />
              </Section>
              <Section title="Escrows">
                <DataTable columns={['App', 'Rail', 'Status', 'Amount']} empty="No escrows." rows={(adminRows.escrows || []).map((item) => [<code key="app">{truncate(item.appId)}</code>, item.rail, <Badge key="status" status={item.status}>{item.status}</Badge>, `${item.amount} ${item.currency}`])} />
              </Section>
              <Section title="Events">
                <DataTable columns={['App', 'Type', 'Created']} empty="No events." rows={(adminRows.events || []).map((item) => [<code key="app">{truncate(item.appId)}</code>, <code key="type">{item.type}</code>, formatDate(item.createdAt)])} />
              </Section>
              <Section title="Failed / Recent Webhooks">
                <DataTable columns={['App', 'Event', 'Status', 'Attempts']} empty="No webhook deliveries." rows={(adminRows.webhooks || []).map((item) => [<code key="app">{truncate(item.appId)}</code>, <code key="event">{item.eventType}</code>, <Badge key="status" status={item.status}>{item.status}</Badge>, item.attemptCount])} />
              </Section>
              <Section title="Audit Logs">
                <DataTable columns={['App', 'Action', 'Target', 'Created']} empty="No audit logs." rows={(adminRows.auditLogs || []).map((item) => [<code key="app">{truncate(item.appId)}</code>, <code key="action">{item.action}</code>, `${item.targetType}:${truncate(item.targetId)}`, formatDate(item.createdAt)])} />
              </Section>
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-2 text-xs text-gray-600">
          <Check className="h-3 w-3" />
          Console uses `/v1` app-scoped APIs. Product experiences belong to integrating applications.
        </div>
      </main>
    </div>
  );
}
