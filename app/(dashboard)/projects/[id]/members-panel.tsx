'use client';

import { useEffect, useState, useTransition } from 'react';

interface Member {
  user_id: string;
  email: string;
  role: 'owner' | 'member';
  created_at: string;
  is_self: boolean;
}

export function MembersPanel({ projectId }: { projectId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'owner' | 'member'>('member');
  const [isPending, startTransition] = useTransition();

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/members`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setMembers(j.members ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function addMember(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const r = await fetch(`/api/projects/${projectId}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, role }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setEmail('');
        setRole('member');
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  function changeRole(userId: string, newRole: 'owner' | 'member') {
    setError(null);
    startTransition(async () => {
      try {
        const r = await fetch(`/api/projects/${projectId}/members/${userId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: newRole }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  function removeMember(userId: string, email: string) {
    if (!confirm(`Remove ${email} from this project? They lose access immediately.`)) return;
    setError(null);
    startTransition(async () => {
      try {
        const r = await fetch(`/api/projects/${projectId}/members/${userId}`, { method: 'DELETE' });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/30 p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-gray-100">Project members</h2>
        <button type="button" onClick={refresh} className="text-xs text-gray-500 hover:text-emerald-400">
          Refresh
        </button>
      </div>
      <p className="mb-4 text-xs text-gray-500">
        Anyone listed here can read every project surface and (if they have <code className="rounded bg-gray-800 px-1 text-emerald-300">owner</code>)
        edit / invite. Members must have signed in once at /login before they can be added.
      </p>

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-xs text-gray-500">Loading…</div>
      ) : (
        <div className="mb-4 overflow-hidden rounded-lg border border-gray-800">
          <table className="w-full text-xs">
            <thead className="bg-gray-900/60 text-left uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Added</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {members.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-center text-gray-500">
                    No members yet.
                  </td>
                </tr>
              )}
              {members.map((m) => (
                <tr key={m.user_id} className="text-gray-200">
                  <td className="px-3 py-2">
                    {m.email} {m.is_self && <span className="text-gray-500">(you)</span>}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m.user_id, e.target.value as 'owner' | 'member')}
                      disabled={isPending || m.is_self}
                      className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs outline-none focus:border-emerald-500 disabled:opacity-50"
                    >
                      <option value="owner">owner</option>
                      <option value="member">member</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 text-gray-500">
                    {new Date(m.created_at).toLocaleDateString('en-AU')}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!m.is_self && (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => removeMember(m.user_id, m.email)}
                        className="rounded border border-gray-700 px-2 py-1 text-gray-400 hover:border-red-500 hover:text-red-400 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={addMember} className="space-y-2">
        <div className="text-xs font-semibold text-gray-300">Add member</div>
        <div className="flex flex-wrap items-end gap-2 text-xs">
          <div className="flex-1 min-w-[200px]">
            <label className="mb-1 block text-gray-400">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
              required
              className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-gray-400">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'owner' | 'member')}
              className="rounded border border-gray-700 bg-gray-900 px-2 py-1.5 outline-none focus:border-emerald-500"
            >
              <option value="member">member</option>
              <option value="owner">owner</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={isPending || !email}
            className="rounded bg-emerald-500 px-3 py-1.5 text-xs font-medium text-gray-950 hover:bg-emerald-400 disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </form>
    </section>
  );
}
