'use client';
import { WalletConnect } from '@/components/WalletConnect';
import { AgentLogPanel } from '@/components/AgentLogPanel';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useStore } from '@/lib/store';
import { AgentIcon, EyeIcon, CpuChipIcon, BoltIcon } from '@/components/Icons';
import Link from 'next/link';

export default function HomePage() {
  useWebSocket();
  const walletAddress = useStore((s) => s.walletAddress);

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="border-b border-agent-border bg-agent-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AgentIcon className="w-6 h-6 text-agent-accent" />
            <span className="text-lg font-bold text-white">PactAgent</span>
            <span className="text-xs text-gray-500 bg-agent-bg px-2 py-0.5 rounded">CKB Testnet</span>
          </div>
          <div className="flex items-center gap-6">
            {walletAddress && (
              <Link href="/dashboard" className="text-sm text-gray-400 hover:text-white transition-colors">
                Dashboard
              </Link>
            )}
            <WalletConnect />
          </div>
        </div>
      </nav>

      {/* Hero */}
      <div className="max-w-7xl mx-auto px-6 pt-20 pb-16">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-agent-accent/10 border border-agent-accent/30 rounded-full px-4 py-1.5 mb-6">
            <span className="w-2 h-2 rounded-full bg-agent-accent animate-pulse" />
            <span className="text-xs text-agent-accent font-medium">Autonomous Agent Active</span>
          </div>
          <h1 className="text-5xl font-bold text-white mb-4 leading-tight">
            Autonomous Payment<br />Agreements on CKB
          </h1>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto mb-8">
            Create milestone-based payment agreements, lock funds on-chain, submit proof of work,
            and let the AI agent handle verification and release automatically.
          </p>
          <div className="flex items-center justify-center gap-4">
            {walletAddress ? (
              <>
                <Link
                  href="/dashboard"
                  className="bg-agent-accent hover:bg-blue-600 text-white px-6 py-3 rounded-lg font-medium transition-colors"
                >
                  Go to Dashboard →
                </Link>
                <Link
                  href="/agreement/new"
                  className="bg-agent-card border border-agent-border hover:border-agent-accent text-white px-6 py-3 rounded-lg font-medium transition-colors"
                >
                  Create Agreement
                </Link>
              </>
            ) : (
              <div className="text-center">
                <p className="text-sm text-gray-500 mb-4">Connect your wallet to get started</p>
                <WalletConnect />
              </div>
            )}
          </div>
        </div>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          <div className="bg-agent-card border border-agent-border rounded-xl p-6">
            <div className="w-10 h-10 rounded-lg bg-blue-900/50 flex items-center justify-center mb-3">
              <EyeIcon className="w-5 h-5 text-blue-400" />
            </div>
            <h3 className="text-white font-semibold mb-2">Observe</h3>
            <p className="text-sm text-gray-400">
              Agent continuously monitors agreements, proof submissions, disputes, and deadlines.
            </p>
          </div>
          <div className="bg-agent-card border border-agent-border rounded-xl p-6">
            <div className="w-10 h-10 rounded-lg bg-purple-900/50 flex items-center justify-center mb-3">
              <CpuChipIcon className="w-5 h-5 text-purple-400" />
            </div>
            <h3 className="text-white font-semibold mb-2">Decide</h3>
            <p className="text-sm text-gray-400">
              Evaluates deterministic rules, validates state transitions, and generates AI recommendations.
            </p>
          </div>
          <div className="bg-agent-card border border-agent-border rounded-xl p-6">
            <div className="w-10 h-10 rounded-lg bg-amber-900/50 flex items-center justify-center mb-3">
              <BoltIcon className="w-5 h-5 text-amber-400" />
            </div>
            <h3 className="text-white font-semibold mb-2">Act</h3>
            <p className="text-sm text-gray-400">
              Releases payments on CKB or via Fiber, processes refunds, and resolves disputes.
            </p>
          </div>
        </div>

        {/* Tech Pills */}
        <div className="flex flex-wrap justify-center gap-3 mb-16">
          {['Nervos CKB', 'CCC Wallet', 'Fiber Network', 'AI Dispute Engine', 'Real-time Agent', 'TypeScript'].map((tech) => (
            <span key={tech} className="bg-agent-card border border-agent-border rounded-full px-4 py-1.5 text-xs text-gray-400">
              {tech}
            </span>
          ))}
        </div>

        {/* Live Agent Log Panel on landing page */}
        <div className="max-w-4xl mx-auto">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            Live Agent Activity
          </h2>
          <AgentLogPanel />
        </div>
      </div>
    </div>
  );
}
