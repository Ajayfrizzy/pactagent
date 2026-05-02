'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ccc } from '@ckb-ccc/connector-react';
import { NavbarMenu } from '@/components/NavbarMenu';
import { useStore } from '@/lib/store';
import { useWebSocket } from '@/hooks/useWebSocket';
import { createAgreement, fetchConfig } from '@/lib/api';
import { ckbToShannons, MIN_CELL_CAPACITY, shannonsToCKB } from '@/lib/ckb';
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

const MIN_MILESTONE_CKB = Number(shannonsToCKB(MIN_CELL_CAPACITY.toString()));

function canSignerFundAgreement(signer: ccc.Signer | undefined) {
  return signer?.type === ccc.SignerType.CKB || signer?.type === ccc.SignerType.EVM;
}

function isValidFiberPublicKey(value: string) {
  const trimmed = value.trim();
  return /^(?:0x)?(?:02|03)[0-9a-f]{64}$/i.test(trimmed) || /^(?:0x)?04[0-9a-f]{128}$/i.test(trimmed);
}

function getMilestoneAmountError(amountCKB: string) {
  const trimmed = amountCKB.trim();
  if (!trimmed) {
    return null;
  }

  const amount = Number(trimmed);
  if (!Number.isFinite(amount)) {
    return 'Enter a valid CKB amount';
  }

  if (amount < MIN_MILESTONE_CKB) {
    return `Each milestone must be at least ${MIN_MILESTONE_CKB} CKB.`;
  }

  return null;
}

export default function NewAgreementPage() {
  useWebSocket();
  const router = useRouter();
  const signer = ccc.useSigner();
  const walletAddress = useStore((s) => s.walletAddress);
  const authToken = useStore((s) => s.authToken);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function updateMilestone(index: number, field: keyof MilestoneDraft, value: string) {
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
  const milestoneAmountErrors = milestones.map((milestone) => getMilestoneAmountError(milestone.amountCKB));
  const hasInvalidMilestoneAmount = milestoneAmountErrors.some((message) => Boolean(message));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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

    const hasInvalidMilestone = milestones.some(
      (milestone) => !milestone.title.trim() || !milestone.description.trim() || !milestone.amountCKB.trim()
    );
    if (hasInvalidMilestone) {
      setError('Every milestone needs a title, description, and amount');
      return;
    }

    if (hasInvalidMilestoneAmount) {
      setError(`Each milestone must be at least ${MIN_MILESTONE_CKB} CKB before you can continue.`);
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

      router.push(`/agreement/${agreement.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agreement');
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    'w-full bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-agent-accent transition-colors';
  const labelClass = 'block text-sm font-medium text-gray-300 mb-1.5';
  const selectClass =
    'w-full bg-agent-bg border border-agent-border rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-agent-accent transition-colors';

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
          <NavbarMenu />
        </div>
      </nav>

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <Link
          href="/dashboard"
          className="mb-5 inline-flex items-center gap-2 text-sm text-gray-300 transition-colors hover:text-white"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Dashboard
        </Link>

        <h1 className="mb-2 text-2xl font-bold text-white">Create Milestone Agreement</h1>
        <p className="mb-8 text-sm text-gray-400">
          Define the overall job, then break payout into real deliverable milestones.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className={labelClass}>Agreement Title</label>
            <input
              type="text"
              className={inputClass}
              placeholder="e.g., Landing Page Redesign"
              value={form.title}
              onChange={(e) => updateField('title', e.target.value)}
              required
            />
          </div>

          <div>
            <label className={labelClass}>Agreement Description</label>
            <textarea
              className={`${inputClass} h-28 resize-none`}
              placeholder="Describe the full engagement, expected outcome, and acceptance criteria."
              value={form.description}
              onChange={(e) => updateField('description', e.target.value)}
              required
            />
          </div>

          <div>
            <label className={labelClass}>Worker Address</label>
            <input
              type="text"
              className={inputClass}
              placeholder="ckt1q..."
              value={form.workerAddress}
              onChange={(e) => updateField('workerAddress', e.target.value)}
              required
            />
            <p className="mt-1.5 text-xs text-gray-500">
              Enter the worker CKB wallet address for agreement participation, proof submission, and CKB fallback settlement.
            </p>
          </div>

          {form.payoutNetwork === 'FIBER' && (
            <div>
              <label className={labelClass}>Worker Fiber Public Key</label>
              <input
                type="text"
                className={inputClass}
                placeholder="02ab... or 03ab..."
                value={form.workerFiberPubkey}
                onChange={(e) => updateField('workerFiberPubkey', e.target.value)}
                required
              />
              <p className="mt-1.5 text-xs text-gray-500">
                Ask the worker for the public key from their Fiber node. They can usually get it from their node info output or a `node_info` RPC call.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Deadline (days from now)</label>
              <input
                type="number"
                className={inputClass}
                value={form.deadlineDays}
                onChange={(e) => updateField('deadlineDays', e.target.value)}
                required
                min="1"
              />
            </div>
            <div>
              <label className={labelClass}>Dispute Window (hours)</label>
              <input
                type="number"
                className={inputClass}
                value={form.disputeWindowHours}
                onChange={(e) => updateField('disputeWindowHours', e.target.value)}
                min="1"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className={labelClass}>Proof Type</label>
              <select className={selectClass} value={form.proofType} onChange={(e) => updateField('proofType', e.target.value)}>
                <option value="URL">URL</option>
                <option value="TEXT">Text</option>
                <option value="FILE_HASH">File Hash</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Reviewer Mode</label>
              <select className={selectClass} value={form.reviewerMode} onChange={(e) => updateField('reviewerMode', e.target.value)}>
                <option value="AUTO">Auto</option>
                <option value="HYBRID">Hybrid</option>
                <option value="MANUAL">Manual</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Payout Network</label>
              <select className={selectClass} value={form.payoutNetwork} onChange={(e) => updateField('payoutNetwork', e.target.value)}>
                <option value="CKB">CKB (L1)</option>
                <option value="FIBER">Fiber (L2)</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>Release Mode</label>
            <select className={selectClass} value={form.releaseMode} onChange={(e) => updateField('releaseMode', e.target.value)}>
              <option value="PARTIAL">Partial milestone payouts</option>
              <option value="FULL">Standard settlement route</option>
            </select>
          </div>

          <div className="space-y-4 rounded-xl border border-agent-border bg-agent-card p-4 sm:p-5">
            <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-white font-semibold">Milestones</h2>
                <p className="mt-1 text-xs text-gray-400">
                  The worker will deliver and get paid one milestone at a time.
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
                        className={inputClass}
                        value={milestone.title}
                        onChange={(e) => updateMilestone(index, 'title', e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Milestone Description</label>
                      <textarea
                        className={`${inputClass} h-24 resize-none`}
                        value={milestone.description}
                        onChange={(e) => updateMilestone(index, 'description', e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Milestone Amount (CKB)</label>
                      {(() => {
                        const amountError = milestoneAmountErrors[index];
                        return (
                          <>
                      <input
                        type="number"
                        className={amountError ? `${inputClass} border-red-500 focus:border-red-400` : inputClass}
                        placeholder="100"
                        min={String(MIN_MILESTONE_CKB)}
                        step="any"
                        value={milestone.amountCKB}
                        onChange={(e) => updateMilestone(index, 'amountCKB', e.target.value)}
                        required
                      />
                            <p className={`mt-1.5 text-xs ${amountError ? 'text-red-300' : 'text-gray-500'}`}>
                              {amountError || `Minimum ${MIN_MILESTONE_CKB} CKB required per milestone.`}
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
          </div>

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
