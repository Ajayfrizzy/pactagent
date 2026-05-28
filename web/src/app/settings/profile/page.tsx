'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { NavbarMenu } from '@/components/NavbarMenu';
import { BrandLogo } from '@/components/BrandLogo';
import { ArrowLeftIcon, LinkIcon, ShieldCheckIcon } from '@/components/Icons';
import { useStore } from '@/lib/store';
import { fetchMyProfile, updateMyProfile } from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';

function parseLinksInput(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, url] = line.includes('|') ? line.split('|') : [line, line];
      return {
        label: label.trim(),
        url: url.trim(),
      };
    });
}

export default function ProfileSettingsPage() {
  useWebSocket();
  const authToken = useStore((s) => s.authToken);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [form, setForm] = useState({
    handle: '',
    displayName: '',
    bio: '',
    avatarUrl: '',
    fiberPubkey: '',
    visibility: 'PUBLIC',
    skills: '',
    links: '',
  });

  useEffect(() => {
    async function load() {
      if (!authToken) {
        setLoading(false);
        return;
      }

      try {
        const data = await fetchMyProfile();
        setProfile(data);
        setForm({
          handle: data.handle || '',
          displayName: data.displayName || '',
          bio: data.bio || '',
          avatarUrl: data.avatarUrl || '',
          fiberPubkey: data.fiberPubkey || '',
          visibility: data.visibility || 'PUBLIC',
          skills: (data.skills || []).join(', '),
          links: (data.links || []).map((link: any) => `${link.label}|${link.url}`).join('\n'),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [authToken]);

  const publicUrl = useMemo(() => {
    if (!profile?.handle || typeof window === 'undefined') {
      return '';
    }

    return `${window.location.origin}/profiles/${profile.handle}`;
  }, [profile?.handle]);
  const normalizedHandle = form.handle.trim().toLowerCase();
  const handleError = !normalizedHandle
    ? 'Choose a public handle so people can recognize and share your profile.'
    : !/^[a-z0-9_-]{3,32}$/.test(normalizedHandle)
      ? 'Use 3 to 32 lowercase letters, numbers, hyphens, or underscores.'
      : null;
  const avatarPreviewUrl = form.avatarUrl.trim();
  const parsedSkills = form.skills.split(',').map((item) => item.trim()).filter(Boolean);
  const parsedLinks = parseLinksInput(form.links);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await updateMyProfile({
        handle: form.handle,
        displayName: form.displayName,
        bio: form.bio,
        avatarUrl: form.avatarUrl,
        fiberPubkey: form.fiberPubkey,
        visibility: form.visibility as 'PUBLIC' | 'PRIVATE',
        skills: form.skills.split(',').map((item) => item.trim()).filter(Boolean),
        links: parseLinksInput(form.links),
      });

      setProfile(updated);
      setSuccess('Profile updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    'w-full rounded-lg border border-agent-border bg-agent-bg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-agent-accent focus:outline-none';

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

      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to dashboard
        </Link>

        <section className="rounded-3xl border border-agent-border bg-agent-card/80 p-6">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-agent-border bg-agent-bg/60 px-3 py-1 text-xs uppercase tracking-[0.16em] text-agent-accent">
                <ShieldCheckIcon className="h-4 w-4" />
                Public Identity
              </div>
              <h1 className="text-2xl font-bold text-white">Profile Settings</h1>
              <p className="mt-2 text-sm text-gray-400">
                Set the public face of your Nervos marketplace profile and keep your Fiber details current.
              </p>
            </div>
            {profile?.handle ? (
              <Link href={`/profiles/${profile.handle}`} className="text-sm text-agent-accent hover:text-blue-300">
                View public profile
              </Link>
            ) : null}
          </div>

          {loading ? (
            <div className="text-sm text-gray-400">Loading profile...</div>
          ) : !authToken ? (
            <div className="rounded-xl border border-agent-border bg-agent-bg/50 p-4 text-sm text-gray-300">
              Connect and sign in to manage your profile.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid gap-5 md:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-5">
                  <div className="grid gap-5 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-1.5 block text-sm text-gray-300">Handle</span>
                      <input
                        className={`${inputClass} ${handleError ? 'border-red-500/70 focus:border-red-400' : ''}`}
                        value={form.handle}
                        onChange={(e) => setForm((prev) => ({ ...prev, handle: e.target.value }))}
                        placeholder="pact-operator"
                        autoCapitalize="none"
                        spellCheck={false}
                      />
                      <p className={`mt-1 text-xs ${handleError ? 'text-red-300' : 'text-gray-500'}`}>
                        {handleError || 'This becomes your public profile URL and should be easy to remember.'}
                      </p>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-sm text-gray-300">Display Name</span>
                      <input className={inputClass} value={form.displayName} onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))} placeholder="Oluwaseun" />
                    </label>
                  </div>

                  <label className="block">
                    <span className="mb-1.5 block text-sm text-gray-300">Bio</span>
                    <textarea className={`${inputClass} min-h-28`} value={form.bio} onChange={(e) => setForm((prev) => ({ ...prev, bio: e.target.value }))} placeholder="What kind of agreements do you usually run or review?" />
                  </label>

                  <div className="grid gap-5 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-1.5 block text-sm text-gray-300">Avatar URL</span>
                      <input className={inputClass} value={form.avatarUrl} onChange={(e) => setForm((prev) => ({ ...prev, avatarUrl: e.target.value }))} placeholder="https://example.com/avatar.png" />
                      <p className="mt-1 text-xs text-gray-500">Optional. Use a square image URL so your profile looks more trustworthy in invite and public views.</p>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-sm text-gray-300">Profile Visibility</span>
                      <select className={inputClass} value={form.visibility} onChange={(e) => setForm((prev) => ({ ...prev, visibility: e.target.value }))}>
                        <option value="PUBLIC">Public</option>
                        <option value="PRIVATE">Private</option>
                      </select>
                      <p className="mt-1 text-xs text-gray-500">Public profiles help counterparties verify who they are working with before accepting an invite.</p>
                    </label>
                  </div>

                  <div className="grid gap-5 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-1.5 block text-sm text-gray-300">Fiber Public Key</span>
                      <input className={inputClass} value={form.fiberPubkey} onChange={(e) => setForm((prev) => ({ ...prev, fiberPubkey: e.target.value }))} />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-sm text-gray-300">Skills</span>
                      <input className={inputClass} value={form.skills} onChange={(e) => setForm((prev) => ({ ...prev, skills: e.target.value }))} placeholder="Escrow design, DAO ops, smart contracts" />
                    </label>
                  </div>

                  <label className="block">
                    <span className="mb-1.5 block text-sm text-gray-300">Links</span>
                    <textarea className={`${inputClass} min-h-28`} value={form.links} onChange={(e) => setForm((prev) => ({ ...prev, links: e.target.value }))} placeholder="Portfolio|https://example.com&#10;GitHub|https://github.com/name" />
                    <p className="mt-1 text-xs text-gray-500">One link per line. Use `Label|URL` if you want a custom title instead of the raw URL.</p>
                  </label>
                </div>

                <label className="block">
                  <span className="sr-only">Profile preview</span>
                  <div className="rounded-2xl border border-agent-border bg-agent-bg/55 p-5">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">Profile Preview</div>
                    <div className="mt-4 flex items-start gap-4">
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-agent-border bg-agent-card/80">
                        {avatarPreviewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={avatarPreviewUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-xl font-semibold text-gray-500">
                            {(form.displayName || form.handle || 'P').trim().charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-base font-semibold text-white">{form.displayName || 'Your display name'}</div>
                        <div className="mt-1 text-sm text-gray-500">@{normalizedHandle || 'your-handle'}</div>
                        <p className="mt-3 text-sm text-gray-300">
                          {form.bio || 'Add a short bio so counterparties know what kind of work you do and why they should trust you.'}
                        </p>
                      </div>
                    </div>

                    {publicUrl ? (
                      <div className="mt-5 rounded-xl border border-agent-border bg-agent-card/70 p-4 text-sm text-gray-300">
                        <div className="mb-1 flex items-center gap-2 text-white">
                          <LinkIcon className="h-4 w-4 text-agent-accent" />
                          Public URL
                        </div>
                        <div className="break-all text-xs text-gray-400">{publicUrl}</div>
                      </div>
                    ) : null}

                    <div className="mt-5">
                      <div className="text-xs uppercase tracking-wide text-gray-500">Skills preview</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {parsedSkills.length ? parsedSkills.map((skill) => (
                          <span key={skill} className="rounded-full border border-agent-border bg-agent-card/70 px-3 py-1 text-xs text-gray-300">
                            {skill}
                          </span>
                        )) : (
                          <span className="text-sm text-gray-500">No skills listed yet.</span>
                        )}
                      </div>
                    </div>

                    <div className="mt-5">
                      <div className="text-xs uppercase tracking-wide text-gray-500">Published links preview</div>
                      <div className="mt-2 space-y-2">
                        {parsedLinks.length ? parsedLinks.map((link) => (
                          <div key={`${link.label}-${link.url}`} className="text-sm text-gray-300">
                            {link.label} <span className="text-gray-500">→ {link.url}</span>
                          </div>
                        )) : (
                          <span className="text-sm text-gray-500">No public links added yet.</span>
                        )}
                      </div>
                    </div>
                  </div>
                </label>
              </div>

              {profile?.reputation ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ['Completed', profile.reputation.completedAgreements],
                    ['Dispute Rate', `${profile.reputation.disputeRate}%`],
                    ['Payout Success', `${profile.reputation.payoutSuccessRate}%`],
                    ['Repeat Counterparties', profile.reputation.repeatCounterpartyCount],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-xl border border-agent-border bg-agent-bg/50 p-4">
                      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
                      <div className="mt-2 text-lg font-semibold text-white">{value}</div>
                    </div>
                  ))}
                </div>
              ) : null}

              {error ? <div className="rounded-xl border border-red-800 bg-red-900/30 p-4 text-sm text-red-200">{error}</div> : null}
              {success ? <div className="rounded-xl border border-emerald-800 bg-emerald-900/20 p-4 text-sm text-emerald-200">{success}</div> : null}

              <button type="submit" disabled={saving} className="rounded-xl bg-agent-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-70">
                {saving ? 'Saving...' : 'Save Profile'}
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
