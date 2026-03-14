'use client';
import { useState, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { fetchLogs } from '@/lib/api';
import { LogLevelBadge } from './StatusBadge';
import {
  DocumentTextIcon, ClockIcon, CheckCircleIcon, PaperClipIcon,
  MagnifyingGlassIcon, XCircleIcon, ExclamationTriangleIcon,
  AgentIcon, CurrencyDollarIcon, RocketLaunchIcon, TrophyIcon,
  ArrowUturnLeftIcon, BoltIcon, FireIcon, ChevronDownIcon, ChevronRightIcon,
  ClipboardDocumentCheckIcon,
} from './Icons';

/**
 * Agent Log Panel — the crown jewel of the demo.
 * Shows real-time agent actions: Observe → Decide → Act
 * Supports filtering, expanding metadata, and live streaming.
 */

const EVENT_ICON_MAP: Record<string, { icon: React.FC<{ className?: string }>; color: string }> = {
  AGREEMENT_CREATED:       { icon: DocumentTextIcon,          color: 'text-blue-400' },
  MILESTONE_ACTIVATED:     { icon: ClockIcon,                 color: 'text-cyan-400' },
  FUNDING_PENDING:         { icon: ClockIcon,                 color: 'text-yellow-400' },
  FUNDING_CONFIRMED:       { icon: CheckCircleIcon,           color: 'text-green-400' },
  PROOF_SUBMITTED:         { icon: PaperClipIcon,             color: 'text-amber-400' },
  RULE_CHECK_STARTED:      { icon: MagnifyingGlassIcon,       color: 'text-blue-300' },
  RULE_CHECK_PASSED:       { icon: CheckCircleIcon,           color: 'text-emerald-400' },
  RULE_CHECK_FAILED:       { icon: XCircleIcon,               color: 'text-red-400' },
  DISPUTE_OPENED:          { icon: ExclamationTriangleIcon,   color: 'text-orange-400' },
  AI_RECOMMENDATION_READY: { icon: AgentIcon,                 color: 'text-purple-400' },
  RELEASE_PREPARED:        { icon: CurrencyDollarIcon,        color: 'text-emerald-400' },
  RELEASE_SENT:            { icon: RocketLaunchIcon,          color: 'text-blue-400' },
  SETTLEMENT_CONFIRMED:    { icon: TrophyIcon,                color: 'text-green-400' },
  REFUND_SENT:             { icon: ArrowUturnLeftIcon,        color: 'text-purple-400' },
  FIBER_PAYOUT_INITIATED:  { icon: BoltIcon,                  color: 'text-violet-400' },
  FIBER_PAYOUT_CONFIRMED:  { icon: BoltIcon,                  color: 'text-violet-300' },
  ERROR:                   { icon: FireIcon,                   color: 'text-red-500' },
};

const DEFAULT_EVENT_ICON = { icon: ClipboardDocumentCheckIcon, color: 'text-gray-400' };

interface LogEntry {
  id: string;
  agreementId: string | null;
  level: string;
  eventType: string;
  message: string;
  metadataJson: string | null;
  createdAt: string;
}

export function AgentLogPanel({ agreementId }: { agreementId?: string }) {
  const liveLogs = useStore((s) => s.logs);
  const wsConnected = useStore((s) => s.wsConnected);
  const [historicalLogs, setHistoricalLogs] = useState<LogEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);

  // Load historical logs on mount
  useEffect(() => {
    async function load() {
      try {
        const logs = await fetchLogs(agreementId, 100);
        setHistoricalLogs(logs);
      } catch (err) {
        console.error('Failed to load logs:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [agreementId]);

  // Merge live + historical, deduplicate by id
  const allLogs = [...liveLogs, ...historicalLogs]
    .filter((log, index, self) => self.findIndex(l => l.id === log.id) === index)
    .filter(log => !agreementId || log.agreementId === agreementId)
    .filter(log => filter === 'ALL' || log.level === filter)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="bg-agent-card border border-agent-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-agent-border bg-agent-bg/50">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${wsConnected ? 'bg-green-400 agent-active' : 'bg-red-400'}`} />
          <div className="flex items-center gap-1.5">
            <AgentIcon className="w-4 h-4 text-agent-accent" />
            <h3 className="text-sm font-semibold text-white">Agent Log Panel</h3>
          </div>
          <span className="text-xs text-gray-500">
            {wsConnected ? 'Live' : 'Reconnecting...'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {['ALL', 'INFO', 'SUCCESS', 'WARN', 'ERROR'].map((level) => (
            <button
              key={level}
              onClick={() => setFilter(level)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                filter === level
                  ? 'bg-agent-accent text-white'
                  : 'bg-agent-bg text-gray-400 hover:text-gray-200'
              }`}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      {/* Log entries */}
      <div className="max-h-[500px] overflow-y-auto agent-log-scroll">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-500">
            <div className="animate-spin w-5 h-5 border-2 border-agent-accent border-t-transparent rounded-full mr-3" />
            Loading agent logs...
          </div>
        ) : allLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <AgentIcon className="w-8 h-8 text-gray-600 mb-2" />
            <span className="text-sm">No agent activity yet</span>
            <span className="text-xs mt-1">The agent will appear here once it starts observing</span>
          </div>
        ) : (
          <div className="divide-y divide-agent-border/50">
            {allLogs.map((log) => {
              const { icon: IconComponent, color } = EVENT_ICON_MAP[log.eventType] || DEFAULT_EVENT_ICON;
              return (
                <div
                  key={log.id}
                  className="group hover:bg-agent-bg/30 transition-colors cursor-pointer"
                  onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                >
                  <div className="flex items-start gap-3 px-4 py-2.5">
                    {/* Icon */}
                    <IconComponent className={`w-4 h-4 mt-0.5 shrink-0 ${color}`} />

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <LogLevelBadge level={log.level} />
                        <span className="text-[10px] font-mono text-gray-500">
                          {log.eventType}
                        </span>
                      </div>
                      <p className="text-sm text-gray-200 truncate">
                        {log.message}
                      </p>
                    </div>

                    {/* Timestamp */}
                    <span className="text-[10px] text-gray-500 font-mono shrink-0 mt-1">
                      {new Date(log.createdAt).toLocaleTimeString()}
                    </span>

                    {/* Expand indicator */}
                    {log.metadataJson && (
                      <span className="text-gray-600 mt-0.5">
                        {expandedId === log.id ? <ChevronDownIcon className="w-3.5 h-3.5" /> : <ChevronRightIcon className="w-3.5 h-3.5" />}
                      </span>
                    )}
                  </div>

                  {/* Expanded metadata */}
                  {expandedId === log.id && log.metadataJson && (
                    <div className="px-4 pb-3 pl-12">
                      <pre className="text-[11px] font-mono text-gray-400 bg-agent-bg rounded-lg p-3 overflow-x-auto">
                        {JSON.stringify(JSON.parse(log.metadataJson), null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-agent-border bg-agent-bg/30 text-[10px] text-gray-500">
        <span>{allLogs.length} events</span>
        <span>Agent cycle: 10s</span>
      </div>
    </div>
  );
}
