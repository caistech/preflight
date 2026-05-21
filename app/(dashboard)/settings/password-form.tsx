'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (next.length < 8) {
      setMessage({ tone: 'err', text: 'New password must be at least 8 characters.' });
      return;
    }
    if (next !== confirm) {
      setMessage({ tone: 'err', text: 'New password and confirmation do not match.' });
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/settings/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setMessage({ tone: 'ok', text: 'Password updated. Your session continues on the new password.' });
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setMessage({ tone: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 text-sm">
      <Field
        label="Current password"
        value={current}
        onChange={setCurrent}
        show={showCurrent}
        toggleShow={() => setShowCurrent(!showCurrent)}
      />
      <Field
        label="New password (min 8 chars)"
        value={next}
        onChange={setNext}
        show={showNext}
        toggleShow={() => setShowNext(!showNext)}
      />
      <Field
        label="Confirm new password"
        value={confirm}
        onChange={setConfirm}
        show={showConfirm}
        toggleShow={() => setShowConfirm(!showConfirm)}
      />
      {message && (
        <div
          className={`rounded-lg border p-2 text-xs ${
            message.tone === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-red-500/30 bg-red-500/10 text-red-300'
          }`}
        >
          {message.text}
        </div>
      )}
      <button
        type="submit"
        disabled={busy || !current || !next || !confirm}
        className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-gray-950 hover:bg-emerald-400 disabled:opacity-40"
      >
        {busy ? 'Updating…' : 'Update password'}
      </button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  show,
  toggleShow,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  toggleShow: () => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-400">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 pr-10 text-sm outline-none focus:border-emerald-500"
          autoComplete="new-password"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={show ? 'Hide password' : 'Show password'}
          onClick={toggleShow}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-200"
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}
