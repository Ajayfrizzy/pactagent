'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ccc } from '@ckb-ccc/connector-react';
import { WalletConnect } from '@/components/WalletConnect';
import { AgentLogPanel } from '@/components/AgentLogPanel';
import { NavbarMenu } from '@/components/NavbarMenu';
import { WalletOnboardingCard } from '@/components/WalletOnboardingCard';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useStore } from '@/lib/store';
import { fetchAgreements } from '@/lib/api';
import {
  AgentIcon,
  EyeIcon,
  CpuChipIcon,
  BoltIcon,
  CheckCircleIcon,
  LinkIcon,
  ShieldCheckIcon,
} from '@/components/Icons';

export default function HomePage() {
  useWebSocket();
  const signer = ccc.useSigner();
  const walletAddress = useStore((s) => s.walletAddress);
  const authToken = useStore((s) => s.authToken);
  const isAdmin = useStore((s) => s.isAdmin);
  const [agreementIds, setAgreementIds] = useState<string[]>([]);
  const needsSignIn = Boolean(signer && !authToken);
  const hasWalletAccess = Boolean(walletAddress && authToken);

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
              <>
                <Link href="/dashboard" className="text-sm text-gray-400 transition-colors hover:text-white">
                  Dashboard
                </Link>
                {isAdmin ? (
                  <Link href="/admin" className="text-sm text-agent-accent transition-colors hover:text-blue-300">
                    Admin
                  </Link>
                ) : null}
              </>
            ) : null}
          </NavbarMenu>
        </div>
      </nav>

      <div className="mx-auto max-w-7xl px-4 pb-16 pt-16 sm:px-6 sm:pt-20">
        <section className="mb-12 overflow-hidden rounded-[2rem] border border-agent-border bg-agent-card/80 shadow-[0_28px_80px_rgba(15,23,42,0.26)]">
          <div className="bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_34%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.12),transparent_30%),linear-gradient(180deg,rgba(15,23,42,0.82),rgba(15,23,42,0.65))] px-6 py-10 sm:px-8 sm:py-12">
            <div className="grid gap-8 xl:grid-cols-[1.05fr_0.95fr] xl:items-center">
              <div>
                <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-agent-accent/30 bg-agent-accent/10 px-4 py-1.5">
                  <span className="h-2 w-2 rounded-full bg-agent-accent animate-pulse" />
                  <span className="text-xs font-medium text-agent-accent">Milestone Escrow on CKB</span>
                </div>
                <h1 className="max-w-3xl text-4xl font-bold leading-tight text-white sm:text-5xl">
                  Ship work in milestones.
                  <br />
                  Review clearly.
                  <br />
                  Release funds with confidence.
                </h1>
                <p className="mt-5 max-w-2xl text-base text-gray-300 sm:text-lg">
                  PactAgent helps clients, workers, and grant operators run milestone-based agreements with wallet-based access, review checkpoints, and live settlement status.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  {hasWalletAccess ? (
                    <>
                      <Link
                        href="/dashboard"
                        className="inline-flex items-center justify-center rounded-xl bg-agent-accent px-6 py-3 font-medium text-white transition-colors hover:bg-blue-600"
                      >
                        Open Dashboard
                      </Link>
                      <Link
                        href="/agreement/new"
                        className="inline-flex items-center justify-center rounded-xl border border-agent-border bg-agent-bg/50 px-6 py-3 font-medium text-white transition-colors hover:border-agent-accent"
                      >
                        Create Agreement
                      </Link>
                    </>
                  ) : (
                    <div className="flex max-w-xl flex-col gap-3">
                      <p className="text-sm text-gray-400">
                        {needsSignIn
                          ? 'Your wallet is connected. Approve the sign-in request to unlock agreements and invites.'
                          : 'Connect your wallet to start creating agreements, accepting invites, and managing settings.'}
                      </p>
                      <div className="flex flex-wrap gap-3">
                        <WalletConnect />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
                {[
                  {
                    title: '1. Open access',
                    body: 'Connect a wallet, approve the sign-in request, and keep the wallet ready for actions.',
                    icon: LinkIcon,
                  },
                  {
                    title: '2. Run the agreement',
                    body: 'Create a direct deal or import grant work, break it into milestones, and track who needs to act next.',
                    icon: ShieldCheckIcon,
                  },
                  {
                    title: '3. Settle clearly',
                    body: 'Review proof, raise disputes when needed, and release payouts with an auditable status trail.',
                    icon: CheckCircleIcon,
                  },
                ].map((item) => {
                  const Icon = item.icon;

                  return (
                    <div key={item.title} className="rounded-2xl border border-agent-border bg-agent-bg/55 p-5 backdrop-blur">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-agent-accent/15 text-agent-accent">
                        <Icon className="h-5 w-5" />
                      </div>
                      <h2 className="mt-4 text-base font-semibold text-white">{item.title}</h2>
                      <p className="mt-2 text-sm text-gray-400">{item.body}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {!hasWalletAccess ? (
          <WalletOnboardingCard
            title="Get ready before you create or accept an agreement"
            description="The first meaningful action in PactAgent is wallet-backed. Finish the access flow once and the rest of the product becomes straightforward."
            className="mb-12"
          />
        ) : null}

        <section className="mb-16 grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-agent-border bg-agent-card/80 p-6">
            <span className="h-2 w-2 rounded-full bg-agent-accent animate-pulse" />
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-900/50">
              <EyeIcon className="h-5 w-5 text-blue-400" />
            </div>
            <h3 className="mb-2 font-semibold text-white">See the next action</h3>
            <p className="text-sm text-gray-400">
              Agreement cards and detail views should always tell each participant what to do next and why.
            </p>
          </div>
          <div className="rounded-2xl border border-agent-border bg-agent-card/80 p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-purple-900/50">
              <CpuChipIcon className="h-5 w-5 text-purple-400" />
            </div>
            <h3 className="mb-2 font-semibold text-white">Review with context</h3>
            <p className="text-sm text-gray-400">
              Proof, milestone scope, review mode, and payout state should stay visible together instead of across separate mental models.
            </p>
          </div>
          <div className="rounded-2xl border border-agent-border bg-agent-card/80 p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-amber-900/50">
              <BoltIcon className="h-5 w-5 text-amber-400" />
            </div>
            <h3 className="mb-2 font-semibold text-white">Settle without guesswork</h3>
            <p className="text-sm text-gray-400">
              Funding, review, disputes, and settlement should read like one continuous workflow, not separate systems.
            </p>
          </div>
        </section>

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
            Recent Public Activity
          </h2>
          <p className="mb-4 text-sm text-gray-400">
            A lightweight public feed works better here than a wallet-scoped operator panel. It shows what PactAgent is actively processing without blocking the first-use journey.
          </p>
          <AgentLogPanel allowedAgreementIds={agreementIds} publicFeed />
        </div>
      </div>
    </div>
  );
}
