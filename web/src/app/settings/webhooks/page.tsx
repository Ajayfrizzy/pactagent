'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AgentIcon, ArrowLeftIcon, BoltIcon, LinkIcon } from '@/components/Icons';
import { NavbarMenu } from '@/components/NavbarMenu';
import { createWebhook, fetchWebhookDeliveries, fetchWebhooks } from '@/lib/api';
import { useStore } from '@/lib/store';

const EVENT_OPTIONS = [
  'agreement.created',
  'agreement.funded',
  'agreement.completed',
  'agreement.refunded',
  'agreement.expired',
  'agreement.proof_submitted',
  'review.action_taken',
  'dispute.opened',
  'dispute.updated',
  'settlement.pending',
  'settlement.confirmed',
  'settlement.failed',
];

export default function WebhookSettingsPage() {
  const authToken = useStore((s) => s.authToken);
  const [endpoints, setEndpoints] = useState<any[]>([]);
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    label: '',
    targetUrl: '',
    eventTypes: ['agreement.funded', 'agreement.proof_submitted', 'settlement.confirmed'],
  });

  useEffect(() => {
    async function load() {
      if (!authToken) {
        setLoading(false);
        return;
      }

      try {
        const data = await fetchWebhooks();
        setEndpoints(data);
        if (data[0]?.id) {
          setSelectedEndpointId(data[0].id);
          const deliveryData = await fetchWebhookDeliveries(data[0].id, 25);
          setDeliveries(deliveryData);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load webhooks');
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [authToken]);

  async function handleSelectEndpoint(endpointId: string) {
    setSelectedEndpointId(endpointId);
    try {
      const deliveryData = await fetchWebhookDeliveries(endpointId, 25);
      setDeliveries(deliveryData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deliveries');
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const endpoint = await createWebhook(form);
      const nextEndpoints = [endpoint, ...endpoints];
      setEndpoints(nextEndpoints);
      setSelectedEndpointId(endpoint.id);
      setDeliveries([]);
      setForm({
        label: '',
        targetUrl: '',
        eventTypes: ['agreement.funded', 'agreement.proof_submitted', 'settlement.confirmed'],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create webhook');
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    'w-full rounded-lg border border-agent-border bg-agent-bg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-agent-accent focus:outline-none';

  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-50 border-b border-agent-border bg-agent-card/50 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-2">
            <AgentIcon className="h-5 w-5 shrink-0 text-agent-accent" />
            <span className="truncate text-lg font-bold text-white">PactAgent</span>
          </Link>
          <NavbarMenu>
            <Link href="/dashboard" className="text-sm text-gray-400 transition-colors hover:text-white">
              Dashboard
            </Link>
          </NavbarMenu>
        </div>
      </nav>

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to dashboard
        </Link>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl border border-agent-border bg-agent-card/80 p-6">
            <div className="mb-6 flex items-center gap-3">
              <BoltIcon className="h-5 w-5 text-agent-accent" />
              <div>
                <h1 className="text-2xl font-bold text-white">Webhook Endpoints</h1>
                <p className="text-sm text-gray-400">Send PactAgent agreement lifecycle events into your Nervos tools.</p>
              </div>
            </div>

            {!authToken ? (
              <div className="text-sm text-gray-400">Connect and sign in to manage webhook endpoints.</div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <input className={inputClass} value={form.label} onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))} placeholder="Endpoint label" />
                <input className={inputClass} value={form.targetUrl} onChange={(e) => setForm((prev) => ({ ...prev, targetUrl: e.target.value }))} placeholder="https://example.com/webhooks/pactagent" />
                <div className="grid gap-3 sm:grid-cols-2">
                  {EVENT_OPTIONS.map((eventType) => (
                    <label key={eventType} className="flex items-center gap-3 rounded-xl border border-agent-border bg-agent-bg/50 px-3 py-2 text-sm text-gray-300">
                      <input
                        type="checkbox"
                        checked={form.eventTypes.includes(eventType)}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            eventTypes: e.target.checked
                              ? [...prev.eventTypes, eventType]
                              : prev.eventTypes.filter((item) => item !== eventType),
                          }))
                        }
                      />
                      {eventType}
                    </label>
                  ))}
                </div>
                {error ? <div className="rounded-xl border border-red-800 bg-red-900/30 p-4 text-sm text-red-200">{error}</div> : null}
                <button type="submit" disabled={saving || !form.eventTypes.length} className="rounded-xl bg-agent-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-70">
                  {saving ? 'Creating...' : 'Create Webhook'}
                </button>
              </form>
            )}
          </section>

          <section className="rounded-3xl border border-agent-border bg-agent-card/80 p-6">
            <div className="mb-5 flex items-center gap-2 text-white">
              <LinkIcon className="h-4 w-4 text-agent-accent" />
              Recent Deliveries
            </div>
            {loading ? (
              <div className="text-sm text-gray-400">Loading endpoints...</div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  {endpoints.length ? endpoints.map((endpoint) => (
                    <button key={endpoint.id} type="button" onClick={() => void handleSelectEndpoint(endpoint.id)} className={`w-full rounded-xl border px-4 py-3 text-left ${selectedEndpointId === endpoint.id ? 'border-agent-accent bg-agent-bg/70' : 'border-agent-border bg-agent-bg/40'}`}>
                      <div className="text-sm font-medium text-white">{endpoint.label || endpoint.targetUrl}</div>
                      <div className="mt-1 text-xs text-gray-500">{endpoint.targetUrl}</div>
                    </button>
                  )) : (
                    <div className="text-sm text-gray-400">No webhook endpoints yet.</div>
                  )}
                </div>
                <div className="space-y-3">
                  {deliveries.length ? deliveries.map((delivery) => (
                    <div key={delivery.id} className="rounded-xl border border-agent-border bg-agent-bg/50 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-medium text-white">{delivery.eventType}</div>
                          <div className="mt-1 text-xs text-gray-500">{new Date(delivery.createdAt).toLocaleString()}</div>
                        </div>
                        <div className="text-xs uppercase tracking-wide text-gray-400">{delivery.status}</div>
                      </div>
                      {delivery.lastError ? <div className="mt-2 text-xs text-red-300">{delivery.lastError}</div> : null}
                    </div>
                  )) : (
                    <div className="text-sm text-gray-400">Select an endpoint to inspect recent deliveries.</div>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
