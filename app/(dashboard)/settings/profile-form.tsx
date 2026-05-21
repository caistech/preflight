'use client';

import { useEffect, useState } from 'react';

interface Profile {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  company?: string | null;
  job_title?: string | null;
  email_marketing_opt_in?: boolean | null;
  email_review_queue?: boolean | null;
  email_weekly_digest?: boolean | null;
  email_project_alerts?: boolean | null;
}

export function ProfileForm() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [profile, setProfile] = useState<Profile>({});

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/settings/profile');
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setProfile(j.profile ?? {});
    } catch (e) {
      setMessage({ tone: 'err', text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setBusy(true);
    try {
      const r = await fetch('/api/settings/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setMessage({ tone: 'ok', text: 'Profile saved.' });
    } catch (e) {
      setMessage({ tone: 'err', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="text-xs text-gray-500">Loading profile…</div>;

  return (
    <form onSubmit={onSave} className="space-y-3 text-sm">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="First name" value={profile.first_name ?? ''} onChange={(v) => setProfile({ ...profile, first_name: v })} />
        <Field label="Last name" value={profile.last_name ?? ''} onChange={(v) => setProfile({ ...profile, last_name: v })} />
        <Field label="Phone" value={profile.phone ?? ''} onChange={(v) => setProfile({ ...profile, phone: v })} placeholder="+61…" />
        <Field label="Company / Organisation" value={profile.company ?? ''} onChange={(v) => setProfile({ ...profile, company: v })} />
        <div className="sm:col-span-2">
          <Field label="Job title" value={profile.job_title ?? ''} onChange={(v) => setProfile({ ...profile, job_title: v })} />
        </div>
      </div>
      <div className="space-y-2 rounded-lg border border-gray-800 bg-gray-950/40 p-3 text-xs text-gray-300">
        <div className="text-gray-400">Notifications</div>
        <Toggle
          checked={profile.email_project_alerts !== false}
          onChange={(v) => setProfile({ ...profile, email_project_alerts: v })}
          label="Project alerts (hard-fails, cron failures, deploy issues)"
        />
        <Toggle
          checked={profile.email_review_queue !== false}
          onChange={(v) => setProfile({ ...profile, email_review_queue: v })}
          label="Review-queue digest (drafter decisions awaiting your review)"
        />
        <Toggle
          checked={profile.email_weekly_digest !== false}
          onChange={(v) => setProfile({ ...profile, email_weekly_digest: v })}
          label="Weekly digest — Monday morning roll-up"
        />
        <Toggle
          checked={!!profile.email_marketing_opt_in}
          onChange={(v) => setProfile({ ...profile, email_marketing_opt_in: v })}
          label="Product updates and announcements (off by default)"
        />
        <div className="pt-1 text-gray-500">
          Transactional emails (sign-in, password reset, drafter invitations) are sent regardless.
        </div>
      </div>
      {message && (
        <div className={`rounded-lg border p-2 text-xs ${message.tone === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
          {message.text}
        </div>
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-gray-950 hover:bg-emerald-400 disabled:opacity-40"
      >
        {busy ? 'Saving…' : 'Save profile'}
      </button>
    </form>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-emerald-500"
      />
      <span>{label}</span>
    </label>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-400">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
      />
    </div>
  );
}
