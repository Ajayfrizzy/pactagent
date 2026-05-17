'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { NavbarMenu } from '@/components/NavbarMenu';
import { AgentIcon, ArrowLeftIcon, DocumentTextIcon, PlusIcon, TrophyIcon, XCircleIcon } from '@/components/Icons';
import { ckbToShannons, formatCkbAmount, getMinimumMilestoneCapacity, MIN_CELL_CAPACITY, shannonsToCKB } from '@/lib/ckb';
import { fetchCkboostCampaignAutofill, fetchConfig, importCkboostAgreement } from '@/lib/api';
import { useStore } from '@/lib/store';

type MilestoneDraft = {
  title: string;
  description: string;
  amountCkb: string;
};

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

export default function ImportCkboostPage() {
  const router = useRouter();
  const walletAddress = useStore((s) => s.walletAddress);
  const authToken = useStore((s) => s.authToken);
  const [publicConfig, setPublicConfig] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autofillMessage, setAutofillMessage] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([
    {
      title: 'Campaign Deliverable 1',
      description: 'Translate the highest-value CKBoost deliverable into a PactAgent milestone.',
      amountCkb: '',
    },
  ]);
  const [form, setForm] = useState({
    campaignId: '',
    campaignTitle: '',
    campaignUrl: '',
    governanceThreadUrl: '',
    sponsorName: '',
    sponsorWalletAddress: '',
    questBundleTitle: '',
    campaignDescription: '',
    approvedProofSummary: '',
    approvedProofUrl: '',
    contributorExternalId: '',
    contributorProfileId: '',
    contributorHandle: '',
    contributorDisplayName: '',
    contributorWalletAddress: '',
    contributorProfileUrl: '',
    campaignParticipationCount: '0',
    approvedSubmissionCount: '0',
    rejectedSubmissionCount: '0',
    leaderboardRank: '',
    totalPoints: '0',
    totalTipsReceived: '',
    campaignHistory: '',
    agreementTitle: '',
    agreementDescription: '',
    deadlineDays: '7',
    disputeWindowHours: '24',
    proofType: 'URL',
    payoutNetwork: 'CKB',
    workerFiberPubkey: '',
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
        console.error('Failed to load config for CKBoost import page:', err);
      }
    }

    void load();
  }, []);

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
        title: `Campaign Deliverable ${prev.length + 1}`,
        description: 'Describe the next campaign deliverable and the approval criteria.',
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
        currentIndex === index ? { ...milestone, [field]: value } : milestone
      ),
    );
  }

  const approvedSubmissions = Number(form.approvedSubmissionCount) || 0;
  const rejectedSubmissions = Number(form.rejectedSubmissionCount) || 0;
  const computedApprovalRate = approvedSubmissions + rejectedSubmissions > 0
    ? approvedSubmissions / (approvedSubmissions + rejectedSubmissions)
    : 0;
  const campaignHistoryItems = form.campaignHistory
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

  async function handleAutofillFromCampaign() {
    if (!walletAddress || !authToken) {
      setError('Connect and authenticate your wallet first.');
      return;
    }

    if (!form.campaignUrl.trim()) {
      setError('Paste a CKBoost campaign link first.');
      return;
    }

    setAutofilling(true);
    setError(null);
    setAutofillMessage(null);

    try {
      const data = await fetchCkboostCampaignAutofill({
        campaignLink: form.campaignUrl.trim(),
      });

      setForm((prev) => ({
        ...prev,
        campaignId: data.campaignId,
        campaignUrl: data.campaignUrl,
        campaignTitle: data.campaignTitle,
        campaignDescription: data.campaignDescription || prev.campaignDescription,
        questBundleTitle: data.questBundleTitle || prev.questBundleTitle,
        sponsorName: data.sponsorName || prev.sponsorName,
        governanceThreadUrl: data.governanceThreadUrl || prev.governanceThreadUrl,
        agreementTitle: prev.agreementTitle.trim() ? prev.agreementTitle : data.agreementTitle,
        agreementDescription: prev.agreementDescription.trim() ? prev.agreementDescription : data.agreementDescription,
        campaignParticipationCount: String(data.stats.questCount || 0),
        totalPoints: String(data.stats.totalPoints || 0),
      }));

      if (data.milestones.length) {
        setMilestones(data.milestones);
      }

      setAutofillMessage(
        data.milestones.length
          ? `Imported ${data.milestones.length} quest-derived milestone${data.milestones.length === 1 ? '' : 's'} from the CKBoost campaign.`
          : 'Campaign details were filled from the CKBoost link. Add milestone amounts where CKBoost did not expose them.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to auto-fill the CKBoost campaign details.');
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
      setError('Add at least one milestone to the imported CKBoost campaign.');
      return;
    }

    if (!form.campaignId.trim()) {
      setError('Enter the CKBoost campaign ID so the grant can sync back later.');
      return;
    }

    if (!form.campaignTitle.trim()) {
      setError('Enter the CKBoost campaign title.');
      return;
    }

    if (!isValidHttpUrl(form.campaignUrl)) {
      setError('Enter a valid CKBoost campaign URL that starts with https:// or http://.');
      return;
    }

    if (form.governanceThreadUrl.trim() && !isValidHttpUrl(form.governanceThreadUrl)) {
      setError('Enter a valid governance thread URL.');
      return;
    }

    if (!form.contributorWalletAddress.trim()) {
      setError('Enter the CKBoost contributor wallet address.');
      return;
    }

    if (!isLikelyCkbAddress(form.contributorWalletAddress)) {
      setError('Enter a valid CKB wallet address for the contributor.');
      return;
    }

    if (form.contributorProfileUrl.trim() && !isValidHttpUrl(form.contributorProfileUrl)) {
      setError('Enter a valid contributor profile URL.');
      return;
    }

    if (form.approvedProofUrl.trim() && !isValidHttpUrl(form.approvedProofUrl)) {
      setError('Enter a valid approved proof URL.');
      return;
    }

    if (!(form.agreementDescription.trim() || form.campaignDescription.trim())) {
      setError('Add an agreement description or campaign description so the grant scope is reviewable.');
      return;
    }

    if (form.sponsorWalletAddress.trim() && !isLikelyCkbAddress(form.sponsorWalletAddress)) {
      setError('Enter a valid sponsor wallet address or leave it blank to use the importing wallet as the client.');
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

    if (form.payoutNetwork === 'FIBER' && !form.workerFiberPubkey.trim()) {
      setError('Fiber payouts require the contributor Fiber public key.');
      return;
    }

    if (form.workerFiberPubkey.trim() && !isValidFiberPublicKey(form.workerFiberPubkey)) {
      setError('The contributor Fiber public key format is invalid.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const deadlineAt = new Date(Date.now() + Number(form.deadlineDays) * 24 * 60 * 60 * 1000).toISOString();
      const agreement = await importCkboostAgreement({
        campaign: {
          id: form.campaignId.trim(),
          title: form.campaignTitle.trim(),
          url: form.campaignUrl.trim(),
          description: form.campaignDescription.trim() || undefined,
          sponsorName: form.sponsorName.trim() || undefined,
          governanceThreadUrl: form.governanceThreadUrl.trim() || undefined,
          questBundleTitle: form.questBundleTitle.trim() || undefined,
          approvedProofSummary: form.approvedProofSummary.trim() || undefined,
          approvedProofUrl: form.approvedProofUrl.trim() || undefined,
        },
        sponsor: {
          walletAddress: form.sponsorWalletAddress.trim() || undefined,
          displayName: form.sponsorName.trim() || undefined,
        },
        contributor: {
          profileId: form.contributorProfileId.trim() || undefined,
          contributorExternalId: form.contributorExternalId.trim() || undefined,
          walletAddress: form.contributorWalletAddress.trim(),
          handle: form.contributorHandle.trim() || undefined,
          displayName: form.contributorDisplayName.trim() || undefined,
          profileUrl: form.contributorProfileUrl.trim() || undefined,
          campaignParticipationCount: Number(form.campaignParticipationCount) || 0,
          approvedSubmissionCount: approvedSubmissions,
          rejectedSubmissionCount: rejectedSubmissions,
          approvalRate: computedApprovalRate,
          leaderboardRank: Number(form.leaderboardRank) || undefined,
          totalPoints: Number(form.totalPoints) || 0,
          totalTipsReceived: form.totalTipsReceived.trim() || undefined,
          campaignHistory: campaignHistoryItems,
          stats: {
            source: 'CKBoost manual import',
            importedAt: new Date().toISOString(),
          },
        },
        agreement: {
          title: form.agreementTitle.trim() || `${form.campaignTitle.trim()} Delivery Agreement`,
          description: form.agreementDescription.trim() || form.campaignDescription.trim(),
          clientAddress: form.sponsorWalletAddress.trim() || walletAddress,
          createdByAddress: walletAddress,
          deadlineAt,
          disputeWindowSecs: Number(form.disputeWindowHours) * 3600,
          proofType: form.proofType as 'URL' | 'TEXT' | 'FILE_HASH',
          payoutNetwork: form.payoutNetwork as 'CKB' | 'FIBER',
          workerFiberPubkey: form.workerFiberPubkey.trim() || undefined,
          escrowModel:
            publicConfig?.onchainEscrowReady && form.payoutNetwork === 'CKB'
              ? 'ONCHAIN_LOCK'
              : 'TREASURY_BRIDGE',
          milestones: milestones.map((milestone) => ({
            title: milestone.title.trim(),
            description: milestone.description.trim(),
            amount: ckbToShannons(milestone.amountCkb).toString(),
          })),
        },
      });

      window.sessionStorage.setItem(
        'pactagent-ui-flash',
        `CKBoost campaign imported successfully. Lock the total ${totalGrantCkb || 0} CKB once funding is ready, then review and release each milestone manually.`,
      );
      router.push(`/agreement/${agreement.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import CKBoost campaign');
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
  const milestoneErrors = milestones.map((milestone) => ({
    title: !milestone.title.trim() ? 'Give this deliverable a short milestone name.' : null,
    description: !milestone.description.trim() ? 'Describe what the contributor must deliver and what should be reviewed.' : null,
    amount: getMilestoneAmountError(milestone.amountCkb, minimumMilestoneCkb),
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

      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to dashboard
        </Link>

        <section className="overflow-hidden rounded-3xl border border-agent-border bg-agent-card/80 shadow-[0_24px_60px_rgba(15,23,42,0.28)]">
          <div className="bg-[radial-gradient(circle_at_top_left,rgba(251,146,60,0.18),transparent_42%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.14),transparent_34%)] p-6">
            <div className="mb-6">
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs uppercase tracking-[0.16em] text-orange-200">
                <DocumentTextIcon className="h-4 w-4" />
                CKBoost Handoff
              </div>
              <h1 className="text-2xl font-bold text-white">Create a PactAgent Grant from CKBoost</h1>
              <p className="mt-2 text-sm text-gray-400">
                Import a CKBoost campaign, map the contributor into a formal worker role, carry over reputation context, and convert the campaign into manually reviewed milestone payouts.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-agent-border bg-agent-bg/55 p-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Campaign Context</div>
                <p className="mt-2 text-sm text-gray-300">Capture the campaign URL, quest bundle, sponsor, and any approved proof so the handoff stays attributable.</p>
              </div>
              <div className="rounded-2xl border border-agent-border bg-agent-bg/55 p-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Contributor Snapshot</div>
                <p className="mt-2 text-sm text-gray-300">Preserve contributor reputation, leaderboard context, and campaign history at the moment the handoff happens.</p>
              </div>
              <div className="rounded-2xl border border-agent-border bg-agent-bg/55 p-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Manual Grant Review</div>
                <p className="mt-2 text-sm text-gray-300">CKBoost imports stay human-reviewed so every payout decision remains explicit and auditable.</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 p-6">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-5">
                <div className="rounded-2xl border border-agent-border bg-agent-bg/40 p-5">
                  <h2 className="text-lg font-semibold text-white">CKBoost Campaign</h2>
                  <div className="mt-4 rounded-xl border border-agent-border bg-agent-card/40 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-end">
                      <div className="flex-1">
                        <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-gray-500">Campaign Link Auto-Fill</label>
                        <input
                          className={inputClass}
                          value={form.campaignUrl}
                          onChange={(e) => updateField('campaignUrl', e.target.value)}
                          placeholder="https://ckboost.netlify.app/campaign/0x..."
                        />
                        <p className={helperClass}>Paste a public CKBoost campaign link and PactAgent will fill the campaign details and quest-derived milestones it can resolve from CKB.</p>
                      </div>
                      <button
                        type="button"
                        onClick={handleAutofillFromCampaign}
                        disabled={autofilling}
                        className="inline-flex h-11 items-center justify-center rounded-xl border border-agent-accent/40 bg-agent-accent/10 px-4 text-sm font-medium text-agent-accent hover:bg-agent-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {autofilling ? 'Resolving campaign...' : 'Auto-Fill From Link'}
                      </button>
                    </div>
                    {autofillMessage ? <p className="mt-3 text-sm text-emerald-300">{autofillMessage}</p> : null}
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <input
                        className={`${inputClass} ${shouldShowFieldError(form.campaignId, !form.campaignId.trim() ? 'Campaign ID is required.' : null) ? errorInputClass : ''}`}
                        value={form.campaignId}
                        onChange={(e) => updateField('campaignId', e.target.value)}
                        placeholder="campaign-42"
                      />
                      <p className={helperClass}>CKBoost campaign ID for future sync-back and events.</p>
                    </div>
                    <div>
                      <input
                        className={`${inputClass} ${shouldShowFieldError(form.campaignTitle, !form.campaignTitle.trim() ? 'Campaign title is required.' : null) ? errorInputClass : ''}`}
                        value={form.campaignTitle}
                        onChange={(e) => updateField('campaignTitle', e.target.value)}
                        placeholder="Build the Nervos governance dashboard"
                      />
                      <p className={helperClass}>Use the campaign title as it appears on CKBoost.</p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <input
                        className={inputClass}
                        value={form.campaignUrl}
                        onChange={(e) => updateField('campaignUrl', e.target.value)}
                        placeholder="https://ckboost.com/campaigns/42"
                      />
                      <p className={helperClass}>Primary CKBoost campaign URL. This is also the link used for auto-fill.</p>
                    </div>
                    <div>
                      <input
                        className={inputClass}
                        value={form.governanceThreadUrl}
                        onChange={(e) => updateField('governanceThreadUrl', e.target.value)}
                        placeholder="https://forum.example.com/t/campaign-42"
                      />
                      <p className={helperClass}>Optional forum or governance thread linked to the campaign.</p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <input
                        className={inputClass}
                        value={form.sponsorName}
                        onChange={(e) => updateField('sponsorName', e.target.value)}
                        placeholder="Nervos Community Fund"
                      />
                      <p className={helperClass}>Sponsor or program label shown on the imported agreement.</p>
                    </div>
                    <div>
                      <input
                        className={inputClass}
                        value={form.sponsorWalletAddress}
                        onChange={(e) => updateField('sponsorWalletAddress', e.target.value)}
                        placeholder={walletAddress || 'ckt1q...'}
                      />
                      <p className={helperClass}>Optional sponsor wallet. If provided, this becomes the real client address while your connected wallet remains the importer.</p>
                    </div>
                    <div className="md:col-span-2">
                      <input
                        className={inputClass}
                        value={form.questBundleTitle}
                        onChange={(e) => updateField('questBundleTitle', e.target.value)}
                        placeholder="Governance Quest Bundle"
                      />
                      <p className={helperClass}>Optional CKBoost quest bundle or campaign grouping.</p>
                    </div>
                  </div>
                  <div className="mt-4">
                    <textarea
                      className={`${inputClass} min-h-24`}
                      value={form.campaignDescription}
                      onChange={(e) => updateField('campaignDescription', e.target.value)}
                      placeholder="Describe the original CKBoost campaign scope and reward context."
                    />
                    <p className={helperClass}>Copy the campaign scope so PactAgent reviewers can compare delivery against the original reward intent.</p>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <textarea
                        className={`${inputClass} min-h-20`}
                        value={form.approvedProofSummary}
                        onChange={(e) => updateField('approvedProofSummary', e.target.value)}
                        placeholder="Optional summary of approved proof already visible in CKBoost."
                      />
                    </div>
                    <div>
                      <input
                        className={inputClass}
                        value={form.approvedProofUrl}
                        onChange={(e) => updateField('approvedProofUrl', e.target.value)}
                        placeholder="https://ckboost.netlify.app/proof/abc"
                      />
                      <p className={helperClass}>Approved proof URL or artifact page if CKBoost already has one.</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-agent-border bg-agent-bg/40 p-5">
                  <h2 className="text-lg font-semibold text-white">Contributor Mapping</h2>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <input className={inputClass} value={form.contributorExternalId} onChange={(e) => updateField('contributorExternalId', e.target.value)} placeholder="contributor-17" />
                      <p className={helperClass}>CKBoost contributor ID.</p>
                    </div>
                    <div>
                      <input className={inputClass} value={form.contributorProfileId} onChange={(e) => updateField('contributorProfileId', e.target.value)} placeholder="profile-17" />
                      <p className={helperClass}>CKBoost profile ID.</p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <input className={inputClass} value={form.contributorDisplayName} onChange={(e) => updateField('contributorDisplayName', e.target.value)} placeholder="Ada Builder" />
                    </div>
                    <div>
                      <input className={inputClass} value={form.contributorHandle} onChange={(e) => updateField('contributorHandle', e.target.value)} placeholder="@ada" />
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <input className={inputClass} value={form.contributorWalletAddress} onChange={(e) => updateField('contributorWalletAddress', e.target.value)} placeholder="ckt1q..." />
                      <p className={helperClass}>This contributor wallet becomes the PactAgent worker address.</p>
                    </div>
                    <div>
                      <input className={inputClass} value={form.contributorProfileUrl} onChange={(e) => updateField('contributorProfileUrl', e.target.value)} placeholder="https://ckboost.netlify.app/profile/ada" />
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-agent-border bg-agent-bg/40 p-5">
                  <h2 className="text-lg font-semibold text-white">Imported Agreement Terms</h2>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <input className={inputClass} value={form.agreementTitle} onChange={(e) => updateField('agreementTitle', e.target.value)} placeholder="CKBoost Campaign Delivery Agreement" />
                      <p className={helperClass}>Optional. Leave blank to derive a title from the campaign.</p>
                    </div>
                    <div>
                      <input className={inputClass} value={form.workerFiberPubkey} onChange={(e) => updateField('workerFiberPubkey', e.target.value)} placeholder="02abcd... or 04abcd..." />
                      <p className={helperClass}>Needed only for Fiber payouts.</p>
                    </div>
                  </div>
                  <div className="mt-4">
                    <textarea
                      className={`${inputClass} min-h-24`}
                      value={form.agreementDescription}
                      onChange={(e) => updateField('agreementDescription', e.target.value)}
                      placeholder="Define the formal PactAgent grant scope, milestone acceptance criteria, and expected deliverables."
                    />
                  </div>

                  <div className="mt-5 rounded-xl border border-agent-border bg-agent-card/50 p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-base font-semibold text-white">Grant Milestones</h3>
                        <p className="mt-1 text-sm text-gray-400">Break the CKBoost campaign into formal payout milestones.</p>
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

                    <div className="mt-4 rounded-xl border border-agent-border bg-agent-bg/60 p-4">
                      <div className="text-xs uppercase tracking-[0.16em] text-gray-500">Total Grant Amount To Lock Upfront</div>
                      <div className="mt-2 text-2xl font-bold text-white">{totalGrantCkb || 0} CKB</div>
                    </div>

                    <div className="mt-4 space-y-4">
                      {milestones.map((milestone, index) => (
                        <div key={index} className="rounded-xl border border-agent-border bg-agent-bg/60 p-4">
                          <div className="mb-4 flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-white">Milestone {index + 1}</div>
                              <p className="text-xs text-gray-500">Formalize one CKBoost deliverable or reward checkpoint.</p>
                            </div>
                            {milestones.length > 1 ? (
                              <button type="button" onClick={() => removeMilestone(index)} className="text-gray-400 hover:text-red-300">
                                <XCircleIcon className="h-5 w-5" />
                              </button>
                            ) : null}
                          </div>
                          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                            <div className="space-y-4">
                              <div>
                                <input className={`${inputClass} ${shouldShowFieldError(milestone.title, milestoneErrors[index].title) ? errorInputClass : ''}`} value={milestone.title} onChange={(e) => updateMilestone(index, 'title', e.target.value)} placeholder="Governance dashboard shipped" />
                                {shouldShowFieldError(milestone.title, milestoneErrors[index].title) ? <p className={fieldErrorClass}>{milestoneErrors[index].title}</p> : null}
                              </div>
                              <div>
                                <textarea className={`${inputClass} min-h-24 ${shouldShowFieldError(milestone.description, milestoneErrors[index].description) ? errorInputClass : ''}`} value={milestone.description} onChange={(e) => updateMilestone(index, 'description', e.target.value)} placeholder="Describe the contributor output, the proof expected, and what the reviewer should verify." />
                                {shouldShowFieldError(milestone.description, milestoneErrors[index].description) ? <p className={fieldErrorClass}>{milestoneErrors[index].description}</p> : null}
                              </div>
                            </div>
                            <div>
                              <input className={`${inputClass} ${shouldShowFieldError(milestone.amountCkb, milestoneErrors[index].amount) ? errorInputClass : ''}`} value={milestone.amountCkb} onChange={(e) => updateMilestone(index, 'amountCkb', e.target.value)} placeholder="120" />
                              {shouldShowFieldError(milestone.amountCkb, milestoneErrors[index].amount) ? <p className={fieldErrorClass}>{milestoneErrors[index].amount}</p> : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <aside className="space-y-5">
                <div className="rounded-2xl border border-agent-border bg-agent-bg/40 p-5">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-amber-200">
                    <TrophyIcon className="h-4 w-4" />
                    Contributor Reputation
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl border border-agent-border bg-agent-card/60 p-3">
                      <div className="text-xs text-gray-500">Approval Rate</div>
                      <div className="mt-1 text-lg font-semibold text-white">{Math.round(computedApprovalRate * 100)}%</div>
                    </div>
                    <div className="rounded-xl border border-agent-border bg-agent-card/60 p-3">
                      <div className="text-xs text-gray-500">Leaderboard</div>
                      <div className="mt-1 text-lg font-semibold text-white">{form.leaderboardRank.trim() || '—'}</div>
                    </div>
                    <div className="rounded-xl border border-agent-border bg-agent-card/60 p-3">
                      <div className="text-xs text-gray-500">Campaigns</div>
                      <div className="mt-1 text-lg font-semibold text-white">{Number(form.campaignParticipationCount) || 0}</div>
                    </div>
                    <div className="rounded-xl border border-agent-border bg-agent-card/60 p-3">
                      <div className="text-xs text-gray-500">Points</div>
                      <div className="mt-1 text-lg font-semibold text-white">{Number(form.totalPoints) || 0}</div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4">
                    <div>
                      <input className={inputClass} value={form.campaignParticipationCount} onChange={(e) => updateField('campaignParticipationCount', e.target.value)} placeholder="12" />
                      <p className={helperClass}>Campaign participation count.</p>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <input className={inputClass} value={form.approvedSubmissionCount} onChange={(e) => updateField('approvedSubmissionCount', e.target.value)} placeholder="10" />
                        <p className={helperClass}>Approved submissions.</p>
                      </div>
                      <div>
                        <input className={inputClass} value={form.rejectedSubmissionCount} onChange={(e) => updateField('rejectedSubmissionCount', e.target.value)} placeholder="1" />
                        <p className={helperClass}>Rejected submissions.</p>
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <input className={inputClass} value={form.leaderboardRank} onChange={(e) => updateField('leaderboardRank', e.target.value)} placeholder="8" />
                        <p className={helperClass}>Leaderboard rank.</p>
                      </div>
                      <div>
                        <input className={inputClass} value={form.totalPoints} onChange={(e) => updateField('totalPoints', e.target.value)} placeholder="420" />
                        <p className={helperClass}>Total points.</p>
                      </div>
                    </div>
                    <div>
                      <input className={inputClass} value={form.totalTipsReceived} onChange={(e) => updateField('totalTipsReceived', e.target.value)} placeholder="0" />
                      <p className={helperClass}>Optional tips received figure from CKBoost.</p>
                    </div>
                    <div>
                      <textarea
                        className={`${inputClass} min-h-32`}
                        value={form.campaignHistory}
                        onChange={(e) => updateField('campaignHistory', e.target.value)}
                        placeholder={'One prior campaign per line\nGovernance dashboard sprint\nDocs cleanup quest'}
                      />
                      <p className={helperClass}>Optional prior campaign history shown on the agreement after import.</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-agent-border bg-agent-bg/40 p-5">
                  <h2 className="text-lg font-semibold text-white">Settlement Rules</h2>
                  <div className="mt-4 grid gap-4">
                    <div>
                      <select className={inputClass} value={form.proofType} onChange={(e) => updateField('proofType', e.target.value)}>
                        <option value="URL">URL</option>
                        <option value="TEXT">Text</option>
                        <option value="FILE_HASH">File Hash</option>
                      </select>
                    </div>
                    <div>
                      <select className={inputClass} value={form.payoutNetwork} onChange={(e) => updateField('payoutNetwork', e.target.value)}>
                        <option value="CKB">CKB</option>
                        <option value="FIBER">FIBER</option>
                      </select>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <input className={inputClass} value={form.deadlineDays} onChange={(e) => updateField('deadlineDays', e.target.value)} placeholder="7" />
                        <p className={helperClass}>Days until the handoff grant expires.</p>
                      </div>
                      <div>
                        <input className={inputClass} value={form.disputeWindowHours} onChange={(e) => updateField('disputeWindowHours', e.target.value)} placeholder="24" />
                        <p className={helperClass}>Dispute window after each review decision.</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl border border-agent-border bg-agent-card/60 p-4 text-sm text-gray-300">
                    Imported CKBoost campaigns always use manual review and partial release mode so contributor work can be stepped into a formal grant lifecycle safely.
                  </div>
                </div>
              </aside>
            </div>

            {error ? (
              <div className="rounded-xl border border-red-800 bg-red-900/30 p-4 text-sm text-red-200">
                {error}
              </div>
            ) : null}

            <div className="flex flex-col gap-3 border-t border-agent-border px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-gray-400">
                CKBoost handoffs preserve campaign attribution, contributor reputation, and external IDs so future sync and notifications can flow both ways.
              </div>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center justify-center rounded-xl bg-agent-accent px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-60"
              >
                {saving ? 'Importing...' : 'Create from CKBoost'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
