'use client';
import { useState, useEffect } from 'react';
import { WalletConnect } from '@/components/WalletConnect';
import { AgentLogPanel } from '@/components/AgentLogPanel';
import { StatusBadge, NetworkBadge } from '@/components/StatusBadge';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useStore } from '@/lib/store';
import { fetchAgreements } from '@/lib/api';
import { shannonsToCKB } from '@/lib/ckb';
import { AgentIcon, ArrowLeftIcon, PlusIcon, DocumentTextIcon } from '@/components/Icons';
import Link from 'next/link';

export default function DashboardPage() {
  useWebSocket();
  const walletAddress = useStore((s) => s.walletAddress);
  const authToken = useStore((s) => s.authToken);
  const updateCount = useStore((s) => s.agreementUpdateCount);
  const [agreements, setAgreements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!authToken) {
        setAgreements([]);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const data = await fetchAgreements(walletAddress || undefined);
        setAgreements(data);
        setError(null);
      } catch (err) {
        console.error('Failed to load agreements:', err);
        setError(err instanceof Error ? err.message : 'Failed to load agreements');
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [authToken, walletAddress, updateCount]);

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="border-b border-agent-border bg-agent-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 group">
              <ArrowLeftIcon className="w-4 h-4 text-gray-500 group-hover:text-white transition-colors" />
              <AgentIcon className="w-5 h-5 text-agent-accent" />
              <span className="text-lg font-bold text-white">PactAgent</span>
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/agreement/new"
              className="bg-agent-accent hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
            >
              <PlusIcon className="w-4 h-4" />
              New Agreement
            </Link>
            <WalletConnect />
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Agreements List */}
          <div className="lg:col-span-2">
            <h2 className="text-xl font-bold text-white mb-6">Your Agreements</h2>

            {loading ? (
              <div className="flex items-center justify-center py-20 text-gray-500">
                <div className="animate-spin w-6 h-6 border-2 border-agent-accent border-t-transparent rounded-full mr-3" />
                Loading agreements...
              </div>
            ) : !authToken ? (
              <div className="bg-agent-card border border-agent-border rounded-xl p-12 text-center">
                <DocumentTextIcon className="w-10 h-10 text-gray-600 mx-auto mb-4" />
                <h3 className="text-white font-semibold mb-2">Connect your wallet to continue</h3>
                <p className="text-sm text-gray-400">
                  Agreement access is tied to your authenticated wallet session.
                </p>
              </div>
            ) : error ? (
              <div className="bg-red-900/30 border border-red-800 rounded-xl p-6 text-sm text-red-200">
                {error}
              </div>
            ) : agreements.length === 0 ? (
              <div className="bg-agent-card border border-agent-border rounded-xl p-12 text-center">
                <DocumentTextIcon className="w-10 h-10 text-gray-600 mx-auto mb-4" />
                <h3 className="text-white font-semibold mb-2">No agreements yet</h3>
                <p className="text-sm text-gray-400 mb-6">Create your first payment agreement to get started.</p>
                <Link
                  href="/agreement/new"
                  className="inline-flex items-center gap-1.5 bg-agent-accent hover:bg-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
                >
                  <PlusIcon className="w-4 h-4" />
                  Create Agreement
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {agreements.map((ag) => {
                  const paidMilestones = ag.milestones?.filter((milestone: any) => milestone.status === 'PAID').length ?? 0;
                  const totalMilestones = ag.milestones?.length ?? 0;

                  return (
                  <Link
                    key={ag.id}
                    href={`/agreement/${ag.id}`}
                    className="block bg-agent-card border border-agent-border rounded-xl p-5 hover:border-agent-accent/50 transition-all group"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="text-white font-semibold group-hover:text-agent-accent transition-colors">
                          {ag.title}
                        </h3>
                        <p className="text-xs text-gray-500 mt-1">{ag.id.slice(0, 8)}...</p>
                      </div>
                      <StatusBadge status={ag.status} />
                    </div>
                    <p className="text-sm text-gray-400 mb-3 line-clamp-2">{ag.description}</p>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span className="font-mono">{shannonsToCKB(ag.amount)} CKB</span>
                      <NetworkBadge network={ag.payoutNetwork} />
                      <span>
                        Milestones: {paidMilestones}/{totalMilestones}
                      </span>
                      <span>Mode: {ag.reviewerMode}</span>
                      <span>Deadline: {new Date(ag.deadlineAt).toLocaleDateString()}</span>
                    </div>
                  </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Agent Panel Sidebar */}
          <div className="lg:col-span-1">
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Agent Activity
            </h2>
            <AgentLogPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
