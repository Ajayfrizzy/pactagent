'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { WalletConnect } from '@/components/WalletConnect';
import { AgentLogPanel } from '@/components/AgentLogPanel';
import { NavbarMenu } from '@/components/NavbarMenu';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useStore } from '@/lib/store';
import { fetchAgreements } from '@/lib/api';
import { AgentIcon, EyeIcon, CpuChipIcon, BoltIcon } from '@/components/Icons';

export default function HomePage() {
  useWebSocket();
  const walletAddress = useStore((s) => s.walletAddress);
  const authToken = useStore((s) => s.authToken);
  const [agreementIds, setAgreementIds] = useState<string[]>([]);

  useEffect(() => {
    async function loadAgreementIds() {
      if (!authToken || !walletAddress) {
        setAgreementIds([]);
        return;
      }

      try {
        const agreements = await fetchAgreements(walletAddress);
        setAgreementIds(agreements.map((agreement) => agreement.id));
      } catch (error) {
        console.error('Failed to load agreement ids for homepage activity:', error);
        setAgreementIds([]);
      }
    }

    void loadAgreementIds();
  }, [authToken, walletAddress]);

  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-50 border-b border-agent-border bg-agent-card/50 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <AgentIcon className="h-6 w-6 shrink-0 text-agent-accent" />
            <span className="truncate text-lg font-bold text-white">PactAgent</span>
            <span className="hidden rounded bg-agent-bg px-2 py-0.5 text-xs text-gray-500 sm:inline-block">CKB Testnet</span>
          </div>
          <NavbarMenu>
            {walletAddress ? (
              <Link href="/dashboard" className="text-sm text-gray-400 transition-colors hover:text-white">
                Dashboard
              </Link>
            ) : null}
          </NavbarMenu>
        </div>
      </nav>

      <div className="mx-auto max-w-7xl px-4 pb-16 pt-16 sm:px-6 sm:pt-20">
        <div className="mb-16 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-agent-accent/30 bg-agent-accent/10 px-4 py-1.5">
            <span className="h-2 w-2 rounded-full bg-agent-accent animate-pulse" />
            <span className="text-xs font-medium text-agent-accent">Autonomous Agent Active</span>
          </div>
          <h1 className="mb-4 text-4xl font-bold leading-tight text-white sm:text-5xl">
            Autonomous Payment<br />Agreements on CKB
          </h1>
          <p className="mx-auto mb-8 max-w-2xl text-base text-gray-400 sm:text-lg">
            Create milestone-based payment agreements, lock funds on-chain, submit proof of work,
            and let the AI agent handle verification and release automatically.
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            {walletAddress ? (
              <>
                <Link
                  href="/dashboard"
                  className="w-full rounded-lg bg-agent-accent px-6 py-3 font-medium text-white transition-colors hover:bg-blue-600 sm:w-auto"
                >
                  Go to Dashboard
                </Link>
                <Link
                  href="/agreement/new"
                  className="w-full rounded-lg border border-agent-border bg-agent-card px-6 py-3 font-medium text-white transition-colors hover:border-agent-accent sm:w-auto"
                >
                  Create Agreement
                </Link>
              </>
            ) : (
              <div className="text-center">
                <p className="mb-4 text-sm text-gray-500">Connect your wallet to get started</p>
                <div className="flex justify-center">
                  <WalletConnect />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mb-16 grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="rounded-xl border border-agent-border bg-agent-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-900/50">
              <EyeIcon className="h-5 w-5 text-blue-400" />
            </div>
            <h3 className="mb-2 font-semibold text-white">Observe</h3>
            <p className="text-sm text-gray-400">
              Agent continuously monitors agreements, proof submissions, disputes, and deadlines.
            </p>
          </div>
          <div className="rounded-xl border border-agent-border bg-agent-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-purple-900/50">
              <CpuChipIcon className="h-5 w-5 text-purple-400" />
            </div>
            <h3 className="mb-2 font-semibold text-white">Decide</h3>
            <p className="text-sm text-gray-400">
              Evaluates deterministic rules, validates state transitions, and generates AI recommendations.
            </p>
          </div>
          <div className="rounded-xl border border-agent-border bg-agent-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-amber-900/50">
              <BoltIcon className="h-5 w-5 text-amber-400" />
            </div>
            <h3 className="mb-2 font-semibold text-white">Act</h3>
            <p className="text-sm text-gray-400">
              Releases payments on CKB or via Fiber, processes refunds, and resolves disputes.
            </p>
          </div>
        </div>

        <div className="mb-16 flex flex-wrap justify-center gap-3">
          {['Nervos CKB', 'CCC Wallet', 'Fiber Network', 'AI Dispute Engine', 'Real-time Agent', 'TypeScript'].map((tech) => (
            <span key={tech} className="rounded-full border border-agent-border bg-agent-card px-4 py-1.5 text-xs text-gray-400">
              {tech}
            </span>
          ))}
        </div>

        <div className="mx-auto max-w-4xl">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-white sm:text-lg">
            <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
            Live Agent Activity
          </h2>
          <AgentLogPanel allowedAgreementIds={agreementIds} />
        </div>
      </div>
    </div>
  );
}
