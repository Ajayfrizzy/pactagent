'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ccc } from '@ckb-ccc/connector-react';
import { NavbarMenu } from '@/components/NavbarMenu';
import { useStore } from '@/lib/store';
import { useWebSocket } from '@/hooks/useWebSocket';
import { createAgreement, fetchConfig } from '@/lib/api';
import {
  ckbToShannons,
  formatCkbAmount,
  getMinimumMilestoneCapacity,
  MIN_CELL_CAPACITY,
  shannonsToCKB,
} from '@/lib/ckb';
import { AgentIcon, ArrowLeftIcon, DocumentTextIcon, PlusIcon, XCircleIcon } from '@/components/Icons';

interface MilestoneDraft {
  title: string;
  description: string;
  amountCKB: string;
}

const defaultMilestones: MilestoneDraft[] = [
  {
    title: 'Milestone 1',
    description: 'Describe the first deliverable or checkpoint.',
    amountCKB: '',
  },
  {
    title: 'Milestone 2',
    description: 'Describe the second deliverable or checkpoint.',
    amountCKB: '',
  },
];

function canSignerFundAgreement(signer: ccc.Signer | undefined) {
  return signer?.type === ccc.SignerType.CKB || signer?.type === ccc.SignerType.EVM;
}

function isValidFiberPublicKey(value: string) {
  const trimmed = value.trim();
  return /^(?:0x)?(?:02|03)[0-9a-f]{64}$/i.test(trimmed) || /^(?:0x)?04[0-9a-f]{128}$/i.test(trimmed);
}

function isLikelyCkbAddress(value: string) {
  const trimmed = value.trim().toLowerCase();
  return /^(ckt|ckb)1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{20,}$/i.test(trimmed);
}

function getMilestoneAmountError(amountCKB: string, minimumMilestoneCkb: string) {
  const trimmed = amountCKB.trim();
  if (!trimmed) {
    return 'Enter the amount to release when this milestone is approved.';
  }

  const amount = Number(trimmed);
  if (!Number.isFinite(amount)) {
    return 'Enter a valid CKB amount';
  }

  if (amount < Number(minimumMilestoneCkb)) {
    return `Each milestone must be at least ${minimumMilestoneCkb} CKB.`;
  }

  return null;
}

export default function NewAgreementPage() {
  useWebSocket();
  const router = useRouter();
  const signer = ccc.useSigner();
  const walletAddress = useStore((s) => s.walletAddress);
  const authToken = useStore((s) => s.authToken);
  const isAdmin = useStore((s) => s.isAdmin);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [publicConfig, setPublicConfig] = useState<any>(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    workerAddress: '',
    workerFiberPubkey: '',
    deadlineDays: '7',
    disputeWindowHours: '24',
    proofType: 'URL',
    reviewerMode: 'AUTO',
    releaseMode: 'PARTIAL',
    payoutNetwork: 'CKB',
  });
  const [milestones, setMilestones] = useState<MilestoneDraft[]>(defaultMilestones);
  const minimumMilestoneCapacity = getMinimumMilestoneCapacity({
    escrowModel:
      publicConfig?.onchainEscrowReady && form.payoutNetwork === 'CKB'
        ? 'ONCHAIN_LOCK'
        : 'TREASURY_BRIDGE',
    payoutNetwork: form.payoutNetwork,
    escrowLockCodeHash: publicConfig?.onchainLockCodeHash,
    escrowLockHashType: publicConfig?.onchainLockHashType,
    escrowLockArgs: publicConfig?.onchainEscrowReady ? `0x${'00'.repeat(32 * 3)}` : null,
  });
  const minimumMilestoneCkb = formatCkbAmount(minimumMilestoneCapacity);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      try {
        const configData = await fetchConfig();
        if (!cancelled) {
          setPublicConfig(configData);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load config for agreement creation:', err);
        }
      }
    }

    void loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  function updateField(field: string, value: string) {
    if (error) {
      setError(null);
    }
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function updateMilestone(index: number, field: keyof MilestoneDraft, value: string) {
    if (error) {
      setError(null);
    }
    setMilestones((prev) =>
      prev.map((milestone, milestoneIndex) =>
        milestoneIndex === index ? { ...milestone, [field]: value } : milestone
      )
    );
  }

  function addMilestone() {
    setMilestones((prev) => [
      ...prev,
      {
        title: `Milestone ${prev.length + 1}`,
        description: 'Describe the deliverable for this milestone.',
        amountCKB: '',
      },
    ]);
  }

  function removeMilestone(index: number) {
    setMilestones((prev) => prev.filter((_, milestoneIndex) => milestoneIndex !== index));
  }

  const totalCkb = milestones.reduce((sum, milestone) => sum + (parseFloat(milestone.amountCKB) || 0), 0);
  const milestoneAmountErrors = milestones.map((milestone) => getMilestoneAmountError(milestone.amountCKB, minimumMilestoneCkb));
  const hasInvalidMilestoneAmount = milestoneAmountErrors.some((message) => Boolean(message));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitAttempted(true);
    if (!walletAddress || !authToken) {
      setError('Please connect and authenticate your wallet first');
      return;
    }

    if (!signer) {
      setError('Reconnect a CKB wallet before creating an agreement');
      return;
    }

    if (!canSignerFundAgreement(signer)) {
      setError(
        'This wallet can authenticate, but only CKB-compatible funding wallets can create agreements. Use JoyID or an EVM wallet that supports CKB OmniLock funding.',
      );
      return;
    }

    if (!form.title.trim()) {
      setError('Add a clear agreement title so both parties know what this deal covers.');
      return;
    }

    if (!form.description.trim()) {
      setError('Add an agreement description that explains the scope and acceptance criteria.');
      return;
    }

    if (!form.workerAddress.trim()) {
      setError('Enter the worker wallet address that should participate in the agreement.');
      return;
    }

    if (!isLikelyCkbAddress(form.workerAddress)) {
      setError('Enter a valid CKB wallet address for the worker.');
      return;
    }

    const deadlineDays = Number(form.deadlineDays);
    if (!Number.isInteger(deadlineDays) || deadlineDays < 1) {
      setError('Deadline days must be a whole number greater than 0.');
      return;
    }

    const disputeWindowHours = Number(form.disputeWindowHours);
    if (!Number.isInteger(disputeWindowHours) || disputeWindowHours < 1) {
      setError('Dispute window hours must be a whole number greater than 0.');
      return;
    }

    const hasInvalidMilestone = milestones.some(
      (milestone) => !milestone.title.trim() || !milestone.description.trim() || !milestone.amountCKB.trim()
    );
    if (hasInvalidMilestone) {
      setError('Every milestone needs a title, description, and amount');
      return;
    }

    if (hasInvalidMilestoneAmount) {
      setError(`Each milestone must be at least ${minimumMilestoneCkb} CKB before you can continue.`);
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

    setError(null);
    setSubmitting(true);

    try {
      const deadlineAt = new Date(
        Date.now() + parseInt(form.deadlineDays, 10) * 24 * 60 * 60 * 1000
      ).toISOString();

      const agreement = await createAgreement({
        title: form.title,
        description: form.description,
        clientAddress: walletAddress,
        workerAddress: form.workerAddress,
        workerFiberPubkey: form.workerFiberPubkey.trim() || undefined,
        deadlineAt,
        disputeWindowSecs: parseInt(form.disputeWindowHours, 10) * 3600,
        proofType: form.proofType,
        reviewerMode: form.reviewerMode,
        releaseMode: form.releaseMode,
        payoutNetwork: form.payoutNetwork,
        escrowModel:
          publicConfig?.onchainEscrowReady && form.payoutNetwork === 'CKB'
            ? 'ONCHAIN_LOCK'
            : 'TREASURY_BRIDGE',
        milestones: milestones.map((milestone) => ({
          title: milestone.title,
          description: milestone.description,
          amount: ckbToShannons(milestone.amountCKB).toString(),
        })),
      });

      window.sessionStorage.setItem(
        'pactagent-ui-flash',
        `Agreement created successfully. Review the draft, then lock ${totalCkb || 0} CKB to activate the first milestone.`,
      );
      router.push(`/agreement/${agreement.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agreement');
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    'w-full bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-agent-accent transition-colors';
  const errorInputClass = 'border-red-500 focus:border-red-400';
  const labelClass = 'block text-sm font-medium text-gray-300 mb-1.5';
  const selectClass =
    'w-full bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-agent-accent transition-colors';
  const helperClass = 'mt-1.5 text-xs text-gray-500';
  const fieldErrorClass = 'mt-1.5 text-xs text-red-300';
  const fieldErrors = {
    title: !form.title.trim() ? 'Give the agreement a concise title, for example “Wallet Integration Sprint”.' : null,
    description: !form.description.trim() ? 'Describe the full scope, deliverables, and acceptance bar.' : null,
    workerAddress:
      !form.workerAddress.trim()
        ? 'Enter the worker wallet that should receive payouts and submit proof.'
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
        ? 'Use a whole number of days, for example 7 or 14.'
        : null,
    disputeWindowHours:
      !Number.isInteger(Number(form.disputeWindowHours)) || Number(form.disputeWindowHours) < 1
        ? 'Use a whole number of hours, for example 24 or 48.'
        : null,
  };
  const milestoneFieldErrors = milestones.map((milestone, index) => ({
    title: !milestone.title.trim() ? `Give milestone ${index + 1} a short deliverable title.` : null,
    description: !milestone.description.trim() ? 'Describe what the worker must ship and what “done” looks like.' : null,
    amount: getMilestoneAmountError(milestone.amountCKB, minimumMilestoneCkb),
  }));

  function shouldShowFieldError(value: string, message: string | null) {
    return Boolean(message && (submitAttempted || value.trim()));
  }

  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-50 border-b border-agent-border bg-agent-card/50 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="flex min-w-0 items-center gap-2">
              <AgentIcon className="h-5 w-5 shrink-0 text-agent-accent" />
              <span className="truncate text-lg font-bold text-white">PactAgent</span>
            </Link>
            <span className="text-gray-600">/</span>
            <span className="truncate text-sm text-gray-400">New Agreement</span>
          </div>
          <NavbarMenu>
            <Link href="/dashboard" className="text-sm text-gray-400 transition-colors hover:text-white">
              Dashboard
            </Link>
            {isAdmin ? (
              <Link href="/admin" className="text-sm text-agent-accent transition-colors hover:text-blue-300">
                Admin
              </Link>
            ) : null}
          </NavbarMenu>
        </div>
      </nav>

      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <Link
          href="/dashboard"
          className="mb-5 inline-flex items-center gap-2 text-sm text-gray-300 transition-colors hover:text-white"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Dashboard
        </Link>

        <section className="mb-8 overflow-hidden rounded-3xl border border-agent-border bg-agent-card/80 shadow-[0_24px_60px_rgba(15,23,42,0.28)]">
          <div className="bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_40%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.14),transparent_32%)] p-6 sm:p-7">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-sky-200">
              <DocumentTextIcon className="h-4 w-4" />
              Direct Agreement Mode
            </div>
            <h1 className="mb-2 text-2xl font-bold text-white sm:text-3xl">Create Milestone Agreement</h1>
            <p className="max-w-3xl text-sm text-gray-300">
              Use this flow when the client and worker already know each other. Define the scope, lock the full amount once, then move milestone-by-milestone through proof, review, and settlement.
            </p>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-agent-border bg-agent-bg/60 p-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">Client Operator</div>
                <p className="mt-2 text-sm text-gray-300">Creates the agreement, funds it once, and decides when each milestone should pay out or move into dispute.</p>
              </div>
              <div className="rounded-2xl border border-agent-border bg-agent-bg/60 p-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">Worker Role</div>
                <p className="mt-2 text-sm text-gray-300">Delivers each checkpoint, submits proof, and stays aligned with the agreement description and milestone acceptance criteria.</p>
              </div>
              <div className="rounded-2xl border border-agent-border bg-agent-bg/60 p-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">Lifecycle</div>
                <p className="mt-2 text-sm text-gray-300">Create → fund → deliver → review → settle. PactAgent keeps that sequence visible on the agreement detail page after creation.</p>
              </div>
              <div className="rounded-2xl border border-agent-border bg-agent-bg/60 p-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">When to Use Grant Mode Instead</div>
                <p className="mt-2 text-sm text-gray-300">If the work came from a DAO program or ecosystem bounty, use the import flow so source attribution and treasury context stay attached.</p>
              </div>
            </div>
          </div>
        </section>

        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="rounded-2xl border border-agent-border bg-agent-card/60 p-5 sm:p-6">
            <div className="mb-5">
              <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">Agreement Basics</div>
              <h2 className="mt-2 text-lg font-semibold text-white">Define the contract clearly</h2>
              <p className="mt-1 text-sm text-gray-400">
                Start with the overall scope and the worker wallet. This becomes the foundation every milestone and dispute refers back to later.
              </p>
            </div>

            <div className="space-y-5">
              <div>
                <label className={labelClass}>Agreement Title</label>
                <input
                  type="text"
                  className={`${inputClass} ${shouldShowFieldError(form.title, fieldErrors.title) ? errorInputClass : ''}`}
                  placeholder="e.g., Landing Page Redesign"
                  value={form.title}
                  onChange={(e) => updateField('title', e.target.value)}
                  required
                />
                {shouldShowFieldError(form.title, fieldErrors.title) ? (
                  <p className={fieldErrorClass}>{fieldErrors.title}</p>
                ) : (
                  <p className={helperClass}>Use a short agreement name both parties will immediately recognize.</p>
                )}
              </div>

              <div>
                <label className={labelClass}>Agreement Description</label>
                <textarea
                  className={`${inputClass} h-28 resize-none ${shouldShowFieldError(form.description, fieldErrors.description) ? errorInputClass : ''}`}
                  placeholder="Describe the full engagement, expected outcome, and acceptance criteria."
                  value={form.description}
                  onChange={(e) => updateField('description', e.target.value)}
                  required
                />
                {shouldShowFieldError(form.description, fieldErrors.description) ? (
                  <p className={fieldErrorClass}>{fieldErrors.description}</p>
                ) : (
                  <p className={helperClass}>Explain the scope clearly enough that disputes can be resolved against this text later.</p>
                )}
              </div>

              <div>
                <label className={labelClass}>Worker Address</label>
                <input
                  type="text"
                  className={`${inputClass} ${shouldShowFieldError(form.workerAddress, fieldErrors.workerAddress) ? errorInputClass : ''}`}
                  placeholder="ckt1q..."
                  value={form.workerAddress}
                  onChange={(e) => updateField('workerAddress', e.target.value)}
                  required
                  autoCapitalize="none"
                  spellCheck={false}
                />
                {shouldShowFieldError(form.workerAddress, fieldErrors.workerAddress) ? (
                  <p className={fieldErrorClass}>{fieldErrors.workerAddress}</p>
                ) : (
                  <p className={helperClass}>
                    Enter the worker CKB wallet address for agreement participation, proof submission, and CKB fallback settlement.
                  </p>
                )}
              </div>

              {form.payoutNetwork === 'FIBER' && (
                <div>
                  <label className={labelClass}>Worker Fiber Public Key</label>
                  <input
                    type="text"
                    className={`${inputClass} ${shouldShowFieldError(form.workerFiberPubkey, fieldErrors.workerFiberPubkey) ? errorInputClass : ''}`}
                    placeholder="02ab... or 03ab..."
                    value={form.workerFiberPubkey}
                    onChange={(e) => updateField('workerFiberPubkey', e.target.value)}
                    required
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                  {shouldShowFieldError(form.workerFiberPubkey, fieldErrors.workerFiberPubkey) ? (
                    <p className={fieldErrorClass}>{fieldErrors.workerFiberPubkey}</p>
                  ) : (
                    <p className={helperClass}>
                      Ask the worker for the public key from their Fiber node. They can usually get it from their node info output or a `node_info` RPC call.
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-agent-border bg-agent-card/60 p-5 sm:p-6">
            <div className="mb-5">
              <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">Workflow Rules</div>
              <h2 className="mt-2 text-lg font-semibold text-white">Choose how delivery gets reviewed and paid</h2>
              <p className="mt-1 text-sm text-gray-400">
                These settings decide when proof is expected, who reviews it, and whether settlement happens milestone by milestone or in one route.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Deadline (days from now)</label>
                <input
                  type="number"
                  className={`${inputClass} ${shouldShowFieldError(form.deadlineDays, fieldErrors.deadlineDays) ? errorInputClass : ''}`}
                  value={form.deadlineDays}
                  onChange={(e) => updateField('deadlineDays', e.target.value)}
                  required
                  min="1"
                  step="1"
                />
                {shouldShowFieldError(form.deadlineDays, fieldErrors.deadlineDays) ? (
                  <p className={fieldErrorClass}>{fieldErrors.deadlineDays}</p>
                ) : (
                  <p className={helperClass}>How many full days the worker has to complete the agreement.</p>
                )}
              </div>
              <div>
                <label className={labelClass}>Dispute Window (hours)</label>
                <input
                  type="number"
                  className={`${inputClass} ${shouldShowFieldError(form.disputeWindowHours, fieldErrors.disputeWindowHours) ? errorInputClass : ''}`}
                  value={form.disputeWindowHours}
                  onChange={(e) => updateField('disputeWindowHours', e.target.value)}
                  min="1"
                  step="1"
                />
                {shouldShowFieldError(form.disputeWindowHours, fieldErrors.disputeWindowHours) ? (
                  <p className={fieldErrorClass}>{fieldErrors.disputeWindowHours}</p>
                ) : (
                  <p className={helperClass}>How many hours each party has to respond if a dispute is opened.</p>
                )}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className={labelClass}>Proof Type</label>
                <select className={selectClass} value={form.proofType} onChange={(e) => updateField('proofType', e.target.value)}>
                  <option value="URL">URL</option>
                  <option value="TEXT">Text</option>
                  <option value="FILE_HASH">File Hash</option>
                </select>
                <p className={helperClass}>Choose the proof format the worker should submit for review.</p>
              </div>
              <div>
                <label className={labelClass}>Reviewer Mode</label>
                <select className={selectClass} value={form.reviewerMode} onChange={(e) => updateField('reviewerMode', e.target.value)}>
                  <option value="AUTO">Auto</option>
                  <option value="HYBRID">Hybrid</option>
                  <option value="MANUAL">Manual</option>
                </select>
                <p className={helperClass}>`Auto` is fastest, `Hybrid` mixes automation with human review, `Manual` requires explicit reviewer action.</p>
              </div>
              <div>
                <label className={labelClass}>Payout Network</label>
                <select className={selectClass} value={form.payoutNetwork} onChange={(e) => updateField('payoutNetwork', e.target.value)}>
                  <option value="CKB">CKB (L1)</option>
                  <option value="FIBER">Fiber (L2)</option>
                </select>
                <p className={helperClass}>Choose `Fiber` only if the worker can provide a valid Fiber public key.</p>
              </div>
            </div>

            <div className="mt-5">
              <label className={labelClass}>Release Mode</label>
              <select className={selectClass} value={form.releaseMode} onChange={(e) => updateField('releaseMode', e.target.value)}>
                <option value="PARTIAL">Partial milestone payouts</option>
                <option value="FULL">Standard settlement route</option>
              </select>
              <p className={helperClass}>`Partial` pays milestone by milestone. `Full` follows the standard single settlement route.</p>
            </div>
          </section>

          <section className="space-y-4 rounded-xl border border-agent-border bg-agent-card p-4 sm:p-5">
            <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">Milestone Plan</div>
                <h2 className="mt-2 text-white font-semibold">Break the payout into reviewable checkpoints</h2>
                <p className="mt-1 text-xs text-gray-400">
                  The worker will deliver and get paid one milestone at a time. Keep each milestone concrete enough that approval feels obvious.
                </p>
              </div>
              <button
                type="button"
                onClick={addMilestone}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-agent-accent px-3 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-600 sm:w-auto sm:px-4 sm:py-2"
              >
                <PlusIcon className="h-4 w-4" />
                Add Milestone
              </button>
            </div>

            <div className="space-y-4">
              {milestones.map((milestone, index) => (
                <div key={index} className="rounded-xl border border-agent-border bg-agent-bg p-4">
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-sm font-semibold text-white">Milestone {index + 1}</h3>
                    {milestones.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeMilestone(index)}
                        className="inline-flex items-center gap-1 self-start text-xs text-red-300 hover:text-red-200"
                      >
                        <XCircleIcon className="h-4 w-4" />
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className={labelClass}>Milestone Title</label>
                      <input
                        type="text"
                        className={`${inputClass} ${milestoneFieldErrors[index]?.title && (submitAttempted || milestone.title.trim()) ? errorInputClass : ''}`}
                        value={milestone.title}
                        onChange={(e) => updateMilestone(index, 'title', e.target.value)}
                        required
                      />
                      {milestoneFieldErrors[index]?.title && (submitAttempted || milestone.title.trim()) ? (
                        <p className={fieldErrorClass}>{milestoneFieldErrors[index]?.title}</p>
                      ) : (
                        <p className={helperClass}>Short checkpoint name, for example “Prototype shipped”.</p>
                      )}
                    </div>
                    <div>
                      <label className={labelClass}>Milestone Description</label>
                      <textarea
                        className={`${inputClass} h-24 resize-none ${milestoneFieldErrors[index]?.description && (submitAttempted || milestone.description.trim()) ? errorInputClass : ''}`}
                        value={milestone.description}
                        onChange={(e) => updateMilestone(index, 'description', e.target.value)}
                        required
                      />
                      {milestoneFieldErrors[index]?.description && (submitAttempted || milestone.description.trim()) ? (
                        <p className={fieldErrorClass}>{milestoneFieldErrors[index]?.description}</p>
                      ) : (
                        <p className={helperClass}>Describe the deliverable, review expectation, and what counts as approval.</p>
                      )}
                    </div>
                    <div>
                      <label className={labelClass}>Milestone Amount (CKB)</label>
                      {(() => {
                        const amountError = milestoneFieldErrors[index]?.amount;
                        return (
                          <>
                      <input
                        type="number"
                        className={amountError && (submitAttempted || milestone.amountCKB.trim()) ? `${inputClass} ${errorInputClass}` : inputClass}
                        placeholder="100"
                        min={minimumMilestoneCkb}
                        step="any"
                        value={milestone.amountCKB}
                        onChange={(e) => updateMilestone(index, 'amountCKB', e.target.value)}
                        required
                      />
                            <p className={`mt-1.5 text-xs ${amountError && (submitAttempted || milestone.amountCKB.trim()) ? 'text-red-300' : 'text-gray-500'}`}>
                              {(amountError && (submitAttempted || milestone.amountCKB.trim())) ? amountError : `Minimum ${minimumMilestoneCkb} CKB required per milestone.`}
                            </p>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between border-t border-agent-border pt-4 text-sm">
              <span className="text-gray-400">Total escrow amount</span>
              <span className="font-mono text-white">{totalCkb || 0} CKB</span>
            </div>
          </section>

          {error && (
            <div className="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {walletAddress && authToken && !signer && (
            <div className="rounded-lg border border-yellow-800 bg-yellow-900/20 px-4 py-3 text-sm text-yellow-200">
              Your authenticated session is active, but the live wallet signer is missing. Reconnect your CKB wallet
              before creating an agreement.
            </div>
          )}

          {walletAddress && authToken && signer && !canSignerFundAgreement(signer) && (
            <div className="rounded-lg border border-yellow-800 bg-yellow-900/20 px-4 py-3 text-sm text-yellow-200">
              This wallet can log in, but it cannot fund CKB escrow agreements. Use JoyID or an EVM wallet that
              supports CKB OmniLock funding to create agreements as the client.
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !walletAddress || !authToken || !canSignerFundAgreement(signer) || hasInvalidMilestoneAmount}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-agent-accent py-3 font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
          >
            {submitting ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Creating...
              </>
            ) : (
              <>
                <DocumentTextIcon className="h-4 w-4" />
                Create Milestone Agreement
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
