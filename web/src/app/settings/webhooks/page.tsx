'use client';

import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { NavbarMenu } from '@/components/NavbarMenu';

export default function WebhookSettingsPage() {
  return (
    <div className="min-h-screen">
      <nav className="app-nav">
        <div className="app-nav-inner">
          <BrandLogo />
          <NavbarMenu>
            <Link href="/console" className="app-nav-link-accent">Infrastructure Console</Link>
            <Link href="/dashboard" className="app-nav-link">Legacy Dashboard</Link>
          </NavbarMenu>
        </div>
      </nav>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <section className="ui-panel p-6">
          <div className="ui-kicker mb-3">
            <ShieldCheck className="h-4 w-4" />
            `/v1` Webhooks
          </div>
          <h1 className="text-2xl font-semibold text-white">Webhook management moved to the infrastructure console.</h1>
          <p className="mt-3 text-sm leading-6 text-gray-400">
            The old settings page used legacy `/api` event names and signing headers. Use the console webhook tab for
            current `/v1` events such as `agreement.created`, `proof.submitted`, `escrow.released`, and `escrow.failed`.
          </p>

          <div className="mt-5 rounded-lg border border-agent-border bg-agent-bg/60 p-4 text-sm text-gray-300">
            Current delivery headers are:
            <div className="mt-3 grid gap-2">
              <code className="rounded bg-agent-card px-3 py-2 text-agent-accent">PactAgent-Event-Id</code>
              <code className="rounded bg-agent-card px-3 py-2 text-agent-accent">PactAgent-Timestamp</code>
              <code className="rounded bg-agent-card px-3 py-2 text-agent-accent">PactAgent-Signature</code>
            </div>
          </div>

          <div className="mt-6">
            <Link href="/console" className="ui-button-primary">
              Open Webhook Console
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
