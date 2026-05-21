'use client';

import { useEffect, useState, useTransition } from 'react';

interface Candidate {
  id: string;
  proposed_key: string;
  proposed_value: string;
  confidence: number | null;
  evidence_quote: string | null;
  reasoning: string | null;
  status: string;
  source_document_id: string | null;
  kb_documents?: { title: string } | null;
  created_at: string;
}

export function FactCandidatesPanel({ projectId }: { projectId: string }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/fact-candidates`);
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

  async function resolve(candidateId: string, action: 'approve' | 'reject') {
    const valueOverride = editing[candidateId];
    startTransition(async () => {
      try {
        const r = await fetch(`/api/projects/${projectId}/fact-candidates/${candidateId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            ...(action === 'approve' && valueOverride ? { value_override: valueOverride } : {}),
          }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setCandidates((prev) => prev.filter((c) => c.id !== candidateId));
        setEditing((prev) => {
          const next = { ...prev };
          delete next[candidateId];
          return next;
        });
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/30 p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-gray-100">Pending facts</h2>
        <button
          type="button"
          onClick={refresh}
          className="text-xs text-gray-500 hover:text-emerald-400"
        >
          Refresh
        </button>
      </div>
      <p className="mb-4 text-xs text-gray-500">
        LLM-proposed project facts from recently ingested documents. Approve to write
        to project_facts; reject to drop. You can edit the value before approving when
        the LLM got the concept right but the wording slightly wrong.
      </p>

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading && <div className="text-xs text-gray-500">Loading…</div>}

      {!loading && candidates.length === 0 && (
        <div className="text-xs text-gray-500">
          No pending candidates. Ingest a document under Sources to generate proposals.
        </div>
      )}

      <ul className="space-y-3">
        {candidates.map((c) => {
          const confidencePct = c.confidence !== null ? Math.round(c.confidence * 100) : null;
          const editedValue = editing[c.id] ?? c.proposed_value;
          return (
            <li key={c.id} className="rounded-lg border border-gray-800 bg-gray-950/60 p-3">
              <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                <span className="font-mono text-emerald-400">{c.proposed_key}</span>
                <span className="text-gray-500">=</span>
                <input
                  type="text"
                  value={editedValue}
                  onChange={(e) => setEditing((prev) => ({ ...prev, [c.id]: e.target.value }))}
                  className="flex-1 min-w-[200px] rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-100 outline-none focus:border-emerald-500"
                />
                {confidencePct !== null && (
                  <span className="text-xs text-gray-500">conf {confidencePct}%</span>
                )}
              </div>
              {c.evidence_quote && (
                <div className="mb-2 border-l-2 border-gray-700 pl-2 text-xs italic text-gray-400">
                  &ldquo;{c.evidence_quote}&rdquo;
                </div>
              )}
              {c.reasoning && (
                <div className="mb-2 text-xs text-gray-500">{c.reasoning}</div>
              )}
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-600">
                  {c.kb_documents?.title ? `from ${c.kb_documents.title}` : 'no source'}
                  {' · '}
                  {new Date(c.created_at).toLocaleString('en-AU')}
                </span>
                <div className="flex gap-2">
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
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
