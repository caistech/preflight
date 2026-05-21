'use client';

import { useEffect, useState, useTransition } from 'react';

interface Candidate {
  id: string;
  source_decision_id: string | null;
  source_project_id: string | null;
  proposed_requirement: string;
  proposed_source: string;
  proposed_check_type: string;
  proposed_check_spec: Record<string, unknown>;
  proposed_severity: string;
  confidence: number | null;
  reasoning: string | null;
  status: string;
  created_at: string;
  projects?: { name: string } | null;
}

export function RuleCandidatesPanel({ projectId }: { projectId: string }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { requirement?: string; severity?: string }>>({});
  const [isPending, startTransition] = useTransition();

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/register-row-candidates`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setCandidates(j.candidates ?? []);
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

  function resolve(id: string, action: 'approve' | 'reject') {
    setError(null);
    startTransition(async () => {
      try {
        const e = edits[id] ?? {};
        const payload: Record<string, unknown> = { action };
        if (action === 'approve' && (e.requirement || e.severity)) {
          payload.edits = {};
          if (e.requirement) (payload.edits as Record<string, unknown>).requirement = e.requirement;
          if (e.severity) (payload.edits as Record<string, unknown>).severity = e.severity;
        }
        const r = await fetch(`/api/projects/${projectId}/register-row-candidates/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setCandidates((prev) => prev.filter((c) => c.id !== id));
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/30 p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-gray-100">Pending rule candidates</h2>
        <button type="button" onClick={refresh} className="text-xs text-gray-500 hover:text-emerald-400">
          Refresh
        </button>
      </div>
      <p className="mb-4 text-xs text-gray-500">
        LLM-proposed register rows for this project, derived from an operator
        promote_to_rule decision on a sibling project. Approving inserts a new
        active row into the register; you can tweak the requirement text and
        severity before approving.
      </p>

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading && <div className="text-xs text-gray-500">Loading…</div>}

      {!loading && candidates.length === 0 && (
        <div className="text-xs text-gray-500">
          No pending rule candidates. They appear here when an operator picks promote_to_rule
          on a sibling project and the resulting kb_document gets approved cross-project.
        </div>
      )}

      <ul className="space-y-3">
        {candidates.map((c) => {
          const confidencePct = c.confidence !== null ? Math.round(c.confidence * 100) : null;
          const reqValue = edits[c.id]?.requirement ?? c.proposed_requirement;
          const sevValue = edits[c.id]?.severity ?? c.proposed_severity;
          const sourceLabel = c.projects?.name ?? c.source_project_id ?? 'unknown';
          return (
            <li key={c.id} className="rounded-lg border border-gray-800 bg-gray-950/60 p-3 text-xs">
              <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-emerald-400">{c.proposed_check_type}</span>
                <span className="text-gray-500">·</span>
                <span className="text-gray-400">from {sourceLabel}</span>
                {confidencePct !== null && (
                  <span className="text-gray-500">conf {confidencePct}%</span>
                )}
              </div>
              <label className="mb-1 block text-gray-400">Requirement</label>
              <textarea
                value={reqValue}
                onChange={(e) => setEdits((prev) => ({ ...prev, [c.id]: { ...prev[c.id], requirement: e.target.value } }))}
                rows={3}
                className="mb-2 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-100 outline-none focus:border-emerald-500"
              />
              <div className="mb-2 flex items-center gap-3">
                <label className="text-gray-400">Severity</label>
                <select
                  value={sevValue}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [c.id]: { ...prev[c.id], severity: e.target.value } }))}
                  className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-100 outline-none focus:border-emerald-500"
                >
                  <option value="hard-fail">hard-fail</option>
                  <option value="review">review</option>
                  <option value="info">info</option>
                </select>
                <span className="text-gray-500">Source: {c.proposed_source.slice(0, 80)}</span>
              </div>
              <details className="mb-2 text-gray-500">
                <summary className="cursor-pointer">check_spec</summary>
                <pre className="mt-1 overflow-x-auto rounded bg-gray-950 p-2 font-mono text-gray-400">
                  {JSON.stringify(c.proposed_check_spec, null, 2)}
                </pre>
              </details>
              {c.reasoning && <div className="mb-2 italic text-gray-500">{c.reasoning}</div>}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => resolve(c.id, 'reject')}
                  className="rounded border border-gray-700 px-2 py-1 text-gray-400 hover:border-red-500 hover:text-red-400 disabled:opacity-40"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => resolve(c.id, 'approve')}
                  className="rounded bg-emerald-500/20 px-3 py-1 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40"
                >
                  Approve
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
