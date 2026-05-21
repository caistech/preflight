'use client';

import { useState } from 'react';

interface Props {
  userId: string;
  email: string;
  avatarBaseUrl: string;
}

export function AvatarForm({ userId, email, avatarBaseUrl }: Props) {
  const [version, setVersion] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const initials = (email || '?').slice(0, 2).toUpperCase();
  const src = `${avatarBaseUrl}/${userId}?v=${version}`;

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await fetch('/api/settings/avatar', { method: 'POST', body: form });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setVersion(Date.now());
      setMessage({ tone: 'ok', text: 'Avatar updated.' });
    } catch (err) {
      setMessage({ tone: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    if (!confirm('Remove your avatar? Falls back to initials.')) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await fetch('/api/settings/avatar', { method: 'DELETE' });
      if (!r.ok) {
        const j = await r.json();
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setVersion(Date.now());
      setMessage({ tone: 'ok', text: 'Avatar removed.' });
    } catch (err) {
      setMessage({ tone: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border border-gray-700 bg-gray-800">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="Avatar"
          className="h-full w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-semibold text-gray-300">
          {initials}
        </div>
      </div>
      <div className="space-y-1 text-xs">
        <label className="inline-block">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={onPick}
            disabled={busy}
            className="hidden"
          />
          <span className="cursor-pointer rounded-lg border border-gray-700 px-3 py-1.5 text-gray-300 hover:border-emerald-500 hover:text-emerald-400">
            {busy ? 'Working…' : 'Upload new avatar'}
          </span>
        </label>
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="ml-2 rounded-lg border border-gray-700 px-3 py-1.5 text-gray-400 hover:border-red-500 hover:text-red-400 disabled:opacity-50"
        >
          Remove
        </button>
        <div className="text-gray-500">PNG, JPEG, WEBP, or GIF · max 2 MB.</div>
        {message && (
          <div className={message.tone === 'ok' ? 'text-emerald-400' : 'text-red-400'}>
            {message.text}
          </div>
        )}
      </div>
    </div>
  );
}
