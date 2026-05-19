'use client';

import { useState } from 'react';

interface DrafterToken {
  id: string;
  drafter_name: string | null;
  expires_at: string;
  revoked_at: string | null;
  uses: number;
  last_used_at: string | null;
  created_at: string;
}

export function DrafterLinkPanel({
  projectId,
  projectSlug: _projectSlug,
  existingTokens,
}: {
  projectId: string;
  projectSlug: string;
  existingTokens: DrafterToken[];
}) {
  const [drafterName, setDrafterName] = useState('');
  const [drafterEmail, setDrafterEmail] = useState('');
  const [days, setDays] = useState(14);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newLink, setNewLink] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<{ sent: boolean; error: string | null } | null>(null);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNewLink(null);
    setEmailStatus(null);
    const r = await fetch(`/api/projects/${projectId}/drafter-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        drafter_name: drafterName || null,
        drafter_email: drafterEmail || null,
        days,
      }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setError(j.error ?? `HTTP ${r.status}`);
      return;
    }
    setNewLink(j.url);
    if (drafterEmail) {
      setEmailStatus({ sent: !!j.email_sent, error: j.email_error ?? null });
    }
    setDrafterName('');
    setDrafterEmail('');
  };

  return (
    <section className="mb-10">
      <h2 className="mb-3 text-lg font-semibold">Drafter link</h2>
      <p className="mb-4 max-w-2xl text-sm text-gray-400">
        Generate a short-lived shareable URL the drafter clicks to upload their
        set. No account, no portal — they paste in the link, drop the PDF,
        get the triage sheet. The link is one-per-drafter-relationship; rotate
        it any time.
      </p>

      <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-6">
        <form onSubmit={onCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="sm:col-span-1">
            <label className="mb-1 block text-xs text-gray-400">Drafter name (optional)</label>
            <input
              type="text"
              value={drafterName}
              onChange={(e) => setDrafterName(e.target.value)}
              placeholder="e.g. Fiona"
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-gray-400">Drafter email (optional — we'll email the link + briefing)</label>
            <input
              type="email"
              value={drafterEmail}
              onChange={(e) => setDrafterEmail(e.target.value)}
              placeholder="fiona@modularwa.com.au"
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">Expires in (days)</label>
            <input
              type="number"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              min={1}
              max={90}
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
          </div>
          <div className="sm:col-span-4 flex">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-gray-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
            >
              {busy ? 'Working…' : drafterEmail ? 'Generate link & email drafter' : 'Generate new link'}
            </button>
          </div>
        </form>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {newLink && (
          <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
            <div className="mb-1 text-xs text-emerald-300">
              {emailStatus?.sent
                ? 'Sent. The drafter now has the link + briefing in their inbox. Same URL below if you want to share it elsewhere:'
                : emailStatus && !emailStatus.sent
                  ? `Link created but the email didn't send (${emailStatus.error ?? 'unknown error'}). Share the URL manually:`
                  : 'Share this URL with the drafter — shown once, not stored in clear text:'}
            </div>
            <code className="block break-all rounded bg-gray-950 px-3 py-2 font-mono text-xs text-emerald-200">
              {newLink}
            </code>
          </div>
        )}

        {existingTokens.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">
              Active links
            </div>
            <div className="overflow-hidden rounded-lg border border-gray-800">
              <table className="w-full text-xs">
                <thead className="bg-gray-900/60 text-left text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Drafter</th>
                    <th className="px-3 py-2">Expires</th>
                    <th className="px-3 py-2">Uses</th>
                    <th className="px-3 py-2">Last used</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {existingTokens.map((t) => (
                    <tr key={t.id} className="text-gray-300">
                      <td className="px-3 py-2">{t.drafter_name ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-500">
                        {new Date(t.expires_at).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2">{t.uses}</td>
                      <td className="px-3 py-2 text-gray-500">
                        {t.last_used_at ? new Date(t.last_used_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-3 py-2">
                        {t.revoked_at ? (
                          <span className="text-red-400">revoked</span>
                        ) : new Date(t.expires_at) < new Date() ? (
                          <span className="text-gray-500">expired</span>
                        ) : (
                          <span className="text-emerald-400">active</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
