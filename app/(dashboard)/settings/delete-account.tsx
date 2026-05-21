'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function DeleteAccount({ email }: { email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orphaned, setOrphaned] = useState<Array<{ name: string; slug: string }>>([]);

  async function onDelete() {
    setError(null);
    setOrphaned([]);
    setBusy(true);
    try {
      const r = await fetch('/api/settings/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email_confirmation: confirmation }),
      });
      const j = await r.json();
      if (!r.ok) {
        setOrphaned(j.orphaned_projects ?? []);
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      // Account gone; navigate out.
      router.push('/login');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-2 text-sm text-red-300 hover:border-red-500 hover:bg-red-500/15"
        >
          Delete my account…
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-red-500/40 bg-red-500/5 p-4 text-xs">
      <div className="text-red-300">
        This deletes your auth user + cascade-cleans your profile, memberships, and
        audit trail. Drafter tokens you created stay; check_result_decisions you authored
        get NULL on decided_by_user_id (preserving the rationale).
      </div>
      <div className="text-red-300/90">
        Type your account email <code className="rounded bg-red-500/10 px-1 font-mono">{email}</code> below to confirm.
      </div>
      <input
        type="email"
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
        placeholder={email}
        className="w-full rounded border border-red-500/40 bg-gray-950 px-2 py-1.5 font-mono text-red-200 outline-none focus:border-red-500"
        autoComplete="off"
      />
      {error && (
        <div className="rounded border border-red-500/50 bg-red-500/10 p-2 text-red-300">
          {error}
        </div>
      )}
      {orphaned.length > 0 && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-amber-200">
          You are the only owner on:
          <ul className="mt-1 list-disc pl-5">
            {orphaned.map((p) => (
              <li key={p.slug}>{p.name} ({p.slug})</li>
            ))}
          </ul>
          Add a second owner via Project members on each, then retry.
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => { setOpen(false); setConfirmation(''); setError(null); setOrphaned([]); }}
          className="rounded border border-gray-700 px-3 py-1.5 text-gray-300 hover:border-gray-500"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy || confirmation.trim().toLowerCase() !== email.toLowerCase()}
          className="rounded bg-red-500 px-3 py-1.5 font-medium text-red-50 hover:bg-red-400 disabled:opacity-40"
        >
          {busy ? 'Deleting…' : 'Delete my account'}
        </button>
      </div>
    </div>
  );
}
