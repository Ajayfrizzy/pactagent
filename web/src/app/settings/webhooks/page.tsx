'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BrandLogo } from '@/components/BrandLogo';
import { ArrowLeftIcon, BoltIcon, LinkIcon } from '@/components/Icons';
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
  'source.sync_changed',
];

const EVENT_LABELS: Record<string, { title: string; description: string }> = {
  'agreement.created': { title: 'Agreement created', description: 'A new agreement draft was created.' },
  'agreement.funded': { title: 'Agreement funded', description: 'The agreement escrow or treasury funding step completed.' },
  'agreement.completed': { title: 'Agreement completed', description: 'All agreement work finished successfully.' },
  'agreement.refunded': { title: 'Agreement refunded', description: 'Funds were returned instead of being paid out.' },
  'agreement.expired': { title: 'Agreement expired', description: 'The agreement reached its deadline without a normal completion path.' },
  'agreement.proof_submitted': { title: 'Proof submitted', description: 'A worker submitted proof for milestone review.' },
  'review.action_taken': { title: 'Review action taken', description: 'A reviewer approved, rejected, or otherwise acted on a review step.' },
  'dispute.opened': { title: 'Dispute opened', description: 'A dispute started and now needs attention.' },
  'dispute.updated': { title: 'Dispute updated', description: 'A dispute received new evidence or another state change.' },
  'settlement.pending': { title: 'Settlement pending', description: 'A payout, refund, or split has been prepared and is waiting to complete.' },
  'settlement.confirmed': { title: 'Settlement confirmed', description: 'A payout, refund, or split was confirmed successfully.' },
  'settlement.failed': { title: 'Settlement failed', description: 'A payout, refund, or split attempt failed and may need retry or intervention.' },
  'source.sync_changed': { title: 'Source sync changed', description: 'An imported source thread or external record was updated.' },
};

const SAMPLE_PAYLOAD = `{
  "eventType": "agreement.funded",
  "agreementId": "agr_123",
  "occurredAt": "2026-05-27T12:00:00.000Z",
  "data": {
    "title": "Treasury Design Sprint",
    "payoutNetwork": "CKB",
    "status": "FUNDED"
  }
}`;

function isValidWebhookUrl(value: string) {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export default function WebhookSettingsPage() {
  const authToken = useStore((s) => s.authToken);
  const [endpoints, setEndpoints] = useState<any[]>([]);
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [copiedSample, setCopiedSample] = useState(false);
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
    setSuccess(null);
    try {
      const deliveryData = await fetchWebhookDeliveries(endpointId, 25);
      setDeliveries(deliveryData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deliveries');
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitAttempted(true);

    if (!form.targetUrl.trim()) {
      setError('Enter the public webhook receiver URL that should receive PactAgent events.');
      return;
    }

    if (!isValidWebhookUrl(form.targetUrl)) {
      setError('Enter a valid webhook URL that starts with https:// or http://.');
      return;
    }

    if (!form.eventTypes.length) {
      setError('Choose at least one event type to send to this endpoint.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
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
      setSuccess(`Webhook ready. PactAgent will now send ${endpoint.eventTypes.length} event type${endpoint.eventTypes.length === 1 ? '' : 's'} to ${endpoint.label || endpoint.targetUrl}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create webhook');
    } finally {
      setSaving(false);
    }
  }

  async function handleCopySamplePayload() {
    await navigator.clipboard.writeText(SAMPLE_PAYLOAD);
    setCopiedSample(true);
    window.setTimeout(() => setCopiedSample(false), 2500);
  }

  const inputClass =
    'w-full rounded-lg border border-agent-border bg-agent-bg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-agent-accent focus:outline-none';
  const errorInputClass = 'border-red-500/70 focus:border-red-400';
  const helperClass = 'mt-1 text-xs text-gray-500';
  const fieldErrorClass = 'mt-1 text-xs text-red-300';
  const labelError = !form.label.trim() && submitAttempted
    ? 'Optional, but adding a label makes it easier to tell endpoints apart later.'
    : null;
  const targetUrlError = !form.targetUrl.trim()
    ? 'Paste the receiver endpoint, for example a webhook.site or your own API URL.'
    : !isValidWebhookUrl(form.targetUrl)
      ? 'Use a full URL such as https://example.com/api/pactagent/webhook.'
      : null;

  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-50 border-b border-agent-border bg-agent-card/50 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <BrandLogo />
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

        <section className="rounded-3xl border border-agent-border bg-gradient-to-br from-agent-card/95 via-agent-card/85 to-agent-bg/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.28)]">
          <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-agent-border bg-agent-bg/60 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-agent-accent">
                <BoltIcon className="h-4 w-4" />
                Integrations
              </div>
              <h1 className="text-2xl font-bold text-white">Webhook Endpoints</h1>
              <p className="mt-2 max-w-2xl text-sm text-gray-400">
                Webhooks let PactAgent push agreement lifecycle events into your own dashboards, bots, treasury tooling, or grant trackers in real time.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-agent-border bg-agent-bg/55 p-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">1. Receive</div>
                  <p className="mt-2 text-sm text-gray-300">Create a public URL that accepts JSON `POST` requests.</p>
                </div>
                <div className="rounded-2xl border border-agent-border bg-agent-bg/55 p-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">2. Subscribe</div>
                  <p className="mt-2 text-sm text-gray-300">Choose the exact PactAgent events that should trigger deliveries.</p>
                </div>
                <div className="rounded-2xl border border-agent-border bg-agent-bg/55 p-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">3. React</div>
                  <p className="mt-2 text-sm text-gray-300">Update another app, send a bot alert, or log grant progress automatically.</p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-agent-border bg-agent-bg/55 p-5">
              <div className="text-sm font-semibold text-white">What kind of link works?</div>
              <ul className="mt-3 space-y-2 text-sm text-gray-400">
                <li>`https://yourapp.com/api/pactagent/webhook`</li>
                <li>`https://webhook.site/your-test-id`</li>
                <li>`https://hooks.zapier.com/...`</li>
              </ul>
              <div className="mt-4 rounded-xl border border-agent-border bg-agent-card/70 p-3 text-xs text-gray-400">
                PactAgent sends signed JSON payloads with headers like `X-PactAgent-Event` and `X-PactAgent-Signature`. Use a test receiver first if you just want to inspect the payload.
              </div>
              <div className="mt-4 rounded-xl border border-agent-border bg-agent-card/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-white">Sample payload</div>
                  <button type="button" onClick={() => void handleCopySamplePayload()} className="rounded-lg border border-agent-border px-3 py-1.5 text-xs text-gray-300 hover:text-white">
                    {copiedSample ? 'Copied' : 'Copy JSON'}
                  </button>
                </div>
                <pre className="mt-3 overflow-x-auto rounded-lg bg-agent-bg p-3 text-[11px] text-gray-300">{SAMPLE_PAYLOAD}</pre>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl border border-agent-border bg-agent-card/90 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.22)]">
            <div className="mb-6">
              <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">Create Endpoint</div>
              <h2 className="mt-2 text-xl font-bold text-white">Tell PactAgent where to send events</h2>
              <p className="mt-1 text-sm text-gray-400">Use this form to register a receiver URL and decide which agreement lifecycle events matter to it.</p>
            </div>

            {!authToken ? (
              <div className="text-sm text-gray-400">Connect and sign in to manage webhook endpoints.</div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <input
                    className={inputClass}
                    value={form.label}
                    onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
                    placeholder="Treasury alerts"
                  />
                  {labelError ? (
                    <p className={fieldErrorClass}>{labelError}</p>
                  ) : (
                    <p className={helperClass}>Optional display name for your own reference.</p>
                  )}
                </div>
                <div>
                  <input
                    type="url"
                    className={`${inputClass} ${targetUrlError && (submitAttempted || form.targetUrl.trim()) ? errorInputClass : ''}`}
                    value={form.targetUrl}
                    onChange={(e) => setForm((prev) => ({ ...prev, targetUrl: e.target.value }))}
                    placeholder="https://example.com/webhooks/pactagent"
                    inputMode="url"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                  {targetUrlError && (submitAttempted || form.targetUrl.trim()) ? (
                    <p className={fieldErrorClass}>{targetUrlError}</p>
                  ) : (
                    <p className={helperClass}>This must be a public URL that accepts JSON `POST` requests from PactAgent.</p>
                  )}
                </div>
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
                      <span>
                        <span className="block text-sm text-white">{EVENT_LABELS[eventType]?.title || eventType}</span>
                        <span className="block text-xs text-gray-500">{EVENT_LABELS[eventType]?.description || eventType}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {!form.eventTypes.length ? (
                  <p className={fieldErrorClass}>Select at least one event type so PactAgent knows what to send.</p>
                ) : (
                  <p className={helperClass}>Pick only the lifecycle events this endpoint actually needs.</p>
                )}
                <div className="rounded-2xl border border-agent-border bg-agent-bg/50 p-4">
                  <div className="text-sm font-medium text-white">Good first test</div>
                  <p className="mt-1 text-sm text-gray-400">
                    Use a temporary receiver like `webhook.site`, create an endpoint here, then trigger funding, proof submission, or settlement to inspect the incoming JSON body.
                  </p>
                </div>
                <div className="rounded-2xl border border-agent-border bg-agent-bg/50 p-4">
                  <div className="text-sm font-medium text-white">Recommended next step</div>
                  <p className="mt-1 text-sm text-gray-400">
                    Start with `Agreement funded`, `Proof submitted`, and `Settlement confirmed`. Those three usually cover the most useful operator alerts before you subscribe to every lifecycle event.
                  </p>
                </div>
                {success ? <div className="rounded-xl border border-emerald-800 bg-emerald-900/20 p-4 text-sm text-emerald-200">{success}</div> : null}
                {error ? <div className="rounded-xl border border-red-800 bg-red-900/30 p-4 text-sm text-red-200">{error}</div> : null}
                <button type="submit" disabled={saving || !form.eventTypes.length} className="w-full rounded-xl bg-agent-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto">
                  {saving ? 'Creating...' : 'Create Webhook'}
                </button>
              </form>
            )}
          </section>

          <section className="rounded-3xl border border-agent-border bg-agent-card/90 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.22)]">
            <div className="mb-5 flex items-center gap-2 text-white">
              <LinkIcon className="h-4 w-4 text-agent-accent" />
              Endpoint Activity
            </div>
            {loading ? (
              <div className="text-sm text-gray-400">Loading endpoints...</div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  {endpoints.length ? endpoints.map((endpoint) => (
                    <button key={endpoint.id} type="button" onClick={() => void handleSelectEndpoint(endpoint.id)} className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${selectedEndpointId === endpoint.id ? 'border-agent-accent bg-agent-bg/80' : 'border-agent-border bg-agent-bg/45 hover:bg-agent-bg/65'}`}>
                      <div className="text-sm font-medium text-white">{endpoint.label || endpoint.targetUrl}</div>
                      <div className="mt-1 text-xs text-gray-500">{endpoint.targetUrl}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(endpoint.eventTypes || []).slice(0, 3).map((eventType: string) => (
                          <span key={eventType} className="rounded-full border border-agent-border bg-agent-card/70 px-2 py-1 text-[10px] text-gray-400">
                            {EVENT_LABELS[eventType]?.title || eventType}
                          </span>
                        ))}
                        {(endpoint.eventTypes || []).length > 3 ? (
                          <span className="rounded-full border border-agent-border bg-agent-card/70 px-2 py-1 text-[10px] text-gray-400">
                            +{endpoint.eventTypes.length - 3} more
                          </span>
                        ) : null}
                      </div>
                    </button>
                  )) : (
                    <div className="rounded-xl border border-agent-border bg-agent-bg/50 p-4 text-sm text-gray-400">
                      No webhook endpoints yet. Add one on the left, then trigger an agreement event to start building a delivery history here.
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  {deliveries.length ? deliveries.map((delivery) => (
                    <div key={delivery.id} className="rounded-xl border border-agent-border bg-agent-bg/50 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-medium text-white">{EVENT_LABELS[delivery.eventType]?.title || delivery.eventType}</div>
                          <div className="mt-1 text-xs text-gray-500">{EVENT_LABELS[delivery.eventType]?.description || delivery.eventType}</div>
                          <div className="mt-1 text-xs text-gray-500">{new Date(delivery.createdAt).toLocaleString()}</div>
                        </div>
                        <div className="text-xs uppercase tracking-wide text-gray-400">{delivery.status}</div>
                      </div>
                      {delivery.lastError ? <div className="mt-2 text-xs text-red-300">{delivery.lastError}</div> : null}
                    </div>
                  )) : (
                    <div className="rounded-xl border border-agent-border bg-agent-bg/50 p-4 text-sm text-gray-400">
                      Select an endpoint to inspect recent deliveries. New webhook events will show whether the receiver accepted the request or returned an error.
                    </div>
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
