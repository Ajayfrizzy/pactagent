'use client';
import { BoltIcon, LinkIcon } from './Icons';

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  DRAFT: { bg: 'bg-gray-700/50', text: 'text-gray-300', dot: 'bg-gray-400' },
  CANCELLED: { bg: 'bg-zinc-800/60', text: 'text-zinc-300', dot: 'bg-zinc-400' },
  PENDING: { bg: 'bg-slate-800/60', text: 'text-slate-300', dot: 'bg-slate-400' },
  CONFIRMED: { bg: 'bg-emerald-900/50', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  ACTIVE: { bg: 'bg-blue-900/50', text: 'text-blue-300', dot: 'bg-blue-400' },
  FUNDED: { bg: 'bg-blue-900/50', text: 'text-blue-300', dot: 'bg-blue-400' },
  FUNDING_PENDING: { bg: 'bg-sky-900/50', text: 'text-sky-300', dot: 'bg-sky-400' },
  PROOF_SUBMITTED: { bg: 'bg-yellow-900/50', text: 'text-yellow-300', dot: 'bg-yellow-400' },
  UNDER_REVIEW: { bg: 'bg-orange-900/50', text: 'text-orange-300', dot: 'bg-orange-400' },
  APPROVED: { bg: 'bg-emerald-900/50', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  PAYOUT_PENDING: { bg: 'bg-cyan-900/50', text: 'text-cyan-300', dot: 'bg-cyan-400' },
  PAYOUT_CONFIRMED: { bg: 'bg-green-900/50', text: 'text-green-300', dot: 'bg-green-400' },
  SPLIT_PENDING: { bg: 'bg-teal-900/50', text: 'text-teal-300', dot: 'bg-teal-400' },
  SPLIT_CONFIRMED: { bg: 'bg-emerald-900/50', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  PAID: { bg: 'bg-green-900/50', text: 'text-green-300', dot: 'bg-green-400' },
  DISPUTED: { bg: 'bg-red-900/50', text: 'text-red-300', dot: 'bg-red-400' },
  AWAITING_RESPONSE: { bg: 'bg-orange-950/50', text: 'text-orange-300', dot: 'bg-orange-400' },
  READY_FOR_REVIEW: { bg: 'bg-purple-950/50', text: 'text-purple-300', dot: 'bg-purple-400' },
  NEGOTIATING_REFUND: { bg: 'bg-amber-950/50', text: 'text-amber-300', dot: 'bg-amber-400' },
  NEGOTIATING_SPLIT: { bg: 'bg-cyan-950/50', text: 'text-cyan-300', dot: 'bg-cyan-400' },
  RESOLVED: { bg: 'bg-emerald-950/50', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  FUNDING_IN_PROGRESS: { bg: 'bg-sky-900/50', text: 'text-sky-300', dot: 'bg-sky-400' },
  PAYOUT_IN_PROGRESS: { bg: 'bg-cyan-900/50', text: 'text-cyan-300', dot: 'bg-cyan-400' },
  REFUND_IN_PROGRESS: { bg: 'bg-indigo-900/50', text: 'text-indigo-300', dot: 'bg-indigo-400' },
  SPLIT_IN_PROGRESS: { bg: 'bg-teal-900/50', text: 'text-teal-300', dot: 'bg-teal-400' },
  ACTIVE_MILESTONE: { bg: 'bg-blue-900/50', text: 'text-blue-300', dot: 'bg-blue-400' },
  PROOF_REVIEW: { bg: 'bg-yellow-900/50', text: 'text-yellow-300', dot: 'bg-yellow-400' },
  APPROVED_FOR_SETTLEMENT: { bg: 'bg-emerald-900/50', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  COMPLETED: { bg: 'bg-green-900/50', text: 'text-green-300', dot: 'bg-green-400' },
  SETTLEMENT_ATTENTION: { bg: 'bg-rose-900/50', text: 'text-rose-300', dot: 'bg-rose-400' },
  DISPUTE_LOCKED: { bg: 'bg-fuchsia-900/50', text: 'text-fuchsia-300', dot: 'bg-fuchsia-400' },
  REFUND_PENDING: { bg: 'bg-indigo-900/50', text: 'text-indigo-300', dot: 'bg-indigo-400' },
  REFUND_CONFIRMED: { bg: 'bg-purple-900/50', text: 'text-purple-300', dot: 'bg-purple-400' },
  REFUNDED: { bg: 'bg-purple-900/50', text: 'text-purple-300', dot: 'bg-purple-400' },
  FAILED: { bg: 'bg-rose-900/50', text: 'text-rose-300', dot: 'bg-rose-400' },
  UNFUNDED: { bg: 'bg-slate-800/60', text: 'text-slate-300', dot: 'bg-slate-400' },
  FUNDING: { bg: 'bg-sky-950/60', text: 'text-sky-300', dot: 'bg-sky-400' },
  PAYOUT: { bg: 'bg-cyan-950/60', text: 'text-cyan-300', dot: 'bg-cyan-400' },
  REFUND: { bg: 'bg-indigo-950/60', text: 'text-indigo-300', dot: 'bg-indigo-400' },
  USER: { bg: 'bg-slate-800/60', text: 'text-slate-300', dot: 'bg-slate-400' },
  SYSTEM: { bg: 'bg-violet-950/60', text: 'text-violet-300', dot: 'bg-violet-400' },
  EXPIRED: { bg: 'bg-zinc-700/50', text: 'text-zinc-400', dot: 'bg-zinc-500' },
};

export function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.DRAFT;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export function NetworkBadge({ network }: { network: string }) {
  const isFiber = network === 'FIBER';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
      isFiber ? 'bg-violet-900/50 text-violet-300' : 'bg-emerald-900/50 text-emerald-300'
    }`}>
      {isFiber ? <BoltIcon className="w-3 h-3" /> : <LinkIcon className="w-3 h-3" />}
      {network}
    </span>
  );
}

export function LogLevelBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    INFO: 'bg-blue-900/50 text-blue-300',
    WARN: 'bg-yellow-900/50 text-yellow-300',
    ERROR: 'bg-red-900/50 text-red-300',
    SUCCESS: 'bg-green-900/50 text-green-300',
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${colors[level] || colors.INFO}`}>
      {level}
    </span>
  );
}
