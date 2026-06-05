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
  const trustSignals = [
    {
      label: 'Public recognition',
      value: normalizedHandle ? 'Ready' : 'Needs a handle',
      detail: normalizedHandle
        ? 'People can share and recognize this identity easily.'
        : 'A memorable handle is the fastest trust signal for counterparties.',
    },
    {
      label: 'Proof of context',
      value: form.bio.trim() ? 'Bio added' : 'Bio missing',
      detail: form.bio.trim()
        ? 'The profile explains what kind of agreements you usually run.'
        : 'A short bio helps others understand your operating style before they accept an invite.',
    },
    {
      label: 'External references',
      value: parsedLinks.length ? `${parsedLinks.length} linked` : 'No links yet',
      detail: parsedLinks.length
        ? 'People can verify your work through the links you provided.'
        : 'Portfolio, GitHub, or forum links make this identity feel more credible.',
    },
  ];

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

  const inputClass = 'ui-input';

  return (
    <div className="min-h-screen">
      <nav className="app-nav">
        <div className="app-nav-inner">
          <BrandLogo />
          <NavbarMenu>
            <Link href="/dashboard" className="app-nav-link">Dashboard</Link>
          </NavbarMenu>
        </div>
      </nav>

      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <Link href="/dashboard" className="page-back-link text-gray-400">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to dashboard
        </Link>

        <section className="ui-panel p-6">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <div className="ui-kicker mb-2">
                <ShieldCheckIcon className="h-4 w-4" />
                Public Identity
              </div>
              <h1 className="text-2xl font-bold text-white">Profile Settings</h1>
              <p className="mt-2 text-sm text-gray-400">
                Set the public face of your Nervos marketplace profile and keep your Fiber details current.
              </p>
            </div>
            {profile?.handle ? (
              <Link href={`/profiles/${profile.handle}`} className="app-nav-link-accent">
                View public profile
              </Link>
            ) : null}
          </div>

          {loading ? (
            <div className="text-sm text-gray-400">Loading profile...</div>
          ) : !authToken ? (
            <div className="ui-panel-soft p-4 text-sm text-gray-300">
              Connect and sign in to manage your profile.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid gap-3 md:grid-cols-3">
                {trustSignals.map((signal) => (
                  <div key={signal.label} className="ui-panel-soft p-4">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">{signal.label}</div>
                    <div className="mt-2 text-sm font-semibold text-white">{signal.value}</div>
                    <p className="mt-2 text-xs text-gray-400">{signal.detail}</p>
                  </div>
                ))}
              </div>

              <div className="grid gap-5 md:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-5">
                  <div className="ui-panel-soft p-4">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">Why this matters</div>
                    <p className="mt-2 text-sm text-gray-300">
                      Your profile is the trust layer behind invites, imported grant collaboration, and public discovery. The goal is to help the other person feel confident that this wallet belongs to a real operator with a recognizable track record.
                    </p>
                  </div>

                  <div className="grid gap-5 md:grid-cols-2">
                    <label className="block">
                      <span className="ui-label">Handle</span>
                      <input
                        className={`${inputClass} ${handleError ? 'ui-input-error' : ''}`}
                        value={form.handle}
                        onChange={(e) => setForm((prev) => ({ ...prev, handle: e.target.value }))}
                        placeholder="pact-operator"
                        autoCapitalize="none"
                        spellCheck={false}
                      />
                      <p className={handleError ? 'ui-error-text' : 'ui-helper'}>
                        {handleError || 'This becomes your public profile URL and should be easy to remember.'}
                      </p>
                    </label>
                    <label className="block">
                      <span className="ui-label">Display Name</span>
                      <input className={inputClass} value={form.displayName} onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))} placeholder="Oluwaseun" />
                    </label>
                  </div>

                  <label className="block">
                    <span className="ui-label">Bio</span>
                    <textarea className={`${inputClass} min-h-28`} value={form.bio} onChange={(e) => setForm((prev) => ({ ...prev, bio: e.target.value }))} placeholder="What kind of agreements do you usually run or review?" />
                  </label>

                  <div className="grid gap-5 md:grid-cols-2">
                    <label className="block">
                      <span className="ui-label">Avatar URL</span>
                      <input className={inputClass} value={form.avatarUrl} onChange={(e) => setForm((prev) => ({ ...prev, avatarUrl: e.target.value }))} placeholder="https://example.com/avatar.png" />
                      <p className="ui-helper">Optional. Use a square image URL so your profile looks more trustworthy in invite and public views.</p>
                    </label>
                    <label className="block">
                      <span className="ui-label">Profile Visibility</span>
                      <select className={inputClass} value={form.visibility} onChange={(e) => setForm((prev) => ({ ...prev, visibility: e.target.value }))}>
                        <option value="PUBLIC">Public</option>
                        <option value="PRIVATE">Private</option>
                      </select>
                      <p className="ui-helper">Public profiles help counterparties verify who they are working with before accepting an invite.</p>
                    </label>
                  </div>

                  <div className="grid gap-5 md:grid-cols-2">
                    <label className="block">
                      <span className="ui-label">Fiber Public Key</span>
                      <input className={inputClass} value={form.fiberPubkey} onChange={(e) => setForm((prev) => ({ ...prev, fiberPubkey: e.target.value }))} />
                    </label>
                    <label className="block">
                      <span className="ui-label">Skills</span>
                      <input className={inputClass} value={form.skills} onChange={(e) => setForm((prev) => ({ ...prev, skills: e.target.value }))} placeholder="Escrow design, DAO ops, smart contracts" />
                    </label>
                  </div>

                  <label className="block">
                    <span className="ui-label">Links</span>
                    <textarea className={`${inputClass} min-h-28`} value={form.links} onChange={(e) => setForm((prev) => ({ ...prev, links: e.target.value }))} placeholder="Portfolio|https://example.com&#10;GitHub|https://github.com/name" />
                    <p className="ui-helper">One link per line. Use `Label|URL` if you want a custom title instead of the raw URL.</p>
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

                    <div className="mt-5 rounded-xl border border-agent-border bg-agent-card/70 p-4 text-sm text-gray-300">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-agent-accent">Counterparty impression</div>
                      <p className="mt-2 text-sm text-gray-400">
                        {normalizedHandle && form.bio.trim() && (parsedLinks.length || avatarPreviewUrl)
                          ? 'This profile already gives a counterparty enough context to feel oriented before they accept an invite.'
                          : 'Add a stronger bio, a recognizable image, or a few external links to make the profile feel more trustworthy at first glance.'}
                      </p>
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

              {error ? <div className="ui-alert-error">{error}</div> : null}
              {success ? <div className="ui-alert-success">{success}</div> : null}

              <button type="submit" disabled={saving} className="ui-button-primary-sm">
                {saving ? 'Saving...' : 'Save Profile'}
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
