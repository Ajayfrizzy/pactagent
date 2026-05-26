'use client';

import { ccc } from '@ckb-ccc/connector-react';
import { useStore } from '@/lib/store';
import {
  AgentIcon,
  CheckCircleIcon,
  LinkIcon,
  ShieldCheckIcon,
} from './Icons';
import { WalletConnect } from './WalletConnect';

type WalletOnboardingCardProps = {
  title?: string;
  description?: string;
  className?: string;
};

const ONBOARDING_STEPS = [
  {
    key: 'connect',
    title: 'Connect wallet',
    description: 'Choose a CCC-compatible wallet and link it to PactAgent.',
    icon: LinkIcon,
  },
  {
    key: 'sign',
    title: 'Approve sign-in',
    description: 'Approve the wallet sign-in request so PactAgent can open your agreements safely.',
    icon: ShieldCheckIcon,
  },
  {
    key: 'ready',
    title: 'Start using PactAgent',
    description: 'Create agreements, accept invites, and approve onchain actions once your wallet is ready.',
    icon: CheckCircleIcon,
  },
] as const;

export function WalletOnboardingCard({
  title = 'Finish wallet access',
  description = 'PactAgent actions are tied to your connected wallet, signed-in session, and wallet connection.',
  className = '',
}: WalletOnboardingCardProps) {
  const signer = ccc.useSigner();
  const walletAddress = useStore((s) => s.walletAddress);
  const authToken = useStore((s) => s.authToken);

  const hasSigner = Boolean(signer);
  const hasAuthenticatedSession = Boolean(walletAddress && authToken);
  const currentStepIndex = hasAuthenticatedSession ? 2 : hasSigner ? 1 : 0;

  return (
    <section className={`rounded-3xl border border-agent-border bg-agent-card/85 p-6 shadow-[0_22px_60px_rgba(15,23,42,0.24)] ${className}`.trim()}>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-agent-accent/30 bg-agent-accent/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-agent-accent">
            <AgentIcon className="h-4 w-4" />
            Wallet Access
          </div>
          <h2 className="text-xl font-semibold text-white sm:text-2xl">{title}</h2>
          <p className="mt-2 text-sm text-gray-300">{description}</p>
        </div>

        <div className="rounded-2xl border border-agent-border bg-agent-bg/55 p-4 lg:w-[20rem]">
          <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Current state</div>
          <div className="mt-2 text-sm font-medium text-white">
            {hasAuthenticatedSession
              ? 'Ready for agreements and signed actions.'
              : hasSigner
                ? 'Wallet connected. Sign-in approval still required.'
                : 'Wallet not connected yet.'}
          </div>
          <div className="mt-3">
            <WalletConnect />
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {ONBOARDING_STEPS.map((step, index) => {
          const Icon = step.icon;
          const completed = index < currentStepIndex || (index === 2 && hasAuthenticatedSession);
          const current = index === currentStepIndex && !completed;

          return (
            <div
              key={step.key}
              className={`rounded-2xl border p-4 ${
                completed
                  ? 'border-emerald-500/35 bg-emerald-950/20'
                  : current
                    ? 'border-agent-accent/45 bg-agent-accent/10'
                    : 'border-agent-border bg-agent-bg/45'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${
                  completed
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : current
                      ? 'bg-agent-accent/15 text-agent-accent'
                      : 'bg-agent-card/80 text-gray-400'
                }`}>
                  <Icon className="h-5 w-5" />
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] ${
                  completed
                    ? 'bg-emerald-500/15 text-emerald-200'
                    : current
                      ? 'bg-agent-accent/15 text-agent-accent'
                      : 'bg-agent-card/70 text-gray-400'
                }`}>
                  {completed ? 'Done' : current ? 'Current' : 'Next'}
                </span>
              </div>
              <div className="mt-4 text-sm font-semibold text-white">{step.title}</div>
              <p className="mt-2 text-sm text-gray-400">{step.description}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
