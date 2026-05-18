'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { NavbarMenu } from '@/components/NavbarMenu';
import {
  AgentIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ClockIcon,
  DocumentTextIcon,
  LinkIcon,
  PlusIcon,
  ShieldCheckIcon,
  XCircleIcon,
} from '@/components/Icons';
import { ckbToShannons, formatCkbAmount, getMinimumMilestoneCapacity, MIN_CELL_CAPACITY, shannonsToCKB } from '@/lib/ckb';
import { fetchBountyGrantAutofill, fetchCkbPriceQuote, fetchConfig, importBountyAgreement } from '@/lib/api';
import { useStore } from '@/lib/store';

type MilestoneDraft = {
  title: string;
  description: string;
  amountCkb: string;
  sourceBudgetLabel?: string;
  sourceBudgetUsd?: number | null;
  usdAmountInput?: string;
  kind?: 'COMMENCEMENT' | 'DELIVERABLE';
};

type GrantAutofillMetadata = {
  grantAmountRequested?: string | null;
  etaToCompletion?: string | null;
  fundingAddress?: string | null;
  upfrontPayment?: {
    percentage?: string | null;
    amountUsd?: string | null;
    label?: string | null;
    amountShannons?: string | null;
  };
  sourceLastSyncedAt?: string;
  missingFields?: string[];
};

type CkbPriceQuote = {
  assetId: 'nervos-network';
  symbol: 'CKB';
  currency: 'USD';
  priceUsd: number;
  inversePriceCkbPerUsd: number;
  lastUpdatedAt: string | null;
  fetchedAt: string;
};

function parseUsdAmount(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match?.[0]) {
    return null;
  }

  const amount = Number.parseFloat(match[0]);
  return Number.isFinite(amount) ? amount : null;
}

function formatUsdAmount(amount: number | null | undefined) {
  if (!Number.isFinite(amount ?? NaN)) {
    return null;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 6,
  }).format(amount as number);
}

function formatEstimatedCkb(amount: number | null | undefined) {
  if (!Number.isFinite(amount ?? NaN)) {
    return null;
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount as number);
}

function formatLargeCkbAmount(amount: number | null | undefined) {
  if (!Number.isFinite(amount ?? NaN)) {
    return '0';
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  }).format(amount as number);
}

function formatUsdReferenceInput(amount: number | null | undefined) {
  if (!Number.isFinite(amount ?? NaN)) {
    return '';
  }

  return String(amount as number);
}

function describeMissingSourceFields(fields: string[] | null | undefined) {
  if (!Array.isArray(fields) || !fields.length) {
    return null;
  }

  if (fields.length === 1 && fields[0] === 'fundingAddress') {
    return 'The original forum thread did not include a funding wallet address.';
  }

  return `The original forum thread is still missing: ${fields.join(', ')}.`;
}

function estimateCkbFromQuote(
  usdAmount: number | null | undefined,
  quote: Pick<CkbPriceQuote, 'priceUsd'> | null | undefined,
) {
  if (!quote || !Number.isFinite(usdAmount ?? NaN) || !usdAmount || quote.priceUsd <= 0) {
    return null;
  }

  return usdAmount / quote.priceUsd;
}

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

function getMilestoneAmountError(amountCkb: string, minimumMilestoneCkb: string) {
  const trimmed = amountCkb.trim();
  if (!trimmed) {
    return 'Enter the amount to release when this milestone is approved.';
  }

  const amount = Number(trimmed);
  if (!Number.isFinite(amount)) {
    return 'Enter a valid numeric CKB amount.';
  }

  if (amount < Number(minimumMilestoneCkb)) {
    return `Each milestone must be at least ${minimumMilestoneCkb} CKB.`;
  }

  return null;
}

export default function ImportBountyPage() {
  const router = useRouter();
  const walletAddress = useStore((s) => s.walletAddress);
  const authToken = useStore((s) => s.authToken);
  const [publicConfig, setPublicConfig] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autofillMessage, setAutofillMessage] = useState<string | null>(null);
  const [priceMessage, setPriceMessage] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [grantAutofillMetadata, setGrantAutofillMetadata] = useState<GrantAutofillMetadata | null>(null);
  const [ckbPriceQuote, setCkbPriceQuote] = useState<CkbPriceQuote | null>(null);
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
    forumThreadUrl: '',
    sourceReferenceId: '',
    sponsorName: '',
    bountyTitle: '',
    bountyDescription: '',
    governanceNotes: '',
    externalMetadataJson: '',
    agreementTitle: '',
    agreementDescription: '',
    workerAddress: '',
    workerFiberPubkey: '',
    deadlineDays: '7',
    disputeWindowHours: '24',
    proofType: 'URL',
    payoutNetwork: 'CKB',
  });
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

  useEffect(() => {
    if (!grantAutofillMetadata) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void loadCkbPrice(true);
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, [grantAutofillMetadata]);

  function updateField(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (error) {
      setError(null);
    }
    if (autofillMessage) {
      setAutofillMessage(null);
    }
  }

  function addMilestone() {
    setMilestones((prev) => [
      ...prev,
      {
        title: `Milestone ${prev.length + 1}`,
        description: 'Describe the next grant deliverable and the review expectation.',
        amountCkb: '',
        usdAmountInput: '',
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
        currentIndex === index
          ? (() => {
              const nextMilestone = { ...milestone, [field]: value };

              if (field === 'usdAmountInput') {
                const usdAmount = parseUsdAmount(value);
                nextMilestone.sourceBudgetUsd = usdAmount;

                const estimate = estimateCkbFromQuote(usdAmount, ckbPriceQuote);
                if (estimate) {
                  nextMilestone.amountCkb = formatEstimatedAmountInput(estimate);
                }
              }

              return nextMilestone;
            })()
          : milestone,
      ),
    );
  }

  async function loadCkbPrice(fresh = false) {
    setLoadingPrice(true);

    try {
      const quote = await fetchCkbPriceQuote({ fresh });
      setCkbPriceQuote(quote);
      setPriceMessage(null);
      return quote;
    } catch (err) {
      setPriceMessage(err instanceof Error ? err.message : 'Failed to fetch the live CKB quote.');
      return null;
    } finally {
      setLoadingPrice(false);
    }
  }

  function estimateCkbFromUsd(usdAmount: number | null | undefined) {
    return estimateCkbFromQuote(usdAmount, ckbPriceQuote);
  }

  function formatEstimatedAmountInput(value: number) {
    return value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  }

  function convertUsdInputToCkb(index: number) {
    const usdAmount = parseUsdAmount(milestones[index]?.usdAmountInput);
    const estimate = estimateCkbFromUsd(usdAmount);
    if (!estimate) {
      return;
    }

    setMilestones((prev) =>
      prev.map((milestone, currentIndex) =>
        currentIndex === index
          ? {
              ...milestone,
              sourceBudgetUsd: usdAmount,
              amountCkb: formatEstimatedAmountInput(estimate),
            }
          : milestone,
      ),
    );
  }

  function convertCkbInputToUsd(index: number) {
    const milestone = milestones[index];
    const ckbAmount = Number.parseFloat(milestone?.amountCkb || '');
    if (!ckbPriceQuote || !Number.isFinite(ckbAmount) || ckbAmount <= 0) {
      return;
    }

    const usdAmount = ckbAmount * ckbPriceQuote.priceUsd;
    setMilestones((prev) =>
      prev.map((item, currentIndex) =>
        currentIndex === index
          ? {
              ...item,
              sourceBudgetUsd: usdAmount,
              usdAmountInput: usdAmount.toFixed(2),
            }
          : item,
      ),
    );
  }

  function applyMilestoneEstimate(index: number) {
    const usdAmount = milestones[index]?.sourceBudgetUsd;
    const estimate = estimateCkbFromUsd(usdAmount);
    if (!estimate) {
      return;
    }

    updateMilestone(index, 'amountCkb', formatEstimatedAmountInput(estimate));
  }

  function applyAllEstimatedMilestones() {
    setMilestones((prev) =>
      prev.map((milestone) => {
        const estimate = estimateCkbFromUsd(milestone.sourceBudgetUsd);
        if (!estimate) {
          return milestone;
        }

        return {
          ...milestone,
          amountCkb: formatEstimatedAmountInput(estimate),
        };
      }),
    );
  }

  async function handleAutofillFromSource() {
    if (!walletAddress || !authToken) {
      setError('Connect and authenticate your wallet first.');
      return;
    }

    if (!isValidHttpUrl(form.externalUrl)) {
      setError('Paste a valid Nervos forum thread URL first.');
      return;
    }

    setAutofilling(true);
    setError(null);
    setAutofillMessage(null);

    try {
      const result = await fetchBountyGrantAutofill({
        sourceUrl: form.externalUrl,
      });

      const metadata = result.sourceMetadata as GrantAutofillMetadata;
      const importedMilestones = result.milestones.map((milestone) => ({
        title: milestone.title,
        description: milestone.description,
        amountCkb: milestone.amountCkb || '',
        sourceBudgetLabel: milestone.sourceBudgetLabel,
        sourceBudgetUsd: parseUsdAmount(milestone.sourceBudgetLabel),
        usdAmountInput: formatUsdReferenceInput(parseUsdAmount(milestone.sourceBudgetLabel)),
        kind: milestone.kind,
      }));

      setForm((prev) => ({
        ...prev,
        sourceType: result.sourceType,
        sourceLabel: result.sourceLabel,
        externalUrl: result.externalUrl,
        forumThreadUrl: result.forumThreadUrl,
        sourceReferenceId: result.sourceReferenceId || '',
        sponsorName: result.sponsorName || '',
        bountyTitle: result.bountyTitle,
        bountyDescription: result.bountyDescription,
        governanceNotes: result.governanceNotes,
        externalMetadataJson: JSON.stringify(result.sourceMetadata),
        agreementTitle: prev.agreementTitle.trim() ? prev.agreementTitle : result.agreementTitle,
        agreementDescription: prev.agreementDescription.trim() ? prev.agreementDescription : result.agreementDescription,
        deadlineDays: result.deadlineDays || prev.deadlineDays,
      }));
      setGrantAutofillMetadata(metadata);
      const quote = await loadCkbPrice();
      if (metadata?.upfrontPayment && quote) {
        const commencementEstimate = estimateCkbFromQuote(parseUsdAmount(metadata.upfrontPayment.amountUsd), quote);
        metadata.upfrontPayment.amountShannons = commencementEstimate
          ? ckbToShannons(formatEstimatedAmountInput(commencementEstimate)).toString()
          : null;
      }
      const milestonesWithEstimates = quote
        ? importedMilestones.map((milestone) => {
            const estimate = estimateCkbFromQuote(milestone.sourceBudgetUsd, quote);
            return estimate
              ? {
                  ...milestone,
                  amountCkb: formatEstimatedAmountInput(estimate),
                }
              : milestone;
          })
        : importedMilestones;

      setMilestones(milestonesWithEstimates);
      const missingFieldsMessage = describeMissingSourceFields(metadata?.missingFields);
      setAutofillMessage(
        missingFieldsMessage
          ? (
            quote
              ? `Forum details imported. ${missingFieldsMessage} Milestone CKB amounts were estimated automatically from the live quote and can still be adjusted.`
              : `Forum details imported. ${missingFieldsMessage} The live CKB quote could not be loaded, so enter payout amounts manually.`
          )
          : (
            quote
              ? 'Forum details imported. Milestone CKB amounts were estimated automatically from the live quote and can still be adjusted before creating the agreement.'
              : 'Forum details imported. The live CKB quote could not be loaded, so enter payout amounts manually before creating the agreement.'
          )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to auto-fill from the source link.');
    } finally {
      setAutofilling(false);
    }
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

    if (form.forumThreadUrl.trim() && !isValidHttpUrl(form.forumThreadUrl)) {
      setError('Enter a valid forum or governance thread URL that starts with https:// or http://.');
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
      || Number(milestone.amountCkb) < Number(minimumMilestoneCkb),
    );
    if (invalidMilestone) {
      setError(`Each milestone needs a title, description, and at least ${minimumMilestoneCkb} CKB.`);
      return;
    }

    if (commencementAmountError) {
      setError(commencementAmountError);
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
        forumThreadUrl: form.forumThreadUrl.trim() || undefined,
        sourceReferenceId: form.sourceReferenceId || undefined,
        sponsorName: form.sponsorName || undefined,
        bountyTitle: form.bountyTitle,
        bountyDescription: form.bountyDescription || undefined,
        governanceNotes: form.governanceNotes || undefined,
        externalMetadataJson: (() => {
          if (!form.externalMetadataJson) {
            return undefined;
          }
          try {
            const parsed = JSON.parse(form.externalMetadataJson) as GrantAutofillMetadata;
            if (parsed?.upfrontPayment) {
              parsed.upfrontPayment.amountShannons = commencementAmountShannons;
            }
            return JSON.stringify(parsed);
          } catch {
            return form.externalMetadataJson;
          }
        })(),
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

      window.sessionStorage.setItem(
        'pactagent-ui-flash',
        `Imported grant agreement created successfully. Lock the total ${totalGrantCkb || 0} CKB once funding is ready. The commencement fund releases immediately after funding confirms, and the remaining deliverables stay milestone-based for manual review.`,
      );
      router.push(`/agreement/${agreement.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import bounty');
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    'w-full rounded-xl border border-agent-border bg-agent-bg px-5 py-3 text-sm text-white placeholder-gray-500 focus:border-agent-accent focus:outline-none';
  const selectClass =
    `${inputClass} appearance-none pr-14`;
  const errorInputClass = 'border-red-500/70 focus:border-red-400';
  const helperClass = 'mt-1 text-xs text-gray-500';
  const fieldErrorClass = 'mt-1 text-xs text-red-300';
  const sectionClass = 'rounded-[28px] border border-agent-border/80 bg-agent-card/60 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.18)]';
  const fieldErrors = {
    sourceLabel: !form.sourceLabel.trim() ? 'Choose a short name like "Nervos Grants Round 2" or "XYZ DAO Bounty Board".' : null,
    externalUrl: form.externalUrl.trim() && !isValidHttpUrl(form.externalUrl) ? 'Use a full URL like https://dao.example.com/proposals/42.' : null,
    forumThreadUrl:
      form.forumThreadUrl.trim() && !isValidHttpUrl(form.forumThreadUrl)
        ? 'Use a full forum or governance URL like https://forum.example.com/t/grant-42.'
        : null,
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
    amount: getMilestoneAmountError(milestone.amountCkb, minimumMilestoneCkb),
  }));
  const importedGrantUsdAmount = parseUsdAmount(grantAutofillMetadata?.grantAmountRequested);
  const importedGrantEstimatedCkb = estimateCkbFromUsd(importedGrantUsdAmount);
  const importedCommencementUsdAmount = parseUsdAmount(grantAutofillMetadata?.upfrontPayment?.amountUsd);
  const importedCommencementEstimatedCkb = estimateCkbFromUsd(importedCommencementUsdAmount);
  const milestonesWithSourceEstimates = milestones.filter((milestone) => Number.isFinite(milestone.sourceBudgetUsd ?? NaN));
  const commencementAmountShannons = grantAutofillMetadata?.upfrontPayment?.amountShannons || null;
  const commencementAmountCkb = commencementAmountShannons ? Number(shannonsToCKB(commencementAmountShannons)) : 0;
  const totalGrantCkb = milestones.reduce((sum, milestone) => sum + (Number(milestone.amountCkb) || 0), 0) + commencementAmountCkb;
  const commencementAmountError =
    commencementAmountShannons && Number.isFinite(commencementAmountCkb)
      ? null
      : grantAutofillMetadata?.upfrontPayment?.amountUsd
        ? 'The commencement payment could not be converted into a valid CKB amount yet.'
        : null;

  function shouldShowFieldError(value: string, message: string | null) {
    return Boolean(message && (submitAttempted || value.trim()));
  }

  function SelectField({
    value,
    onChange,
    children,
  }: {
    value: string;
    onChange: (value: string) => void;
    children: React.ReactNode;
  }) {
    return (
      <div className="relative">
        <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
          {children}
        </select>
        <ChevronDownIcon className="pointer-events-none absolute right-5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </div>
    );
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

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to dashboard
        </Link>

        <section className="overflow-hidden rounded-[32px] border border-agent-border bg-agent-card/80 shadow-[0_24px_60px_rgba(15,23,42,0.28)]">
          <div className="border-b border-agent-border/70 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.16),transparent_34%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.12),transparent_30%),linear-gradient(135deg,rgba(120,53,15,0.22),rgba(15,23,42,0.12))] p-6 sm:p-7">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_340px]">
              <div>
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-amber-100">
                  <DocumentTextIcon className="h-4 w-4" />
                  Grant / Bounty Mode
                </div>
                <h1 className="max-w-3xl text-3xl font-bold tracking-tight text-white sm:text-[2.2rem]">
                  Bring ecosystem grants into a manual milestone contract
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300 sm:text-[15px]">
                  Keep the original source context, lock the full treasury once, and release each milestone only after explicit human review. This flow is built for grants that need attribution, governance memory, and careful payout control.
                </p>
                <div className="mt-5 flex flex-wrap gap-3 text-xs text-slate-200">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2">
                    <LinkIcon className="h-4 w-4 text-amber-300" />
                    Source attribution stays attached
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2">
                    <ClockIcon className="h-4 w-4 text-sky-300" />
                    Fund once, release milestone by milestone
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2">
                    <ShieldCheckIcon className="h-4 w-4 text-emerald-300" />
                    Manual review before every payout
                  </div>
                </div>
              </div>

              <div className="rounded-[26px] border border-white/10 bg-slate-950/30 p-5 backdrop-blur-sm">
                <div className="text-[11px] uppercase tracking-[0.2em] text-amber-100/80">How It Flows</div>
                <div className="mt-4 space-y-3">
                  {[
                    'Import the original grant or bounty source',
                    'Define milestones and the total treasury amount',
                    'Fund the full amount once after creation',
                    'Review and release each milestone manually',
                  ].map((step) => (
                    <div key={step} className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3">
                      <CheckCircleIcon className="mt-0.5 h-4 w-4 text-amber-300" />
                      <span className="text-sm leading-6 text-slate-200">{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 p-5 sm:p-6">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_360px]">
              <div className="space-y-5">
                <section className={sectionClass}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-amber-200">Source Intake</div>
                      <h2 className="mt-2 text-xl font-semibold text-white">Anchor the original grant context</h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                        Capture where this work came from so reviewers can evaluate milestone proof against the original treasury intent, not just the rewritten contract.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-amber-100">
                      Attribution first
                    </div>
                  </div>

                  <div className="mt-6 rounded-[24px] border border-agent-border/70 bg-agent-bg/40 p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                      <div className="max-w-2xl">
                        <div className="text-sm font-medium text-white">Start with the forum thread</div>
                        <p className="mt-1 text-sm leading-6 text-slate-400">
                          Paste the Nervos grant thread first. PactAgent will pull the title, summary, budget references, and milestone draft structure before you fill the remaining fields.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void handleAutofillFromSource();
                        }}
                        disabled={autofilling}
                        className="inline-flex items-center justify-center rounded-xl border border-agent-accent/40 bg-agent-accent/10 px-5 py-3 text-sm font-medium text-agent-accent hover:bg-agent-accent/20 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {autofilling ? 'Importing source...' : 'Auto-Fill From Link'}
                      </button>
                    </div>

                    <div className="mt-4">
                      <input
                        type="url"
                        className={`${inputClass} ${shouldShowFieldError(form.externalUrl, fieldErrors.externalUrl) ? errorInputClass : ''}`}
                        value={form.externalUrl}
                        onChange={(e) => updateField('externalUrl', e.target.value)}
                        placeholder="https://talk.nervos.org/t/your-grant-thread"
                        inputMode="url"
                        autoCapitalize="none"
                        spellCheck={false}
                      />
                      {shouldShowFieldError(form.externalUrl, fieldErrors.externalUrl) ? (
                        <p className={fieldErrorClass}>{fieldErrors.externalUrl}</p>
                      ) : (
                        <p className={helperClass}>Paste the original DAO proposal, forum post, or bounty page link here first.</p>
                      )}
                    </div>
                  </div>

                  {autofillMessage ? (
                    <div className="mt-4 rounded-xl border border-emerald-700/40 bg-emerald-950/20 p-4 text-sm text-emerald-100">
                      {autofillMessage}
                    </div>
                  ) : null}
                  {grantAutofillMetadata ? (
                    <div className="mt-4 rounded-[24px] border border-amber-500/20 bg-amber-500/5 p-5">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-amber-200">Imported Grant Snapshot</div>
                      <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-sky-400/20 bg-sky-950/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="text-sm font-medium text-white">Live CKB Conversion</div>
                          <p className="mt-1 text-xs text-slate-400">
                            Use the current CKB price to turn the imported USD grant values into editable payout estimates.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            void loadCkbPrice(true);
                          }}
                          disabled={loadingPrice}
                          className="inline-flex items-center justify-center rounded-xl border border-sky-400/40 bg-sky-500/10 px-4 py-3 text-sm font-medium text-sky-200 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {loadingPrice ? 'Refreshing quote...' : 'Refresh Live CKB Quote'}
                        </button>
                      </div>
                      {ckbPriceQuote ? (
                        <div className="mt-3 rounded-2xl border border-sky-400/20 bg-slate-950/20 p-4 text-sm text-slate-200">
                          <div>1 CKB = {formatUsdAmount(ckbPriceQuote.priceUsd)} USD</div>
                          <div className="mt-1">1 USD = {formatEstimatedCkb(ckbPriceQuote.inversePriceCkbPerUsd)} CKB</div>
                          <div className="mt-1 text-xs text-slate-400">
                            Quote updated {new Date(ckbPriceQuote.lastUpdatedAt || ckbPriceQuote.fetchedAt).toLocaleString()}
                          </div>
                        </div>
                      ) : null}
                      {priceMessage ? (
                        <div className="mt-3 rounded-xl border border-red-800/60 bg-red-950/20 p-3 text-sm text-red-200">
                          {priceMessage}
                        </div>
                      ) : null}
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <div className="rounded-2xl border border-amber-400/20 bg-slate-950/20 p-4">
                          <div className="text-xs uppercase tracking-wide text-slate-500">Requested Source Budget</div>
                          <div className="mt-2 text-sm text-white">{grantAutofillMetadata.grantAmountRequested || 'Not found in source thread'}</div>
                          {importedGrantEstimatedCkb ? (
                            <p className="mt-2 text-xs text-emerald-200">
                              Live estimate: {formatEstimatedCkb(importedGrantEstimatedCkb)} CKB
                            </p>
                          ) : null}
                        </div>
                        <div className="rounded-2xl border border-amber-400/20 bg-slate-950/20 p-4">
                          <div className="text-xs uppercase tracking-wide text-slate-500">ETA From Source</div>
                          <div className="mt-2 text-sm text-white">{grantAutofillMetadata.etaToCompletion || 'Not found in source thread'}</div>
                        </div>
                        <div className="rounded-2xl border border-amber-400/20 bg-slate-950/20 p-4">
                          <div className="text-xs uppercase tracking-wide text-slate-500">Commencement Payment</div>
                          <div className="mt-2 text-sm text-white">
                            {[
                              grantAutofillMetadata.upfrontPayment?.label,
                              grantAutofillMetadata.upfrontPayment?.amountUsd,
                              grantAutofillMetadata.upfrontPayment?.percentage,
                            ].filter(Boolean).join(' · ') || 'No separate commencement payment found'}
                          </div>
                          {importedCommencementEstimatedCkb ? (
                            <p className="mt-2 text-xs text-emerald-200">
                              Live kickoff estimate: {formatEstimatedCkb(importedCommencementEstimatedCkb)} CKB
                            </p>
                          ) : null}
                          {commencementAmountShannons ? (
                            <p className="mt-2 text-xs text-sky-200">
                              Commencement payout set to {shannonsToCKB(commencementAmountShannons)} CKB and releases immediately after funding confirms.
                            </p>
                          ) : null}
                          {commencementAmountError ? (
                            <p className="mt-2 text-xs text-red-300">{commencementAmountError}</p>
                          ) : null}
                          <p className="mt-2 text-xs text-slate-400">
                            This is not Milestone 1. It is tracked separately from the deliverable milestones and releases as soon as the funding lock succeeds.
                          </p>
                        </div>
                        <div className="rounded-2xl border border-amber-400/20 bg-slate-950/20 p-4">
                          <div className="text-xs uppercase tracking-wide text-slate-500">Funding Address In Source</div>
                          <div className="mt-2 break-all text-sm text-white">{grantAutofillMetadata.fundingAddress || 'Not provided in source thread'}</div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-agent-border/70 bg-agent-bg/50 p-4">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Operator</div>
                      <p className="mt-2 text-sm leading-6 text-slate-300">
                        Imports the source, defines milestones, and prepares the full grant for one treasury funding action.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-agent-border/70 bg-agent-bg/50 p-4">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Builder / Grantee</div>
                      <p className="mt-2 text-sm leading-6 text-slate-300">
                        Delivers each checkpoint and submits proof against the imported scope, notes, and review expectations.
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-5 md:grid-cols-2">
              <div>
                <SelectField value={form.sourceType} onChange={(value) => updateField('sourceType', value)}>
                  <option value="BOUNTY">Bounty</option>
                  <option value="DAO">DAO</option>
                </SelectField>
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
                  <div className="mt-4">
              <input
                type="url"
                className={`${inputClass} ${shouldShowFieldError(form.forumThreadUrl, fieldErrors.forumThreadUrl) ? errorInputClass : ''}`}
                value={form.forumThreadUrl}
                onChange={(e) => updateField('forumThreadUrl', e.target.value)}
                placeholder="https://forum.example.com/t/grant-progress-thread"
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
              />
              {shouldShowFieldError(form.forumThreadUrl, fieldErrors.forumThreadUrl) ? (
                <p className={fieldErrorClass}>{fieldErrors.forumThreadUrl}</p>
              ) : (
                <p className={helperClass}>Optional but recommended: the discussion thread PactAgent should keep synced over time.</p>
              )}
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <input className={inputClass} value={form.sourceReferenceId} onChange={(e) => updateField('sourceReferenceId', e.target.value)} placeholder="Proposal-42 or Bounty-17" />
                <p className={helperClass}>Optional external ID from the source system.</p>
              </div>
              <div>
                <input className={inputClass} value={form.sponsorName} onChange={(e) => updateField('sponsorName', e.target.value)} placeholder="Nervos Foundation" />
                <p className={helperClass}>Optional sponsor, program, or DAO treasury name.</p>
              </div>
                  </div>
                  <div className="mt-4">
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
                  <div className="mt-4">
              <textarea className={`${inputClass} min-h-24`} value={form.bountyDescription} onChange={(e) => updateField('bountyDescription', e.target.value)} placeholder="Summarize the original scope, expected deliverables, and review context." />
              <p className={helperClass}>Recommended: copy the original scope so reviewers can compare what was promised.</p>
                  </div>
                  <div className="mt-4">
              <textarea className={`${inputClass} min-h-20`} value={form.governanceNotes} onChange={(e) => updateField('governanceNotes', e.target.value)} placeholder="Optional governance notes, treasury conditions, or reviewer instructions." />
              <p className={helperClass}>Optional: use this for proposal conditions, quorum notes, or reviewer instructions.</p>
                  </div>
                </section>

                <section className={sectionClass}>
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-sky-200">Agreement Terms</div>
                      <h2 className="mt-2 text-xl font-semibold text-white">Define the formal milestone contract</h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                        This is the live PactAgent agreement. The sponsor funds the full total after creation, and each payout only moves after manual reviewer approval.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-sky-400/20 bg-sky-500/5 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-sky-100">
                      Manual release only
                    </div>
                  </div>

                  <div className="mt-6 grid gap-5 md:grid-cols-2">
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
                  <div className="mt-4">
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
                  <div className="mt-4">
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

                  <div className="mt-6 rounded-[26px] border border-agent-border bg-agent-bg/40 p-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-white">Grant Milestones</h2>
                  <p className="mt-2 max-w-xl text-sm leading-7 text-gray-400">
                    Define every deliverable the builder must complete. The total below is what the sponsor will fund once after the agreement is created.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  {milestonesWithSourceEstimates.length > 0 && ckbPriceQuote ? (
                    <button
                      type="button"
                      onClick={applyAllEstimatedMilestones}
                      className="inline-flex items-center gap-2 self-start rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-5 py-3 text-sm font-medium text-emerald-200 hover:bg-emerald-500/20"
                    >
                      Refresh All CKB Estimates
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={addMilestone}
                    className="inline-flex items-center gap-2 self-start rounded-xl border border-agent-accent/40 bg-agent-accent/10 px-5 py-3 text-sm font-medium text-agent-accent hover:bg-agent-accent/20"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Add Milestone
                  </button>
                </div>
              </div>

                    <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                      <div className="rounded-2xl border border-agent-border bg-agent-card/50 p-5">
                        <div className="text-xs uppercase tracking-[0.16em] text-gray-500">Milestone Funding Pattern</div>
                        <p className="mt-3 max-w-xl text-sm leading-7 text-slate-300">
                          The treasury funds the full amount once. PactAgent then unlocks value milestone-by-milestone as human review clears each deliverable.
                        </p>
                      </div>
                      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5">
                        <div className="text-xs uppercase tracking-[0.16em] text-emerald-200">Total To Lock Upfront</div>
                        <div className="mt-3 break-words text-[2rem] font-bold leading-tight text-white sm:text-[2.4rem]">
                          {formatLargeCkbAmount(totalGrantCkb)} CKB
                        </div>
                        <p className="mt-2 text-sm leading-7 text-slate-300">
                          Includes {formatLargeCkbAmount(commencementAmountCkb)} CKB commencement funding for immediate release, plus milestone escrow for manual payouts.
                        </p>
                      </div>
                    </div>

              <div className="mt-6 space-y-5">
                {milestones.map((milestone, index) => (
                  <div key={`${milestone.title}-${index}`} className="rounded-[24px] border border-agent-border bg-agent-card/50 p-5">
                    <div className="mb-5 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-white">Milestone {index + 1}</h3>
                        <p className="mt-1 text-xs text-gray-500">Reviewer-approved payout checkpoint</p>
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

                    <div className="grid gap-5 md:grid-cols-[1.2fr_0.8fr]">
                      <input
                        className={`${inputClass} ${milestoneErrors[index]?.title && (submitAttempted || milestone.title.trim()) ? errorInputClass : ''}`}
                        value={milestone.title}
                        onChange={(e) => updateMilestone(index, 'title', e.target.value)}
                        placeholder="Milestone title"
                      />
                      <div className="space-y-3">
                        <input
                          type="number"
                          step="0.01"
                          inputMode="decimal"
                          className={inputClass}
                          value={milestone.usdAmountInput || ''}
                          onChange={(e) => updateMilestone(index, 'usdAmountInput', e.target.value)}
                          placeholder="USD source amount"
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => convertUsdInputToCkb(index)}
                            disabled={!ckbPriceQuote}
                            className="rounded-lg border border-sky-400/40 px-3 py-2 text-[11px] font-medium text-sky-200 hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            USD {'->'} CKB
                          </button>
                          <button
                            type="button"
                            onClick={() => convertCkbInputToUsd(index)}
                            disabled={!ckbPriceQuote}
                            className="rounded-lg border border-slate-400/30 px-3 py-2 text-[11px] font-medium text-slate-200 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            CKB {'->'} USD
                          </button>
                        </div>
                        <input
                          type="number"
                          min={minimumMilestoneCkb}
                          step="0.00000001"
                          inputMode="decimal"
                          className={`${inputClass} ${milestoneErrors[index]?.amount && (submitAttempted || milestone.amountCkb.trim()) ? errorInputClass : ''}`}
                          value={milestone.amountCkb}
                          onChange={(e) => updateMilestone(index, 'amountCkb', e.target.value)}
                          placeholder={`Milestone amount (min ${minimumMilestoneCkb} CKB)`}
                        />
                      </div>
                    </div>
                    <div className="mt-2 grid gap-5 md:grid-cols-[1.2fr_0.8fr]">
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
                          <div className={helperClass}>
                            <div>
                              {milestone.sourceBudgetLabel
                                ? `Source reference: ${milestone.sourceBudgetLabel}.`
                                : 'Amount released when this milestone is approved.'}
                            </div>
                            <div className="mt-1 text-slate-400">
                              USD is only a planning reference. PactAgent still stores and pays the real amount in CKB.
                            </div>
                            {milestone.sourceBudgetUsd && ckbPriceQuote ? (
                              <div className="mt-1 text-emerald-200">
                                Live estimate: {formatEstimatedCkb(estimateCkbFromUsd(milestone.sourceBudgetUsd))} CKB
                              </div>
                            ) : milestone.sourceBudgetLabel ? (
                              <div className="mt-1 text-slate-400">Refresh the live quote to estimate the current CKB amount.</div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>

                    <textarea
                      className={`${inputClass} mt-5 min-h-28 ${milestoneErrors[index]?.description && (submitAttempted || milestone.description.trim()) ? errorInputClass : ''}`}
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
                </section>
              </div>

              <aside className="space-y-5">
                <section className={sectionClass}>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200">Why This Mode Exists</div>
                  <h2 className="mt-2 text-lg font-semibold text-white">Not the same as direct freelance work</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Ecosystem grants need provenance, treasury context, and a stronger paper trail. This mode keeps those signals visible from import through final payout.
                  </p>
                  <div className="mt-4 space-y-3">
                    {[
                      'Source links and governance notes stay attached to the agreement.',
                      'Review stays intentionally human-controlled for every milestone.',
                      'The full grant is funded once, but released gradually as work clears review.',
                    ].map((point) => (
                      <div key={point} className="flex items-start gap-3 rounded-2xl border border-agent-border/70 bg-agent-bg/50 px-3 py-3">
                        <CheckCircleIcon className="mt-0.5 h-4 w-4 text-emerald-300" />
                        <span className="text-sm leading-6 text-slate-300">{point}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className={sectionClass}>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-sky-200">Lifecycle Rules</div>
                  <div className="mt-4 space-y-3">
                    {[
                      ['1', 'Import and rewrite the source into explicit milestones.'],
                      ['2', 'Fund the total grant once the agreement is created.'],
                      ['3', 'Review proof manually before every release.'],
                      ['4', 'Repeat until the grant closes cleanly.'],
                    ].map(([step, label]) => (
                      <div key={step} className="flex items-start gap-3">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-sky-400/30 bg-sky-500/10 text-xs font-semibold text-sky-100">
                          {step}
                        </div>
                        <p className="pt-0.5 text-sm leading-6 text-slate-300">{label}</p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-[28px] border border-amber-800/40 bg-amber-950/20 p-5">
                  <div className="text-sm font-medium text-amber-200">Review Mode: Manual only</div>
                  <p className="mt-2 text-sm leading-6 text-amber-100/80">
                    Imported DAO and bounty agreements always require human review before each milestone payout. Auto and hybrid review are intentionally disabled for grant-style funding.
                  </p>
                </section>
              </aside>
            </div>

            <div className="grid gap-5 md:grid-cols-[0.95fr_0.95fr_1.1fr_1.1fr]">
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
                <SelectField value={form.disputeWindowHours} onChange={(value) => updateField('disputeWindowHours', value)}>
                  <option value="24">24h dispute</option>
                  <option value="48">48h dispute</option>
                  <option value="72">72h dispute</option>
                </SelectField>
                <p className={helperClass}>How long reviewers or counterparties have to challenge a decision.</p>
              </div>
              <div>
                <SelectField value={form.proofType} onChange={(value) => updateField('proofType', value)}>
                  <option value="URL">URL proof</option>
                  <option value="TEXT">Text proof</option>
                  <option value="FILE_HASH">File hash</option>
                </SelectField>
                <p className={helperClass}>Pick the proof format reviewers should expect from the builder.</p>
              </div>
              <div>
                <SelectField value={form.payoutNetwork} onChange={(value) => updateField('payoutNetwork', value)}>
                  <option value="CKB">CKB</option>
                  <option value="FIBER">Fiber</option>
                </SelectField>
                <p className={helperClass}>Choose `Fiber` only if the worker can provide a valid Fiber public key.</p>
              </div>
            </div>

            {error ? <div className="rounded-xl border border-red-800 bg-red-900/30 p-4 text-sm text-red-200">{error}</div> : null}

            <div className="flex flex-col gap-3 border-t border-agent-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-2xl text-sm leading-6 text-slate-400">
                This creates a manual PactAgent grant that keeps the source attribution visible while converting the work into milestone-based treasury releases.
              </p>
              <button type="submit" disabled={saving} className="rounded-xl bg-agent-accent px-6 py-3 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-70">
                {saving ? 'Importing...' : 'Create Imported Agreement'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
