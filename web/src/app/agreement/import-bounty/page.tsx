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

function isValidHttpUrl(value: string) {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function isLikelyCkbAddress(value: string) {
  const trimmed = value.trim().toLowerCase();
  return /^(ckt|ckb)1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{20,}$/i.test(trimmed);
}

function isValidFiberPublicKey(value: string) {
  const trimmed = value.trim();
  return /^(?:0x)?(?:02|03)[0-9a-f]{64}$/i.test(trimmed) || /^(?:0x)?04[0-9a-f]{128}$/i.test(trimmed);
}

function getMilestoneAmountError(amountCkb: string) {
  const trimmed = amountCkb.trim();
  if (!trimmed) {
    return 'Enter the amount to release when this milestone is approved.';
  }

  const amount = Number(trimmed);
  if (!Number.isFinite(amount)) {
    return 'Enter a valid numeric CKB amount.';
  }

  if (amount < MIN_MILESTONE_CKB) {
    return `Each milestone must be at least ${MIN_MILESTONE_CKB} CKB.`;
  }

  return null;
}

export default function ImportBountyPage() {
  const router = useRouter();
  const walletAddress = useStore((s) => s.walletAddress);
  const authToken = useStore((s) => s.authToken);
  const [publicConfig, setPublicConfig] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
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

  function updateField(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (error) {
      setError(null);
    }
  }

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
    if (error) {
      setError(null);
    }
    setMilestones((prev) =>
      prev.map((milestone, currentIndex) =>
        currentIndex === index ? { ...milestone, [field]: value } : milestone,
      ),
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitAttempted(true);
    if (!walletAddress || !authToken) {
      setError('Connect and authenticate your wallet first.');
      return;
    }

    if (!milestones.length) {
      setError('Add at least one milestone to the grant.');
      return;
    }

    if (!form.sourceLabel.trim()) {
      setError('Add a source label so users know which DAO, grants program, or bounty board this came from.');
      return;
    }

    if (!isValidHttpUrl(form.externalUrl)) {
      setError('Enter a valid external source URL that starts with https:// or http://.');
      return;
    }

    if (!form.bountyTitle.trim()) {
      setError('Add the bounty or grant title from the original source.');
      return;
    }

    if (!(form.agreementDescription.trim() || form.bountyDescription.trim())) {
      setError('Add an agreement description or bounty description so reviewers know what should be delivered.');
      return;
    }

    if (!form.workerAddress.trim()) {
      setError('Enter the worker wallet address that should receive milestone payouts.');
      return;
    }

    if (!isLikelyCkbAddress(form.workerAddress)) {
      setError('Enter a valid CKB testnet or mainnet wallet address for the worker.');
      return;
    }

    const deadlineDays = Number(form.deadlineDays);
    if (!Number.isInteger(deadlineDays) || deadlineDays < 1) {
      setError('Deadline days must be a whole number greater than 0.');
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

    if (form.workerFiberPubkey.trim() && !isValidFiberPublicKey(form.workerFiberPubkey)) {
      setError('The worker Fiber public key format is invalid.');
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
  const errorInputClass = 'border-red-500/70 focus:border-red-400';
  const helperClass = 'mt-1 text-xs text-gray-500';
  const fieldErrorClass = 'mt-1 text-xs text-red-300';
  const totalGrantCkb = milestones.reduce((sum, milestone) => sum + (Number(milestone.amountCkb) || 0), 0);
  const fieldErrors = {
    sourceLabel: !form.sourceLabel.trim() ? 'Choose a short name like "Nervos Grants Round 2" or "XYZ DAO Bounty Board".' : null,
    externalUrl: form.externalUrl.trim() && !isValidHttpUrl(form.externalUrl) ? 'Use a full URL like https://dao.example.com/proposals/42.' : null,
    bountyTitle: !form.bountyTitle.trim() ? 'Copy the original grant or bounty title here.' : null,
    agreementDescription:
      !(form.agreementDescription.trim() || form.bountyDescription.trim())
        ? 'Add agreement details here or fill the bounty description above.'
        : null,
    workerAddress:
      !form.workerAddress.trim()
        ? 'Enter the builder wallet that should receive approved milestone payouts.'
        : !isLikelyCkbAddress(form.workerAddress)
          ? 'Use a valid CKB address starting with ckt1 or ckb1.'
          : null,
    workerFiberPubkey:
      form.payoutNetwork === 'FIBER' && !form.workerFiberPubkey.trim()
        ? 'Fiber payouts require the worker public key.'
        : form.workerFiberPubkey.trim() && !isValidFiberPublicKey(form.workerFiberPubkey)
          ? 'Use a compressed 33-byte or uncompressed 65-byte Fiber public key.'
          : null,
    deadlineDays:
      !Number.isInteger(Number(form.deadlineDays)) || Number(form.deadlineDays) < 1
        ? 'Use a whole number of days, for example 7 or 30.'
        : null,
  };
  const milestoneErrors = milestones.map((milestone) => ({
    title: !milestone.title.trim() ? 'Give this milestone a short deliverable title.' : null,
    description: !milestone.description.trim() ? 'Describe what the builder must ship and what the reviewer should verify.' : null,
    amount: getMilestoneAmountError(milestone.amountCkb),
  }));

  function shouldShowFieldError(value: string, message: string | null) {
    return Boolean(message && (submitAttempted || value.trim()));
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
              <div>
                <select className={inputClass} value={form.sourceType} onChange={(e) => updateField('sourceType', e.target.value)}>
                  <option value="BOUNTY">Bounty</option>
                  <option value="DAO">DAO</option>
                </select>
                <p className={helperClass}>Choose where the work originated so the attribution reads correctly.</p>
              </div>
              <div>
                <input
                  className={`${inputClass} ${shouldShowFieldError(form.sourceLabel, fieldErrors.sourceLabel) ? errorInputClass : ''}`}
                  value={form.sourceLabel}
                  onChange={(e) => updateField('sourceLabel', e.target.value)}
                  placeholder="Nervos Grants Round 2"
                />
                {shouldShowFieldError(form.sourceLabel, fieldErrors.sourceLabel) ? (
                  <p className={fieldErrorClass}>{fieldErrors.sourceLabel}</p>
                ) : (
                  <p className={helperClass}>A human-friendly source name, not the full URL.</p>
                )}
              </div>
            </div>
            <div>
              <input
                type="url"
                className={`${inputClass} ${shouldShowFieldError(form.externalUrl, fieldErrors.externalUrl) ? errorInputClass : ''}`}
                value={form.externalUrl}
                onChange={(e) => updateField('externalUrl', e.target.value)}
                placeholder="https://dao.example.com/proposals/42"
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
              />
              {shouldShowFieldError(form.externalUrl, fieldErrors.externalUrl) ? (
                <p className={fieldErrorClass}>{fieldErrors.externalUrl}</p>
              ) : (
                <p className={helperClass}>Paste the original DAO proposal, forum post, or bounty page link.</p>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <input className={inputClass} value={form.sourceReferenceId} onChange={(e) => updateField('sourceReferenceId', e.target.value)} placeholder="Proposal-42 or Bounty-17" />
                <p className={helperClass}>Optional external ID from the source system.</p>
              </div>
              <div>
                <input className={inputClass} value={form.sponsorName} onChange={(e) => updateField('sponsorName', e.target.value)} placeholder="Nervos Foundation" />
                <p className={helperClass}>Optional sponsor, program, or DAO treasury name.</p>
              </div>
            </div>
            <div>
              <input
                className={`${inputClass} ${shouldShowFieldError(form.bountyTitle, fieldErrors.bountyTitle) ? errorInputClass : ''}`}
                value={form.bountyTitle}
                onChange={(e) => updateField('bountyTitle', e.target.value)}
                placeholder="Build a grant reporting dashboard"
              />
              {shouldShowFieldError(form.bountyTitle, fieldErrors.bountyTitle) ? (
                <p className={fieldErrorClass}>{fieldErrors.bountyTitle}</p>
              ) : (
                <p className={helperClass}>Use the title exactly as the community or DAO published it.</p>
              )}
            </div>
            <div>
              <textarea className={`${inputClass} min-h-24`} value={form.bountyDescription} onChange={(e) => updateField('bountyDescription', e.target.value)} placeholder="Summarize the original scope, expected deliverables, and review context." />
              <p className={helperClass}>Recommended: copy the original scope so reviewers can compare what was promised.</p>
            </div>
            <div>
              <textarea className={`${inputClass} min-h-20`} value={form.governanceNotes} onChange={(e) => updateField('governanceNotes', e.target.value)} placeholder="Optional governance notes, treasury conditions, or reviewer instructions." />
              <p className={helperClass}>Optional: use this for proposal conditions, quorum notes, or reviewer instructions.</p>
            </div>

            <div className="rounded-2xl border border-agent-border bg-agent-bg/40 p-5">
              <h2 className="text-lg font-semibold text-white">Imported Agreement Terms</h2>
              <p className="mt-2 text-sm text-gray-400">
                This section defines the real PactAgent grant contract. The sponsor funds the full total after creation, then each milestone is reviewed manually and paid individually.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <input className={inputClass} value={form.agreementTitle} onChange={(e) => updateField('agreementTitle', e.target.value)} placeholder="Grant Milestone Delivery Agreement" />
                <p className={helperClass}>Optional: leave blank to reuse the bounty title.</p>
              </div>
              <div>
                <input
                  className={`${inputClass} ${shouldShowFieldError(form.workerAddress, fieldErrors.workerAddress) ? errorInputClass : ''}`}
                  value={form.workerAddress}
                  onChange={(e) => updateField('workerAddress', e.target.value)}
                  placeholder="ckt1q..."
                  autoCapitalize="none"
                  spellCheck={false}
                />
                {shouldShowFieldError(form.workerAddress, fieldErrors.workerAddress) ? (
                  <p className={fieldErrorClass}>{fieldErrors.workerAddress}</p>
                ) : (
                  <p className={helperClass}>Paste the builder payout address exactly. Testnet addresses usually start with `ckt1`.</p>
                )}
              </div>
            </div>
            <div>
              <textarea
                className={`${inputClass} min-h-20 ${shouldShowFieldError(form.agreementDescription, fieldErrors.agreementDescription) ? errorInputClass : ''}`}
                value={form.agreementDescription}
                onChange={(e) => updateField('agreementDescription', e.target.value)}
                placeholder="Define the contract scope, milestone acceptance bar, and expected deliverables."
              />
              {shouldShowFieldError(form.agreementDescription, fieldErrors.agreementDescription) ? (
                <p className={fieldErrorClass}>{fieldErrors.agreementDescription}</p>
              ) : (
                <p className={helperClass}>Optional only if the bounty description above already explains the work clearly.</p>
              )}
            </div>
            <div>
              <input
                className={`${inputClass} ${shouldShowFieldError(form.workerFiberPubkey, fieldErrors.workerFiberPubkey) ? errorInputClass : ''}`}
                value={form.workerFiberPubkey}
                onChange={(e) => updateField('workerFiberPubkey', e.target.value)}
                placeholder="02abcd... or 04abcd..."
                autoCapitalize="none"
                spellCheck={false}
              />
              {shouldShowFieldError(form.workerFiberPubkey, fieldErrors.workerFiberPubkey) ? (
                <p className={fieldErrorClass}>{fieldErrors.workerFiberPubkey}</p>
              ) : (
                <p className={helperClass}>Needed only for Fiber payouts. Leave blank for standard CKB settlement.</p>
              )}
            </div>

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
                        className={`${inputClass} ${milestoneErrors[index]?.title && (submitAttempted || milestone.title.trim()) ? errorInputClass : ''}`}
                        value={milestone.title}
                        onChange={(e) => updateMilestone(index, 'title', e.target.value)}
                        placeholder="Milestone title"
                      />
                      <input
                        type="number"
                        min={MIN_MILESTONE_CKB}
                        step="0.00000001"
                        inputMode="decimal"
                        className={`${inputClass} ${milestoneErrors[index]?.amount && (submitAttempted || milestone.amountCkb.trim()) ? errorInputClass : ''}`}
                        value={milestone.amountCkb}
                        onChange={(e) => updateMilestone(index, 'amountCkb', e.target.value)}
                        placeholder={`Milestone amount (min ${MIN_MILESTONE_CKB} CKB)`}
                      />
                    </div>
                    <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
                      <div>
                        {milestoneErrors[index]?.title && (submitAttempted || milestone.title.trim()) ? (
                          <p className={fieldErrorClass}>{milestoneErrors[index]?.title}</p>
                        ) : (
                          <p className={helperClass}>Short checkpoint name, for example “Prototype shipped”.</p>
                        )}
                      </div>
                      <div>
                        {milestoneErrors[index]?.amount && (submitAttempted || milestone.amountCkb.trim()) ? (
                          <p className={fieldErrorClass}>{milestoneErrors[index]?.amount}</p>
                        ) : (
                          <p className={helperClass}>Amount released when this milestone is approved.</p>
                        )}
                      </div>
                    </div>

                    <textarea
                      className={`${inputClass} mt-4 min-h-24 ${milestoneErrors[index]?.description && (submitAttempted || milestone.description.trim()) ? errorInputClass : ''}`}
                      value={milestone.description}
                      onChange={(e) => updateMilestone(index, 'description', e.target.value)}
                      placeholder="Describe exactly what the builder must ship and what the reviewer should verify."
                    />
                    {milestoneErrors[index]?.description && (submitAttempted || milestone.description.trim()) ? (
                      <p className={fieldErrorClass}>{milestoneErrors[index]?.description}</p>
                    ) : (
                      <p className={helperClass}>Explain the deliverable, proof expected, and what counts as “done”.</p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[0.9fr_0.9fr_1.1fr_1.1fr]">
              <div>
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  className={`${inputClass} ${shouldShowFieldError(form.deadlineDays, fieldErrors.deadlineDays) ? errorInputClass : ''}`}
                  value={form.deadlineDays}
                  onChange={(e) => updateField('deadlineDays', e.target.value)}
                  placeholder="Deadline days"
                />
                {shouldShowFieldError(form.deadlineDays, fieldErrors.deadlineDays) ? (
                  <p className={fieldErrorClass}>{fieldErrors.deadlineDays}</p>
                ) : (
                  <p className={helperClass}>How many days the builder has to deliver the full grant.</p>
                )}
              </div>
              <div>
                <select className={inputClass} value={form.disputeWindowHours} onChange={(e) => updateField('disputeWindowHours', e.target.value)}>
                  <option value="24">24h dispute</option>
                  <option value="48">48h dispute</option>
                  <option value="72">72h dispute</option>
                </select>
                <p className={helperClass}>How long reviewers or counterparties have to challenge a decision.</p>
              </div>
              <div>
                <select className={inputClass} value={form.proofType} onChange={(e) => updateField('proofType', e.target.value)}>
                  <option value="URL">URL proof</option>
                  <option value="TEXT">Text proof</option>
                  <option value="FILE_HASH">File hash</option>
                </select>
                <p className={helperClass}>Pick the proof format reviewers should expect from the builder.</p>
              </div>
              <div>
                <select className={inputClass} value={form.payoutNetwork} onChange={(e) => updateField('payoutNetwork', e.target.value)}>
                  <option value="CKB">CKB</option>
                  <option value="FIBER">Fiber</option>
                </select>
                <p className={helperClass}>Choose `Fiber` only if the worker can provide a valid Fiber public key.</p>
              </div>
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
