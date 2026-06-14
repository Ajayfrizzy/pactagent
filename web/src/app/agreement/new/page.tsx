'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ccc } from '@ckb-ccc/connector-react';
import { NavbarMenu } from '@/components/NavbarMenu';
import { WalletOnboardingCard } from '@/components/WalletOnboardingCard';
import { BrandLogo } from '@/components/BrandLogo';
import { useStore } from '@/lib/store';
import { useWebSocket } from '@/hooks/useWebSocket';
import { createAgreement, fetchConfig } from '@/lib/api';
import {
  ckbToShannons,
  formatCkbAmount,
  getMinimumMilestoneCapacity,
} from '@/lib/ckb';
import {
  ArrowLeftIcon,
  DocumentTextIcon,
  PlusIcon,
  XCircleIcon,
  ClipboardDocumentCheckIcon,
  CheckCircleIcon,
  CurrencyDollarIcon,
  RocketLaunchIcon,
  ShieldCheckIcon,
  LinkIcon,
  SparklesIcon,
} from '@/components/Icons';

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

const FORM_STEPS = [
  {
    key: 'basics',
    label: 'Basics',
    description: 'Who is involved and what the agreement covers.',
  },
  {
    key: 'milestones',
    label: 'Milestones',
    description: 'Break the work into reviewable checkpoints.',
  },
  {
    key: 'workflow',
    label: 'Workflow',
    description: 'Choose proof, review, payout, and timing rules.',
  },
  {
    key: 'review',
    label: 'Review',
    description: 'Check the full setup before creating the agreement.',
  },
] as const;

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
  const [currentStep, setCurrentStep] = useState(0);
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

  function updateField(field: keyof typeof form, value: string) {
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
        milestoneIndex === index ? { ...milestone, [field]: value } : milestone,
      ),
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

  const totalCkb = useMemo(
    () => milestones.reduce((sum, milestone) => sum + (parseFloat(milestone.amountCKB) || 0), 0),
    [milestones],
  );
  const milestoneAmountErrors = milestones.map((milestone) => getMilestoneAmountError(milestone.amountCKB, minimumMilestoneCkb));
  const hasInvalidMilestoneAmount = milestoneAmountErrors.some((message) => Boolean(message));

  const inputClass = 'ui-input';
  const errorInputClass = 'ui-input-error';
  const labelClass = 'ui-label';
  const selectClass = 'ui-input';
  const helperClass = 'ui-helper';
  const fieldErrorClass = 'ui-error-text';

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

  function stepHasErrors(stepIndex: number) {
    if (stepIndex === 0) {
      return Boolean(fieldErrors.title || fieldErrors.description || fieldErrors.workerAddress || fieldErrors.workerFiberPubkey);
    }

    if (stepIndex === 1) {
      return milestoneFieldErrors.some((item) => item.title || item.description || item.amount);
    }

    if (stepIndex === 2) {
      return Boolean(fieldErrors.deadlineDays || fieldErrors.disputeWindowHours);
    }

    return false;
  }

  function isStepComplete(stepIndex: number) {
    if (stepIndex === 0) {
      return !fieldErrors.title && !fieldErrors.description && !fieldErrors.workerAddress && !fieldErrors.workerFiberPubkey
        && Boolean(form.title.trim() && form.description.trim() && form.workerAddress.trim());
    }

    if (stepIndex === 1) {
      return milestones.length > 0 && !milestoneFieldErrors.some((item) => item.title || item.description || item.amount);
    }

    if (stepIndex === 2) {
      return !fieldErrors.deadlineDays && !fieldErrors.disputeWindowHours;
    }

    return false;
  }

  function canAdvanceFromCurrentStep() {
    if (currentStep === 0) {
      return isStepComplete(0);
    }

    if (currentStep === 1) {
      return isStepComplete(1);
    }

    if (currentStep === 2) {
      return isStepComplete(2);
    }

    return true;
  }

  const summaryStats = useMemo(() => {
    const filledMilestones = milestones.filter((milestone) => milestone.title.trim() && milestone.description.trim() && milestone.amountCKB.trim()).length;
    const missingMilestones = milestones.length - filledMilestones;
    const suggestedDeadline = Number(form.deadlineDays) > 0 ? `${form.deadlineDays} day${Number(form.deadlineDays) === 1 ? '' : 's'}` : 'Unset';
    const suggestedWindow = Number(form.disputeWindowHours) > 0 ? `${form.disputeWindowHours} hour${Number(form.disputeWindowHours) === 1 ? '' : 's'}` : 'Unset';

    return {
      filledMilestones,
      missingMilestones,
      suggestedDeadline,
      suggestedWindow,
    };
  }, [form.deadlineDays, form.disputeWindowHours, milestones]);

  const readinessItems = [
    {
      label: 'Basics are clear',
      ready: isStepComplete(0),
      hint: 'The title, scope, and worker wallet make sense.',
    },
    {
      label: 'Milestones are actionable',
      ready: isStepComplete(1),
      hint: 'Each checkpoint has a title, acceptance detail, and amount.',
    },
    {
      label: 'Workflow rules are safe',
      ready: isStepComplete(2),
      hint: 'Deadlines, dispute window, proof, and payout rules are set.',
    },
  ];

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
      (milestone) => !milestone.title.trim() || !milestone.description.trim() || !milestone.amountCKB.trim(),
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
        Date.now() + parseInt(form.deadlineDays, 10) * 24 * 60 * 60 * 1000,
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

  return (
    <div className="min-h-screen">
      <nav className="app-nav">
        <div className="app-nav-inner">
          <div className="flex min-w-0 items-center gap-3">
            <BrandLogo />
            <span className="text-gray-600">/</span>
            <span className="truncate text-sm text-gray-400">New Agreement</span>
          </div>
          <NavbarMenu>
            <Link href="/dashboard" className="app-nav-link">Dashboard</Link>
            {isAdmin ? <Link href="/admin" className="app-nav-link-accent">Admin</Link> : null}
          </NavbarMenu>
        </div>
      </nav>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Link href="/dashboard" className="page-back-link mb-5">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Dashboard
        </Link>

        <section className="ui-panel mb-8 overflow-hidden">
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
              <div className="ui-panel-soft p-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">Client Operator</div>
                <p className="mt-2 text-sm text-gray-300">Creates the agreement, funds it once, and decides when each milestone should pay out or move into dispute.</p>
              </div>
              <div className="ui-panel-soft p-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">Worker Role</div>
                <p className="mt-2 text-sm text-gray-300">Delivers each checkpoint, submits proof, and stays aligned with the agreement description and milestone acceptance criteria.</p>
              </div>
              <div className="ui-panel-soft p-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">Lifecycle</div>
                <p className="mt-2 text-sm text-gray-300">Create → fund → deliver → review → settle. PactAgent keeps that sequence visible on the agreement detail page after creation.</p>
              </div>
              <div className="ui-panel-soft p-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">When To Use Grant Mode Instead</div>
                <p className="mt-2 text-sm text-gray-300">If the work came from a DAO program or ecosystem bounty, use the import flow so source attribution and treasury context stay attached.</p>
              </div>
            </div>
          </div>
        </section>

        {!walletAddress || !authToken ? (
          <WalletOnboardingCard
            title="Finish wallet access before creating an agreement"
            description="Agreement creation requires a connected wallet, sign-in approval, and a wallet that can approve funding actions."
            className="mb-6"
          />
        ) : null}

        <form onSubmit={handleSubmit} className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-6">
            <section className="ui-panel p-5 sm:p-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-2xl">
                  <div className="ui-kicker mb-3">Guided Setup</div>
                  <h2 className="text-xl font-semibold text-white">Move through the agreement with less guesswork</h2>
                  <p className="mt-2 text-sm text-gray-400">
                    Build the structure first, then use the summary rail to spot anything unclear before you create the draft.
                  </p>
                </div>
                <div className="ui-panel-soft flex flex-wrap gap-2 p-3">
                  {FORM_STEPS.map((step, index) => {
                    const active = index === currentStep;
                    const complete = isStepComplete(index);
                    const hasErrors = stepHasErrors(index);
                    return (
                      <button
                        key={step.key}
                        type="button"
                        onClick={() => setCurrentStep(index)}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                          active
                            ? 'bg-agent-accent text-white'
                            : complete
                              ? 'bg-emerald-500/15 text-emerald-200'
                              : hasErrors
                                ? 'bg-red-500/15 text-red-200'
                                : 'bg-agent-bg/70 text-gray-400 hover:text-white'
                        }`}
                      >
                        {complete ? 'Done' : index + 1}. {step.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-4">
                {FORM_STEPS.map((step, index) => {
                  const active = index === currentStep;
                  const complete = isStepComplete(index);
                  const hasErrors = stepHasErrors(index);
                  return (
                    <button
                      key={step.key}
                      type="button"
                      onClick={() => setCurrentStep(index)}
                      className={`rounded-2xl border p-4 text-left transition-colors ${
                        active
                          ? 'border-agent-accent/45 bg-agent-accent/10'
                          : complete
                            ? 'border-emerald-500/30 bg-emerald-950/12'
                            : hasErrors
                              ? 'border-red-500/25 bg-red-950/10'
                              : 'border-agent-border bg-agent-bg/45'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">{step.label}</div>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          complete ? 'bg-emerald-500/15 text-emerald-200' : active ? 'bg-agent-accent/15 text-agent-accent' : 'bg-agent-card/70 text-gray-400'
                        }`}>
                          {complete ? 'Ready' : active ? 'Current' : 'Pending'}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-gray-300">{step.description}</p>
                    </button>
                  );
                })}
              </div>
            </section>

            {currentStep === 0 ? (
              <section className="ui-panel p-5 sm:p-6">
                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="ui-kicker mb-2">Agreement Basics</div>
                    <h2 className="text-xl font-semibold text-white">Define the relationship and the scope</h2>
                    <p className="mt-1 text-sm text-gray-400">
                      This becomes the reference point for proof, review, and any later dispute handling.
                    </p>
                  </div>
                  <div className="ui-panel-soft max-w-xs p-4 text-sm text-gray-300">
                    Keep the title short and the scope specific enough that someone outside the conversation could understand what “done” means.
                  </div>
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
                      className={`${inputClass} min-h-36 resize-none ${shouldShowFieldError(form.description, fieldErrors.description) ? errorInputClass : ''}`}
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

                  <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
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

                    <div className="ui-panel-soft p-4">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">Counterparty check</div>
                      <p className="mt-2 text-sm text-gray-300">
                        If this is the wrong wallet, every later proof, payout, and invite action becomes harder to recover from.
                      </p>
                    </div>
                  </div>

                  {form.payoutNetwork === 'FIBER' ? (
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
                  ) : null}
                </div>
              </section>
            ) : null}

            {currentStep === 1 ? (
              <section className="ui-panel p-5 sm:p-6">
                <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="ui-kicker mb-2">Milestone Plan</div>
                    <h2 className="text-xl font-semibold text-white">Break the work into payout-ready checkpoints</h2>
                    <p className="mt-1 text-sm text-gray-400">
                      The worker will deliver and get paid one milestone at a time. Each checkpoint should feel easy to review and easy to approve.
                    </p>
                  </div>
                  <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                    <div className="ui-panel-soft p-4 text-sm text-gray-300">
                      {summaryStats.filledMilestones}/{milestones.length} milestones fully described
                    </div>
                    <button
                      type="button"
                      onClick={addMilestone}
                      className="ui-button-primary-sm"
                    >
                      <PlusIcon className="h-4 w-4" />
                      Add Milestone
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  {milestones.map((milestone, index) => {
                    const amountError = milestoneFieldErrors[index]?.amount;
                    const titleError = milestoneFieldErrors[index]?.title;
                    const descriptionError = milestoneFieldErrors[index]?.description;

                    return (
                      <div key={index} className="rounded-3xl border border-agent-border bg-agent-bg/65 p-5">
                        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="ui-kicker mb-2 bg-agent-card/75 text-gray-300">Milestone {index + 1}</div>
                            <p className="text-sm text-gray-400">
                              Keep the title scannable and the description specific enough that approval feels objective.
                            </p>
                          </div>
                          {milestones.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => removeMilestone(index)}
                              className="ui-button-ghost-danger self-start text-xs"
                            >
                              <XCircleIcon className="h-4 w-4" />
                              Remove
                            </button>
                          ) : null}
                        </div>

                        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                          <div className="space-y-4">
                            <div>
                              <label className={labelClass}>Milestone Title</label>
                              <input
                                type="text"
                                className={`${inputClass} ${titleError && (submitAttempted || milestone.title.trim()) ? errorInputClass : ''}`}
                                value={milestone.title}
                                onChange={(e) => updateMilestone(index, 'title', e.target.value)}
                                required
                              />
                              {titleError && (submitAttempted || milestone.title.trim()) ? (
                                <p className={fieldErrorClass}>{titleError}</p>
                              ) : (
                                <p className={helperClass}>Short checkpoint name, for example “Prototype shipped”.</p>
                              )}
                            </div>

                            <div>
                              <label className={labelClass}>Milestone Description</label>
                              <textarea
                                className={`${inputClass} min-h-28 resize-none ${descriptionError && (submitAttempted || milestone.description.trim()) ? errorInputClass : ''}`}
                                value={milestone.description}
                                onChange={(e) => updateMilestone(index, 'description', e.target.value)}
                                required
                              />
                              {descriptionError && (submitAttempted || milestone.description.trim()) ? (
                                <p className={fieldErrorClass}>{descriptionError}</p>
                              ) : (
                                <p className={helperClass}>Describe the deliverable, review expectation, and what counts as approval.</p>
                              )}
                            </div>
                          </div>

                          <div className="space-y-4">
                            <div className="ui-panel-soft p-4">
                              <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">Payout attached</div>
                              <div className="mt-2 text-2xl font-semibold text-white">
                                {milestone.amountCKB || '0'} CKB
                              </div>
                              <p className="mt-2 text-sm text-gray-400">
                                This is the amount released when the milestone is approved.
                              </p>
                            </div>

                            <div>
                              <label className={labelClass}>Milestone Amount (CKB)</label>
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
                              <p className={amountError && (submitAttempted || milestone.amountCKB.trim()) ? fieldErrorClass : helperClass}>
                                {amountError && (submitAttempted || milestone.amountCKB.trim()) ? amountError : `Minimum ${minimumMilestoneCkb} CKB required per milestone.`}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-5 flex flex-col gap-3 border-t border-agent-border pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-gray-400">
                    {summaryStats.missingMilestones === 0
                      ? 'Every milestone has enough structure to review clearly.'
                      : `${summaryStats.missingMilestones} milestone${summaryStats.missingMilestones === 1 ? '' : 's'} still need more detail.`}
                  </div>
                  <div className="text-lg font-semibold text-white">{totalCkb || 0} CKB total escrow</div>
                </div>
              </section>
            ) : null}

            {currentStep === 2 ? (
              <section className="ui-panel p-5 sm:p-6">
                <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="ui-kicker mb-2">Workflow Rules</div>
                    <h2 className="text-xl font-semibold text-white">Decide how proof, review, and settlement should work</h2>
                    <p className="mt-1 text-sm text-gray-400">
                      These settings control the rhythm of the agreement once the draft is live and funded.
                    </p>
                  </div>
                  <div className="ui-panel-soft max-w-xs p-4 text-sm text-gray-300">
                    Choose the simplest path that matches reality. More complexity only helps when the actual workflow needs it.
                  </div>
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

                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="ui-panel-soft p-4">
                    <label className={labelClass}>Proof Type</label>
                    <select className={selectClass} value={form.proofType} onChange={(e) => updateField('proofType', e.target.value)}>
                      <option value="URL">URL</option>
                      <option value="TEXT">Text</option>
                      <option value="FILE_HASH">File Hash</option>
                    </select>
                    <p className={helperClass}>Choose the proof format the worker should submit for review.</p>
                  </div>
                  <div className="ui-panel-soft p-4">
                    <label className={labelClass}>Reviewer Mode</label>
                    <select className={selectClass} value={form.reviewerMode} onChange={(e) => updateField('reviewerMode', e.target.value)}>
                      <option value="AUTO">Auto</option>
                      <option value="HYBRID">Hybrid</option>
                      <option value="MANUAL">Manual</option>
                    </select>
                    <p className={helperClass}>Auto is fastest, Hybrid mixes automation with human review, and Manual requires explicit reviewer action.</p>
                  </div>
                  <div className="ui-panel-soft p-4">
                    <label className={labelClass}>Payout Network</label>
                    <select className={selectClass} value={form.payoutNetwork} onChange={(e) => updateField('payoutNetwork', e.target.value)}>
                      <option value="CKB">CKB (L1)</option>
                      <option value="FIBER">Fiber (L2)</option>
                    </select>
                    <p className={helperClass}>Choose Fiber only if the worker can provide a valid Fiber public key.</p>
                  </div>
                  <div className="ui-panel-soft p-4">
                    <label className={labelClass}>Release Mode</label>
                    <select className={selectClass} value={form.releaseMode} onChange={(e) => updateField('releaseMode', e.target.value)}>
                      <option value="PARTIAL">Partial milestone payouts</option>
                      <option value="FULL">Standard settlement route</option>
                    </select>
                    <p className={helperClass}>Partial pays milestone by milestone. Full follows the standard single settlement route.</p>
                  </div>
                </div>
              </section>
            ) : null}

            {currentStep === 3 ? (
              <section className="ui-panel p-5 sm:p-6">
                <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="ui-kicker mb-2">Review Summary</div>
                    <h2 className="text-xl font-semibold text-white">Check the draft before you create it</h2>
                    <p className="mt-1 text-sm text-gray-400">
                      This is the quickest place to catch unclear scope, incomplete milestones, or the wrong review and payout settings.
                    </p>
                  </div>
                  <div className="ui-panel-soft max-w-xs p-4 text-sm text-gray-300">
                    If anything still feels fuzzy, go back one step and tighten it now. Agreement edits are easier before funding begins.
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                  <div className="space-y-4">
                    <div className="ui-panel-soft p-4">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Agreement</div>
                      <div className="mt-2 text-base font-semibold text-white">{form.title || 'Untitled agreement'}</div>
                      <p className="mt-2 text-sm text-gray-300">
                        {form.description || 'Add a clear agreement description before creating this contract.'}
                      </p>
                    </div>
                    <div className="ui-panel-soft p-4">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Worker wallet</div>
                      <div className="mt-2 break-all font-mono text-sm text-white">
                        {form.workerAddress || 'No worker address yet'}
                      </div>
                      {form.payoutNetwork === 'FIBER' ? (
                        <p className="mt-2 break-all text-xs text-gray-400">
                          Fiber key: {form.workerFiberPubkey || 'Missing Fiber key'}
                        </p>
                      ) : null}
                    </div>
                    <div className="ui-panel-soft p-4">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Milestones</div>
                      <div className="mt-3 space-y-3">
                        {milestones.map((milestone, index) => (
                          <div key={`${milestone.title}-${index}`} className="rounded-xl border border-agent-border bg-agent-card/60 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-medium text-white">{milestone.title || `Milestone ${index + 1}`}</div>
                                <p className="mt-1 text-sm text-gray-400">{milestone.description || 'Add a milestone description.'}</p>
                              </div>
                              <div className="shrink-0 text-sm font-mono text-white">
                                {milestone.amountCKB || '0'} CKB
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="ui-panel-soft p-4">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Workflow</div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                        <div>
                          <div className="text-xs text-gray-500">Proof type</div>
                          <div className="mt-1 text-sm text-white">{form.proofType}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Review mode</div>
                          <div className="mt-1 text-sm text-white">{form.reviewerMode}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Payout network</div>
                          <div className="mt-1 text-sm text-white">{form.payoutNetwork}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Release mode</div>
                          <div className="mt-1 text-sm text-white">{form.releaseMode === 'PARTIAL' ? 'Milestone-by-milestone' : 'Standard settlement route'}</div>
                        </div>
                      </div>
                    </div>
                    <div className="ui-panel-soft p-4">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Funding summary</div>
                      <div className="mt-2 text-2xl font-semibold text-white">{totalCkb || 0} CKB</div>
                      <p className="mt-2 text-sm text-gray-400">
                        Minimum per milestone is {minimumMilestoneCkb} CKB. Deadline is {form.deadlineDays} day(s) with a {form.disputeWindowHours}-hour dispute window.
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            {error ? (
              <div className="ui-alert-error px-4 py-3 text-red-300">
                {error}
              </div>
            ) : null}

            {walletAddress && authToken && !signer ? (
              <div className="ui-alert-warning px-4 py-3">
                You are still signed in, but your wallet needs to reconnect before you can create or fund this agreement.
              </div>
            ) : null}

            {walletAddress && authToken && signer && !canSignerFundAgreement(signer) ? (
              <div className="ui-alert-warning px-4 py-3">
                This wallet can sign you in, but it cannot fund CKB escrow agreements. Use JoyID or an EVM wallet that supports CKB OmniLock funding to create agreements as the client.
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => setCurrentStep((value) => Math.max(0, value - 1))}
                disabled={currentStep === 0}
                className="ui-button-secondary"
              >
                Back
              </button>

              {currentStep < FORM_STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    setSubmitAttempted(true);
                    if (canAdvanceFromCurrentStep()) {
                      setCurrentStep((value) => Math.min(FORM_STEPS.length - 1, value + 1));
                    }
                  }}
                  className="ui-button-primary"
                >
                  Continue
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={submitting || !walletAddress || !authToken || !canSignerFundAgreement(signer) || hasInvalidMilestoneAmount}
                  className="ui-button-primary"
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
              )}
            </div>
          </div>

          <aside className="space-y-6 xl:sticky xl:top-24 xl:self-start">
            <section className="ui-panel p-5">
              <div className="ui-kicker mb-3">Agreement Summary</div>
              <h2 className="text-lg font-semibold text-white">See the draft build up as you work</h2>
              <p className="mt-2 text-sm text-gray-400">
                This rail keeps the important consequences visible while you edit the structure on the left.
              </p>

              <div className="mt-5 space-y-4">
                <div className="ui-panel-soft p-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Draft title</div>
                  <div className="mt-2 text-base font-semibold text-white">{form.title || 'Untitled agreement'}</div>
                  <p className="mt-2 line-clamp-3 text-sm text-gray-400">
                    {form.description || 'Describe the scope so both parties can point back to it later.'}
                  </p>
                </div>

                <div className="ui-panel-soft p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Escrow total</div>
                      <div className="mt-2 text-2xl font-semibold text-white">{totalCkb || 0} CKB</div>
                    </div>
                    <CurrencyDollarIcon className="h-6 w-6 text-emerald-300" />
                  </div>
                  <div className="mt-4 grid gap-3 text-sm text-gray-300 sm:grid-cols-2 xl:grid-cols-1">
                    <div className="rounded-xl border border-agent-border bg-agent-card/60 p-3">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-gray-500">Milestones</div>
                      <div className="mt-1">{milestones.length} total</div>
                    </div>
                    <div className="rounded-xl border border-agent-border bg-agent-card/60 p-3">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-gray-500">Ready milestones</div>
                      <div className="mt-1">{summaryStats.filledMilestones}/{milestones.length}</div>
                    </div>
                  </div>
                </div>

                <div className="ui-panel-soft p-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Timing and payout</div>
                  <div className="mt-3 space-y-3 text-sm text-gray-300">
                    <div className="flex items-center justify-between gap-3">
                      <span>Deadline</span>
                      <span className="font-medium text-white">{summaryStats.suggestedDeadline}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Dispute window</span>
                      <span className="font-medium text-white">{summaryStats.suggestedWindow}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Payout network</span>
                      <span className="font-medium text-white">{form.payoutNetwork}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Release mode</span>
                      <span className="font-medium text-white">{form.releaseMode === 'PARTIAL' ? 'Partial' : 'Full'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="ui-panel p-5">
              <div className="ui-kicker mb-3">Readiness Check</div>
              <div className="space-y-3">
                {readinessItems.map((item) => (
                  <div key={item.label} className={`rounded-2xl border p-4 ${item.ready ? 'border-emerald-500/25 bg-emerald-950/12' : 'border-agent-border bg-agent-bg/50'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`flex h-9 w-9 items-center justify-center rounded-2xl ${item.ready ? 'bg-emerald-500/15 text-emerald-300' : 'bg-agent-card/80 text-gray-400'}`}>
                        <CheckCircleIcon className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white">{item.label}</div>
                        <p className="mt-1 text-xs text-gray-400">{item.hint}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 ui-panel-soft p-4">
                <div className="flex items-start gap-3">
                  <SparklesIcon className="mt-0.5 h-5 w-5 text-agent-accent" />
                  <div>
                    <div className="text-sm font-semibold text-white">Most useful habit</div>
                    <p className="mt-1 text-sm text-gray-400">
                      Write milestones as if someone else will have to review them without context. That makes approvals smoother and disputes easier to resolve.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section className="ui-panel p-5">
              <div className="ui-kicker mb-3">What happens after create</div>
              <div className="space-y-3 text-sm text-gray-400">
                <div className="flex items-start gap-3">
                  <ClipboardDocumentCheckIcon className="mt-0.5 h-4 w-4 text-sky-300" />
                  <span>The agreement is saved as a draft first, so you can review it before funding.</span>
                </div>
                <div className="flex items-start gap-3">
                  <RocketLaunchIcon className="mt-0.5 h-4 w-4 text-emerald-300" />
                  <span>Once funded, the first milestone becomes the operational starting point.</span>
                </div>
                <div className="flex items-start gap-3">
                  <ShieldCheckIcon className="mt-0.5 h-4 w-4 text-amber-300" />
                  <span>The detail page becomes the live workspace for proof, review, payout, and disputes.</span>
                </div>
                <div className="flex items-start gap-3">
                  <LinkIcon className="mt-0.5 h-4 w-4 text-agent-accent" />
                  <span>If the draft stays unfunded, you can still share it, refine it, or invite the worker later.</span>
                </div>
              </div>
            </section>
          </aside>
        </form>
      </div>
    </div>
  );
}
