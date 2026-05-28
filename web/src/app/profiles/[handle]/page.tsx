'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { BrandLogo } from '@/components/BrandLogo';
import { ArrowLeftIcon, LinkIcon, TrophyIcon } from '@/components/Icons';
import { NavbarMenu } from '@/components/NavbarMenu';
import { fetchPublicProfile, fetchPublicProfileActivity } from '@/lib/api';

export default function PublicProfilePage() {
  const params = useParams();
  const handle = params.handle as string;
  const [profile, setProfile] = useState<any>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [profileData, activityData] = await Promise.all([
          fetchPublicProfile(handle),
          fetchPublicProfileActivity(handle, 20),
        ]);
        setProfile(profileData);
        setActivity(activityData.logs || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [handle]);

  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-50 border-b border-agent-border bg-agent-card/50 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <BrandLogo />
          <NavbarMenu>
            <Link href="/dashboard" className="text-sm text-gray-400 transition-colors hover:text-white">
              Dashboard
            </Link>
          </NavbarMenu>
        </div>
      </nav>

      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white">
          <ArrowLeftIcon className="h-4 w-4" />
          Back home
        </Link>

        {loading ? (
          <div className="rounded-2xl border border-agent-border bg-agent-card/70 p-6 text-sm text-gray-400">Loading profile...</div>
        ) : error || !profile ? (
          <div className="rounded-2xl border border-red-800 bg-red-900/30 p-6 text-sm text-red-200">{error || 'Profile not found'}</div>
        ) : (
          <>
            <section className="rounded-3xl border border-agent-border bg-agent-card/80 p-6">
              <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                <div className="max-w-2xl">
                  <div className="mb-3 text-xs uppercase tracking-[0.18em] text-agent-accent">Nervos Marketplace Profile</div>
                  <div className="mb-4 flex items-center gap-4">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-agent-border bg-agent-bg/60">
                      {profile.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-xl font-semibold text-gray-400">
                          {(profile.displayName || profile.handle || 'P').trim().charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div>
                      <h1 className="text-3xl font-bold text-white">{profile.displayName || profile.handle}</h1>
                      <p className="mt-1 text-sm text-gray-500">@{profile.handle}</p>
                    </div>
                  </div>
                  <p className="mt-4 whitespace-pre-wrap text-sm text-gray-300">{profile.bio || 'No bio yet.'}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {(profile.skills || []).map((skill: string) => (
                      <span key={skill} className="rounded-full border border-agent-border bg-agent-bg/60 px-3 py-1 text-xs text-gray-300">
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="w-full max-w-sm rounded-2xl border border-agent-border bg-agent-bg/50 p-5">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
                    <TrophyIcon className="h-4 w-4 text-amber-300" />
                    Reputation Snapshot
                  </div>
                  <p className="mb-4 text-sm text-gray-400">
                    This snapshot helps counterparties judge whether this profile reliably completes work, avoids disputes, and closes payouts cleanly.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      ['Completed', profile.reputation?.completedAgreements || 0],
                      ['Dispute Rate', `${profile.reputation?.disputeRate || 0}%`],
                      ['Payout Success', `${profile.reputation?.payoutSuccessRate || 0}%`],
                      ['Repeat Counterparties', profile.reputation?.repeatCounterpartyCount || 0],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-xl border border-agent-border bg-agent-card/60 p-4">
                        <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
                        <div className="mt-2 text-lg font-semibold text-white">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-agent-border bg-agent-bg/50 p-4">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Why this profile is useful</div>
                  <div className="mt-2 space-y-2 text-sm text-gray-300">
                    <p>Shows who is behind a wallet before an invite is accepted.</p>
                    <p>Gives grant operators and collaborators more context than a raw address alone.</p>
                    <p>Lets repeat counterparties build continuity across multiple agreements.</p>
                  </div>
                </div>
                <div className="rounded-xl border border-agent-border bg-agent-bg/50 p-4">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Fiber Public Key</div>
                  <div className="mt-2 break-all text-sm text-gray-300">{profile.fiberPubkey || 'Not published'}</div>
                </div>
                <div className="rounded-xl border border-agent-border bg-agent-bg/50 p-4">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Published Links</div>
                  <div className="mt-2 space-y-2">
                    {(profile.links || []).length ? (
                      (profile.links || []).map((link: any) => (
                        <a key={`${link.label}-${link.url}`} href={link.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 break-all text-sm text-agent-accent hover:text-blue-300">
                          <LinkIcon className="h-4 w-4" />
                          {link.label}
                        </a>
                      ))
                    ) : (
                      <div className="text-sm text-gray-400">No public links published yet.</div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-agent-border bg-agent-card/80 p-6">
              <h2 className="text-xl font-bold text-white">Recent Public Activity</h2>
              <div className="mt-4 space-y-3">
                {activity.length ? activity.map((log) => (
                  <div key={log.id} className="rounded-xl border border-agent-border bg-agent-bg/50 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="text-sm text-white">{log.message}</div>
                      <div className="shrink-0 text-xs text-gray-500">{new Date(log.createdAt).toLocaleString()}</div>
                    </div>
                  </div>
                )) : (
                  <div className="text-sm text-gray-400">No public activity yet.</div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
