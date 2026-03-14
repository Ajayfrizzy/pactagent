'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { WalletConnect } from '@/components/WalletConnect';
import { useStore } from '@/lib/store';
import { useWebSocket } from '@/hooks/useWebSocket';
import { createAgreement } from '@/lib/api';
import { ckbToShannons } from '@/lib/ckb';
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

export default function NewAgreementPage() {
  useWebSocket();
  const router = useRouter();
  const walletAddress = useStore((s) => s.walletAddress);
  const authToken = useStore((s) => s.authToken);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    workerAddress: '',
    deadlineDays: '7',
    disputeWindowHours: '24',
    proofType: 'URL',
    reviewerMode: 'AUTO',
    releaseMode: 'PARTIAL',
    payoutNetwork: 'CKB',
  });
  const [milestones, setMilestones] = useState<MilestoneDraft[]>(defaultMilestones);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!walletAddress || !authToken) {
      setError('Please connect and authenticate your wallet first');
      return;
    }

    const hasInvalidMilestone = milestones.some(
      (milestone) => !milestone.title.trim() || !milestone.description.trim() || !milestone.amountCKB.trim()
    );
    if (hasInvalidMilestone) {
      setError('Every milestone needs a title, description, and amount');
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
        deadlineAt,
        disputeWindowSecs: parseInt(form.disputeWindowHours, 10) * 3600,
        proofType: form.proofType,
        reviewerMode: form.reviewerMode,
        releaseMode: form.releaseMode,
        payoutNetwork: form.payoutNetwork,
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
      <nav className="border-b border-agent-border bg-agent-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="flex items-center gap-2 group">
              <ArrowLeftIcon className="w-4 h-4 text-gray-500 group-hover:text-white transition-colors" />
              <AgentIcon className="w-5 h-5 text-agent-accent" />
              <span className="text-lg font-bold text-white">PactAgent</span>
            </Link>
            <span className="text-gray-600">/</span>
            <span className="text-sm text-gray-400">New Agreement</span>
          </div>
          <WalletConnect />
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-white mb-2">Create Milestone Agreement</h1>
        <p className="text-sm text-gray-400 mb-8">
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
              className={`${inputClass} h-24 resize-none`}
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
          </div>

          <div className="grid grid-cols-2 gap-4">
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

          <div className="grid grid-cols-3 gap-4">
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

          <div className="bg-agent-card border border-agent-border rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-white font-semibold">Milestones</h2>
                <p className="text-xs text-gray-400 mt-1">
                  The worker will deliver and get paid one milestone at a time.
                </p>
              </div>
              <button
                type="button"
                onClick={addMilestone}
                className="bg-agent-accent hover:bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5"
              >
                <PlusIcon className="w-4 h-4" />
                Add Milestone
              </button>
            </div>

            <div className="space-y-4">
              {milestones.map((milestone, index) => (
                <div key={index} className="bg-agent-bg border border-agent-border rounded-xl p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-white">Milestone {index + 1}</h3>
                    {milestones.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeMilestone(index)}
                        className="text-xs text-red-300 hover:text-red-200 flex items-center gap-1"
                      >
                        <XCircleIcon className="w-4 h-4" />
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
                        className={`${inputClass} h-20 resize-none`}
                        value={milestone.description}
                        onChange={(e) => updateMilestone(index, 'description', e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Milestone Amount (CKB)</label>
                      <input
                        type="number"
                        className={inputClass}
                        placeholder="100"
                        min="1"
                        step="any"
                        value={milestone.amountCKB}
                        onChange={(e) => updateMilestone(index, 'amountCKB', e.target.value)}
                        required
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between text-sm border-t border-agent-border pt-4">
              <span className="text-gray-400">Total escrow amount</span>
              <span className="font-mono text-white">{totalCkb || 0} CKB</span>
            </div>
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !walletAddress || !authToken}
            className="w-full bg-agent-accent hover:bg-blue-600 disabled:opacity-50 text-white py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                Creating...
              </>
            ) : (
              <>
                <DocumentTextIcon className="w-4 h-4" />
                Create Milestone Agreement
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
