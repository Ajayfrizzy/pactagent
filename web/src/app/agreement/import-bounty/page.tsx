'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { NavbarMenu } from '@/components/NavbarMenu';
import { AgentIcon, ArrowLeftIcon, DocumentTextIcon, PlusIcon, XCircleIcon } from '@/components/Icons';
import { ckbToShannons, MIN_CELL_CAPACITY, shannonsToCKB } from '@/lib/ckb';
import { fetchConfig, importBountyAgreement } from '@/lib/api';
import { useStore } from '@/lib/store';

type MilestoneDraft = {
  title: string;
  description: string;
  amountCkb: string;
};

const MIN_MILESTONE_CKB = Number(shannonsToCKB(MIN_CELL_CAPACITY.toString()));

export default function ImportBountyPage() {
  const router = useRouter();
  const walletAddress = useStore((s) => s.walletAddress);
  const authToken = useStore((s) => s.authToken);
  const [publicConfig, setPublicConfig] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([
    {
      title: 'Milestone 1',
      description: 'Define the first grant deliverable and what the reviewer should inspect.',
      amountCkb: '',
    },
  ]);
  const [form, setForm] = useState({
    sourceType: 'BOUNTY',
    sourceLabel: '',
    externalUrl: '',
    sourceReferenceId: '',
    sponsorName: '',
    bountyTitle: '',
    bountyDescription: '',
    governanceNotes: '',
    agreementTitle: '',
    agreementDescription: '',
    workerAddress: '',
    workerFiberPubkey: '',
    deadlineDays: '7',
    disputeWindowHours: '24',
    proofType: 'URL',
    payoutNetwork: 'CKB',
  });

  useEffect(() => {
    async function load() {
      try {
        const config = await fetchConfig();
        setPublicConfig(config);
      } catch (err) {
        console.error('Failed to load config for import page:', err);
      }
    }

    void load();
  }, []);

  function addMilestone() {
    setMilestones((prev) => [
      ...prev,
      {
        title: `Milestone ${prev.length + 1}`,
        description: 'Describe the next grant deliverable and the review expectation.',
        amountCkb: '',
      },
    ]);
  }

  function removeMilestone(index: number) {
    setMilestones((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
  }

  function updateMilestone(index: number, field: keyof MilestoneDraft, value: string) {
    setMilestones((prev) =>
      prev.map((milestone, currentIndex) =>
        currentIndex === index ? { ...milestone, [field]: value } : milestone,
      ),
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!walletAddress || !authToken) {
      setError('Connect and authenticate your wallet first.');
      return;
    }

    if (!milestones.length) {
      setError('Add at least one milestone to the grant.');
      return;
    }

    const invalidMilestone = milestones.find((milestone) =>
      !milestone.title.trim()
      || !milestone.description.trim()
      || !milestone.amountCkb.trim()
      || !Number.isFinite(Number(milestone.amountCkb))
      || Number(milestone.amountCkb) < MIN_MILESTONE_CKB,
    );
    if (invalidMilestone) {
      setError(`Each milestone needs a title, description, and at least ${MIN_MILESTONE_CKB} CKB.`);
      return;
    }

    if (form.payoutNetwork === 'FIBER' && !form.workerFiberPubkey.trim()) {
      setError('Fiber payouts require the worker Fiber public key.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const deadlineAt = new Date(Date.now() + Number(form.deadlineDays) * 24 * 60 * 60 * 1000).toISOString();
      const agreement = await importBountyAgreement({
        sourceType: form.sourceType as 'DAO' | 'BOUNTY',
        sourceLabel: form.sourceLabel,
        externalUrl: form.externalUrl,
        sourceReferenceId: form.sourceReferenceId || undefined,
        sponsorName: form.sponsorName || undefined,
        bountyTitle: form.bountyTitle,
        bountyDescription: form.bountyDescription || undefined,
        governanceNotes: form.governanceNotes || undefined,
        agreement: {
          title: form.agreementTitle || form.bountyTitle,
          description: form.agreementDescription || form.bountyDescription,
          clientAddress: walletAddress,
          workerAddress: form.workerAddress,
          workerFiberPubkey: form.workerFiberPubkey.trim() || undefined,
          deadlineAt,
          disputeWindowSecs: Number(form.disputeWindowHours) * 3600,
          proofType: form.proofType,
          reviewerMode: 'MANUAL',
          releaseMode: 'PARTIAL',
          payoutNetwork: form.payoutNetwork,
          escrowModel:
            publicConfig?.onchainEscrowReady && form.payoutNetwork === 'CKB'
              ? 'ONCHAIN_LOCK'
              : 'TREASURY_BRIDGE',
          milestones: milestones.map((milestone) => ({
            title: milestone.title,
            description: milestone.description,
            amount: ckbToShannons(milestone.amountCkb).toString(),
          })),
        },
      });

      router.push(`/agreement/${agreement.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import bounty');
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    'w-full rounded-lg border border-agent-border bg-agent-bg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-agent-accent focus:outline-none';
  const totalGrantCkb = milestones.reduce((sum, milestone) => sum + (Number(milestone.amountCkb) || 0), 0);

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

      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to dashboard
        </Link>

        <section className="rounded-3xl border border-agent-border bg-agent-card/80 p-6">
          <div className="mb-6">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-agent-border bg-agent-bg/60 px-3 py-1 text-xs uppercase tracking-[0.16em] text-agent-accent">
              <DocumentTextIcon className="h-4 w-4" />
              DAO / Bounty Import
            </div>
            <h1 className="text-2xl font-bold text-white">Import a Bounty into PactAgent</h1>
            <p className="mt-2 text-sm text-gray-400">
              Attach source metadata, define the full milestone grant, lock the total once, and release each milestone only after manual reviewer approval.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <select className={inputClass} value={form.sourceType} onChange={(e) => setForm((prev) => ({ ...prev, sourceType: e.target.value }))}>
                <option value="BOUNTY">Bounty</option>
                <option value="DAO">DAO</option>
              </select>
              <input className={inputClass} value={form.sourceLabel} onChange={(e) => setForm((prev) => ({ ...prev, sourceLabel: e.target.value }))} placeholder="Source label" />
            </div>
            <input className={inputClass} value={form.externalUrl} onChange={(e) => setForm((prev) => ({ ...prev, externalUrl: e.target.value }))} placeholder="External source URL" />
            <div className="grid gap-4 md:grid-cols-2">
              <input className={inputClass} value={form.sourceReferenceId} onChange={(e) => setForm((prev) => ({ ...prev, sourceReferenceId: e.target.value }))} placeholder="Reference ID" />
              <input className={inputClass} value={form.sponsorName} onChange={(e) => setForm((prev) => ({ ...prev, sponsorName: e.target.value }))} placeholder="Sponsor / DAO name" />
            </div>
            <input className={inputClass} value={form.bountyTitle} onChange={(e) => setForm((prev) => ({ ...prev, bountyTitle: e.target.value }))} placeholder="Bounty title" />
            <textarea className={`${inputClass} min-h-24`} value={form.bountyDescription} onChange={(e) => setForm((prev) => ({ ...prev, bountyDescription: e.target.value }))} placeholder="Bounty description" />
            <textarea className={`${inputClass} min-h-20`} value={form.governanceNotes} onChange={(e) => setForm((prev) => ({ ...prev, governanceNotes: e.target.value }))} placeholder="Governance notes (optional)" />

            <div className="rounded-2xl border border-agent-border bg-agent-bg/40 p-5">
              <h2 className="text-lg font-semibold text-white">Imported Agreement Terms</h2>
              <p className="mt-2 text-sm text-gray-400">
                This section defines the real PactAgent grant contract. The sponsor funds the full total after creation, then each milestone is reviewed manually and paid individually.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <input className={inputClass} value={form.agreementTitle} onChange={(e) => setForm((prev) => ({ ...prev, agreementTitle: e.target.value }))} placeholder="Agreement title" />
              <input className={inputClass} value={form.workerAddress} onChange={(e) => setForm((prev) => ({ ...prev, workerAddress: e.target.value }))} placeholder="Worker wallet address" />
            </div>
            <textarea className={`${inputClass} min-h-20`} value={form.agreementDescription} onChange={(e) => setForm((prev) => ({ ...prev, agreementDescription: e.target.value }))} placeholder="Agreement description" />
            <input className={inputClass} value={form.workerFiberPubkey} onChange={(e) => setForm((prev) => ({ ...prev, workerFiberPubkey: e.target.value }))} placeholder="Worker Fiber public key (optional)" />

            <div className="rounded-2xl border border-agent-border bg-agent-bg/40 p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Grant Milestones</h2>
                  <p className="mt-1 text-sm text-gray-400">
                    Define every deliverable the builder must complete. The total below is what the sponsor will fund once after the agreement is created.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addMilestone}
                  className="inline-flex items-center gap-2 rounded-xl border border-agent-accent/40 bg-agent-accent/10 px-4 py-2 text-sm font-medium text-agent-accent hover:bg-agent-accent/20"
                >
                  <PlusIcon className="h-4 w-4" />
                  Add Milestone
                </button>
              </div>

              <div className="mt-4 rounded-xl border border-agent-border bg-agent-card/50 p-4">
                <div className="text-xs uppercase tracking-[0.16em] text-gray-500">Total Grant Amount To Lock Upfront</div>
                <div className="mt-2 text-2xl font-bold text-white">{totalGrantCkb || 0} CKB</div>
                <p className="mt-1 text-sm text-gray-400">
                  PactAgent will release this total progressively, one approved milestone at a time.
                </p>
              </div>

              <div className="mt-4 space-y-4">
                {milestones.map((milestone, index) => (
                  <div key={`${milestone.title}-${index}`} className="rounded-2xl border border-agent-border bg-agent-card/50 p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-white">Milestone {index + 1}</h3>
                        <p className="text-xs text-gray-500">Reviewer-approved payout checkpoint</p>
                      </div>
                      {milestones.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => removeMilestone(index)}
                          className="inline-flex items-center gap-2 rounded-lg border border-red-700/40 px-3 py-2 text-xs text-red-300 hover:bg-red-950/20"
                        >
                          <XCircleIcon className="h-4 w-4" />
                          Remove
                        </button>
                      ) : null}
                    </div>

                    <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
                      <input
                        className={inputClass}
                        value={milestone.title}
                        onChange={(e) => updateMilestone(index, 'title', e.target.value)}
                        placeholder="Milestone title"
                      />
                      <input
                        className={inputClass}
                        value={milestone.amountCkb}
                        onChange={(e) => updateMilestone(index, 'amountCkb', e.target.value)}
                        placeholder={`Milestone amount (min ${MIN_MILESTONE_CKB} CKB)`}
                      />
                    </div>

                    <textarea
                      className={`${inputClass} mt-4 min-h-24`}
                      value={milestone.description}
                      onChange={(e) => updateMilestone(index, 'description', e.target.value)}
                      placeholder="Describe exactly what the builder must ship and what the reviewer should verify."
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[0.9fr_0.9fr_1.1fr_1.1fr]">
              <input className={inputClass} value={form.deadlineDays} onChange={(e) => setForm((prev) => ({ ...prev, deadlineDays: e.target.value }))} placeholder="Deadline days" />
              <select className={inputClass} value={form.disputeWindowHours} onChange={(e) => setForm((prev) => ({ ...prev, disputeWindowHours: e.target.value }))}>
                <option value="24">24h dispute</option>
                <option value="48">48h dispute</option>
                <option value="72">72h dispute</option>
              </select>
              <select className={inputClass} value={form.proofType} onChange={(e) => setForm((prev) => ({ ...prev, proofType: e.target.value }))}>
                <option value="URL">URL proof</option>
                <option value="TEXT">Text proof</option>
                <option value="FILE_HASH">File hash</option>
              </select>
              <select className={inputClass} value={form.payoutNetwork} onChange={(e) => setForm((prev) => ({ ...prev, payoutNetwork: e.target.value }))}>
                <option value="CKB">CKB</option>
                <option value="FIBER">Fiber</option>
              </select>
            </div>

            <div className="rounded-2xl border border-amber-800/40 bg-amber-950/20 p-4">
              <div className="text-sm font-medium text-amber-200">Review Mode: Manual only</div>
              <p className="mt-1 text-sm text-amber-100/80">
                Imported DAO and bounty agreements always require human review before each milestone payout. Auto and hybrid review are intentionally disabled for grant-style funding.
              </p>
            </div>

            {error ? <div className="rounded-xl border border-red-800 bg-red-900/30 p-4 text-sm text-red-200">{error}</div> : null}

            <button type="submit" disabled={saving} className="rounded-xl bg-agent-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-70">
              {saving ? 'Importing...' : 'Create Imported Agreement'}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
