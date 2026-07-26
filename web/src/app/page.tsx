'use client';

import Link from 'next/link';
import { WalletConnect } from '@/features/wallet';
import { NavbarMenu } from '@/components/NavbarMenu';
import { BrandLogo } from '@/components/BrandLogo';
import { useStore } from '@/lib/store';
import { CheckCircleIcon, LinkIcon, ShieldCheckIcon } from '@/components/Icons';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '/api';
const serverOrigin = API_BASE.startsWith('http')
  ? API_BASE.replace(/\/api\/?$/, '')
  : '';

function apiHref(path: string) {
  return serverOrigin ? `${serverOrigin}${path}` : path;
}

export default function HomePage() {
  const walletAddress = useStore((s) => s.walletAddress);
  const isAdmin = useStore((s) => s.isAdmin);

  return (
    <div className="min-h-screen">
      <nav className="app-nav">
        <div className="app-nav-inner">
          <BrandLogo />
          <NavbarMenu>
            <Link href={apiHref('/docs')} className="app-nav-link">API Docs</Link>
            <Link href={apiHref('/openapi.json')} className="app-nav-link">OpenAPI</Link>
            {walletAddress && isAdmin ? <Link href="/admin" className="app-nav-link-accent">Admin</Link> : null}
            {walletAddress ? <Link href="/dashboard" className="app-nav-link">Legacy Dashboard</Link> : null}
          </NavbarMenu>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <section className="mb-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="ui-panel p-6 sm:p-8">
            <div className="ui-kicker mb-3">Infrastructure Backend</div>
            <h1 className="max-w-3xl text-3xl font-semibold leading-tight text-white sm:text-4xl">
              PactAgent infrastructure for app-scoped agreements, escrow, proof, disputes, events, and webhooks.
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-gray-400">
              The primary integration surface is the `/v1` API. External products create Apps, issue scoped API keys,
              create agreements and milestones, manage sandbox/mock escrow, receive signed webhooks, and query their
              own lifecycle events without crossing tenant boundaries.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/console" className="ui-button-primary">Open Console</Link>
              <Link href={apiHref('/docs')} className="ui-button-primary">Open API Docs</Link>
              <Link href={apiHref('/openapi.json')} className="ui-button-secondary">Download OpenAPI</Link>
              {walletAddress && isAdmin ? <Link href="/admin" className="ui-button-secondary">Admin Monitoring</Link> : null}
            </div>
          </div>

          <div className="ui-panel p-6 sm:p-8">
            <h2 className="text-lg font-semibold text-white">Operator Access</h2>
            <p className="mt-2 text-sm text-gray-400">
              Wallet access is retained for internal app/admin management. Product-user workflows and legacy agreement screens
              are secondary to the infrastructure API.
            </p>
            <div className="mt-5">
              <WalletConnect />
            </div>
            {walletAddress ? (
              <div className="mt-5 rounded-lg border border-agent-border bg-agent-bg/60 p-4 text-sm text-gray-300">
                Connected wallet: <span className="break-all text-gray-100">{walletAddress}</span>
              </div>
            ) : null}
          </div>
        </section>

        <section className="mb-8 grid gap-4 md:grid-cols-3">
          {[
            {
              title: 'Tenant Boundary',
              body: 'Every external API request resolves to one appId from the API key. Agreements, milestones, proof, disputes, events, webhooks, audit logs, and escrow records stay scoped to that app.',
              icon: ShieldCheckIcon,
            },
            {
              title: 'Lifecycle API',
              body: 'Create agreements, attach milestones, create sandbox/mock escrow, submit proof, approve or reject proof, resolve disputes, and release or refund escrow with idempotency.',
              icon: CheckCircleIcon,
            },
            {
              title: 'Signed Integrations',
              body: 'Lifecycle events are queryable and delivered through HMAC-signed webhooks with SSRF checks, retry state, delivery history, and bounded retry windows.',
              icon: LinkIcon,
            },
          ].map((item) => {
            const Icon = item.icon;

            return (
              <div key={item.title} className="ui-panel p-5">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-agent-accent/15 text-agent-accent">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="text-base font-semibold text-white">{item.title}</h2>
                <p className="mt-2 text-sm leading-6 text-gray-400">{item.body}</p>
              </div>
            );
          })}
        </section>

        <section className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="ui-panel p-5">
            <h2 className="text-base font-semibold text-white">Core API Surface</h2>
            <div className="mt-4 grid gap-2 text-sm text-gray-300">
              {[
                'POST /v1/agreements',
                'POST /v1/agreements/:id/milestones',
                'POST /v1/escrows',
                'POST /v1/proofs',
                'POST /v1/proofs/:id/review',
                'POST /v1/disputes/:id/resolve',
                'GET /v1/events',
                'POST /v1/webhook-endpoints',
              ].map((path) => (
                <code key={path} className="rounded border border-agent-border bg-agent-bg/70 px-3 py-2 text-agent-accent">
                  {path}
                </code>
              ))}
            </div>
          </div>

          <div className="ui-panel p-5">
            <h2 className="text-base font-semibold text-white">Legacy Product Surface</h2>
            <p className="mt-2 text-sm leading-6 text-gray-400">
              The old `/api` wallet product routes can be enabled for migration with `ENABLE_LEGACY_PRODUCT_API=true`,
              but production infrastructure deployments should keep them disabled and integrate through `/v1`.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/console" className="ui-button-secondary">Open Infrastructure Console</Link>
              {walletAddress ? <Link href="/dashboard" className="ui-button-secondary">Open Legacy Dashboard</Link> : null}
              {walletAddress && isAdmin ? <Link href="/admin" className="ui-button-secondary">Open Admin</Link> : null}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
