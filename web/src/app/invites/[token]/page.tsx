'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { acceptInvite, fetchInvitePreview } from '@/lib/api';
import { AgentIcon, ArrowLeftIcon, LinkIcon, RocketLaunchIcon } from '@/components/Icons';
import { NavbarMenu } from '@/components/NavbarMenu';

export default function InviteLandingPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;
  const authToken = useStore((s) => s.authToken);
  const [invite, setInvite] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchInvitePreview(token);
        setInvite(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load invite');
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [token]);

  const milestoneCount = useMemo(() => invite?.agreementTemplate?.milestones?.length || 0, [invite]);

  async function handleAccept() {
    setAccepting(true);
    setError(null);

    try {
      const accepted = await acceptInvite(token);
      router.push(`/agreement/${accepted.agreement.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invite');
    } finally {
      setAccepting(false);
    }
  }

  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-50 border-b border-agent-border bg-agent-card/50 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-2">
            <AgentIcon className="h-5 w-5 shrink-0 text-agent-accent" />
            <span className="truncate text-lg font-bold text-white">PactAgent</span>
          </Link>
          <NavbarMenu />
        </div>
      </nav>

      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white">
          <ArrowLeftIcon className="h-4 w-4" />
          Back home
        </Link>

        {loading ? (
          <div className="rounded-2xl border border-agent-border bg-agent-card/70 p-6 text-sm text-gray-400">Loading invite...</div>
        ) : error || !invite ? (
          <div className="rounded-2xl border border-red-800 bg-red-900/30 p-6 text-sm text-red-200">{error || 'Invite not found'}</div>
        ) : (
          <section className="rounded-3xl border border-agent-border bg-agent-card/85 p-6">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-agent-border bg-agent-bg/60 px-3 py-1 text-xs uppercase tracking-[0.16em] text-agent-accent">
              <RocketLaunchIcon className="h-4 w-4" />
              Nervos Work Invite
            </div>
            <h1 className="text-3xl font-bold text-white">{invite.title || invite.agreementTemplate.title}</h1>
            <p className="mt-3 text-sm text-gray-300">{invite.description || invite.agreementTemplate.description}</p>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-agent-border bg-agent-bg/50 p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">Invited Role</div>
                <div className="mt-2 text-lg font-semibold text-white">{invite.targetRole}</div>
              </div>
              <div className="rounded-xl border border-agent-border bg-agent-bg/50 p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">Milestones</div>
                <div className="mt-2 text-lg font-semibold text-white">{milestoneCount}</div>
              </div>
              <div className="rounded-xl border border-agent-border bg-agent-bg/50 p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">Creator</div>
                <div className="mt-2 text-white">{invite.creatorProfile?.displayName || invite.creatorProfile?.handle || invite.createdByAddress}</div>
              </div>
              <div className="rounded-xl border border-agent-border bg-agent-bg/50 p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">Expires</div>
                <div className="mt-2 text-white">{invite.expiresAt ? new Date(invite.expiresAt).toLocaleString() : 'No expiry'}</div>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-agent-border bg-agent-bg/50 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-white">
                <LinkIcon className="h-4 w-4 text-agent-accent" />
                Milestone Outline
              </div>
              <div className="space-y-3">
                {(invite.agreementTemplate.milestones || []).map((milestone: any, index: number) => (
                  <div key={`${milestone.title}-${index}`} className="rounded-lg border border-agent-border bg-agent-card/60 p-4">
                    <div className="text-sm font-medium text-white">{milestone.title}</div>
                    <div className="mt-1 text-sm text-gray-400">{milestone.description}</div>
                    <div className="mt-2 text-xs uppercase tracking-wide text-gray-500">{milestone.amount} shannons</div>
                  </div>
                ))}
              </div>
            </div>

            {error ? <div className="mt-6 rounded-xl border border-red-800 bg-red-900/30 p-4 text-sm text-red-200">{error}</div> : null}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              {!authToken ? (
                <div className="text-sm text-gray-400">Connect and sign in first to accept this invite.</div>
              ) : (
                <button type="button" onClick={handleAccept} disabled={accepting || invite.isExpired} className="rounded-xl bg-agent-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-70">
                  {invite.isExpired ? 'Invite Unavailable' : accepting ? 'Accepting...' : 'Accept Invite'}
                </button>
              )}
              {invite.creatorProfile?.handle ? (
                <Link href={`/profiles/${invite.creatorProfile.handle}`} className="rounded-xl border border-agent-border px-5 py-2.5 text-sm text-gray-300 hover:border-agent-accent hover:text-white">
                  View Creator Profile
                </Link>
              ) : null}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
