'use client';
import { useState, useEffect, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { fetchLogs, fetchPublicLogs } from '@/lib/api';
import { LogLevelBadge } from './StatusBadge';
import {
  DocumentTextIcon, ClockIcon, CheckCircleIcon, PaperClipIcon,
  MagnifyingGlassIcon, XCircleIcon, ExclamationTriangleIcon,
  AgentIcon, CurrencyDollarIcon, RocketLaunchIcon, TrophyIcon,
  ArrowUturnLeftIcon, BoltIcon, FireIcon, ChevronDownIcon, ChevronRightIcon,
  ClipboardDocumentCheckIcon,
} from './Icons';

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
  ERROR:                   { icon: FireIcon,                  color: 'text-red-500' },
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

function maskPublicMessage(message: string) {
  return message
    .replace(/ckt1[a-z0-9]{18,}/gi, 'ckt1...redacted')
    .replace(/0x[a-f0-9]{40}/gi, '0x...redacted');
}

export function AgentLogPanel({ agreementId, allowedAgreementIds, publicFeed = false }: { agreementId?: string; allowedAgreementIds?: string[]; publicFeed?: boolean }) {
  const liveLogs = useStore((s) => s.logs);
  const wsConnected = useStore((s) => s.wsConnected);
  const authToken = useStore((s) => s.authToken);
  const [historicalLogs, setHistoricalLogs] = useState<LogEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);

  const allowedIds = useMemo(
    () => new Set((allowedAgreementIds || []).filter(Boolean)),
    [allowedAgreementIds]
  );

  useEffect(() => {
    async function load() {
      if (publicFeed) {
        setLoading(true);
        try {
          const logs = await fetchPublicLogs(25);
          setHistoricalLogs(logs);
        } catch (err) {
          console.error('Failed to load public logs:', err);
          setHistoricalLogs([]);
        } finally {
          setLoading(false);
        }
        return;
      }

      if (!authToken) {
        setHistoricalLogs([]);
        setLoading(false);
        return;
      }

      if (!agreementId && allowedAgreementIds && allowedAgreementIds.length === 0) {
        setHistoricalLogs([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const logs = await fetchLogs(agreementId, 100);
        setHistoricalLogs(logs);
      } catch (err) {
        console.error('Failed to load logs:', err);
        setHistoricalLogs([]);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [agreementId, allowedAgreementIds, authToken, publicFeed]);

  const allLogs = [...liveLogs, ...historicalLogs]
    .filter((log, index, self) => self.findIndex((item) => item.id === log.id) === index)
    .filter((log) => {
      if (publicFeed) {
        return !!log.agreementId;
      }

      if (agreementId) {
        return log.agreementId === agreementId;
      }

      if (allowedAgreementIds) {
        return !!log.agreementId && allowedIds.has(log.agreementId);
      }

      return false;
    })
    .filter((log) => filter === 'ALL' || log.level === filter)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="overflow-hidden rounded-xl border border-agent-border bg-agent-card">
      <div className="border-b border-agent-border bg-agent-bg/50 px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <div className={`h-2.5 w-2.5 rounded-full ${wsConnected ? 'bg-green-400 agent-active' : 'bg-red-400'}`} />
            <div className="flex items-center gap-1.5">
              <AgentIcon className="h-4 w-4 text-agent-accent" />
              <h3 className="text-xs font-semibold text-white sm:text-sm">Agent Log Panel</h3>
            </div>
            <span className="pl-1 text-[11px] text-gray-500 sm:pl-2 sm:text-xs">
              {wsConnected ? 'Live' : 'Reconnecting...'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1 sm:justify-end sm:pt-0">
            {['ALL', 'INFO', 'SUCCESS', 'WARN', 'ERROR'].map((level) => (
              <button
                key={level}
                onClick={() => setFilter(level)}
                className={`rounded px-2 py-0.5 text-[10px] font-mono transition-colors ${
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
      </div>

      <div className="max-h-[500px] overflow-y-auto agent-log-scroll">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-500">
            <div className="mr-3 h-5 w-5 animate-spin rounded-full border-2 border-agent-accent border-t-transparent" />
            Loading agent logs...
          </div>
        ) : allLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <AgentIcon className="mb-2 h-8 w-8 text-gray-600" />
            <span className="text-sm">No agent activity yet</span>
            <span className="mt-1 text-center text-xs">
              {publicFeed
                ? 'Recent agreement activity will appear here as the agent works.'
                : 'Activity will appear here only for agreements tied to this wallet.'}
            </span>
          </div>
        ) : (
          <div className="divide-y divide-agent-border/50">
            {allLogs.map((log) => {
              const { icon: IconComponent, color } = EVENT_ICON_MAP[log.eventType] || DEFAULT_EVENT_ICON;
              const showMetadata = Boolean(log.metadataJson && !publicFeed);
              const displayMessage = publicFeed ? maskPublicMessage(log.message) : log.message;

              return (
                <div
                  key={log.id}
                  className="group cursor-pointer transition-colors hover:bg-agent-bg/30"
                  onClick={() => showMetadata && setExpandedId(expandedId === log.id ? null : log.id)}
                >
                  <div className="flex items-start gap-3 px-4 py-2.5">
                    <IconComponent className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />

                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex flex-wrap items-center gap-2">
                        <LogLevelBadge level={log.level} />
                        <span className="text-[9px] font-mono text-gray-500 sm:text-[10px]">
                          {log.eventType}
                        </span>
                      </div>
                      <p className="truncate text-xs text-gray-200 sm:text-sm">
                        {displayMessage}
                      </p>
                    </div>

                    <span className="mt-1 shrink-0 text-[10px] font-mono text-gray-500">
                      {new Date(log.createdAt).toLocaleTimeString()}
                    </span>

                    {showMetadata && (
                      <span className="mt-0.5 inline-flex items-center justify-center rounded-md bg-agent-bg/80 p-1 text-gray-300 transition-colors group-hover:text-white">
                        {expandedId === log.id ? <ChevronDownIcon className="h-4 w-4 stroke-[2.5]" /> : <ChevronRightIcon className="h-4 w-4 stroke-[2.5]" />}
                      </span>
                    )}
                  </div>

                  {expandedId === log.id && showMetadata && (
                    <div className="px-4 pb-3 pl-12">
                      <pre className="overflow-x-auto rounded-lg bg-agent-bg p-3 text-[11px] font-mono text-gray-400">
                        {JSON.stringify(JSON.parse(log.metadataJson as string), null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-agent-border bg-agent-bg/30 px-4 py-2 text-[10px] text-gray-500">
        <span>{allLogs.length} events</span>
        <span>Agent cycle: 10s</span>
      </div>
    </div>
  );
}
