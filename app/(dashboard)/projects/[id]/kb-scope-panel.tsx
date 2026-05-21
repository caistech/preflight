'use client';

import { useEffect, useState, useTransition } from 'react';

type Scope = 'project' | 'cross-project' | 'general';

interface Proposal {
  id: string;
  kb_document_id: string;
  proposed_scope: Scope;
  proposed_applies_when: Record<string, string> | null;
  confidence: number | null;
  reasoning: string | null;
  status: string;
  created_at: string;
  kb_documents?: { title: string; source_kind: string } | null;
}

const SCOPE_LABEL: Record<Scope, string> = {
  project: 'Project only',
  'cross-project': 'Cross-project',
  general: 'General (all projects)',
};

const SCOPE_HINT: Record<Scope, string> = {
  project: 'Used only when the rule engine runs on this project. Default.',
  'cross-project': 'Available to any project whose facts match the applies_when filter (e.g. all ModularWA dwellings).',
  general: 'Available to every project regardless of builder, council, dwelling type. Use sparingly.',
};

export function KbScopePanel({ projectId }: { projectId: string }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scopeOverrides, setScopeOverrides] = useState<Record<string, Scope>>({});
  const [appliesWhenJson, setAppliesWhenJson] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/kb-scope-proposals`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setProposals(j.proposals ?? []);
      const overrides: Record<string, Scope> = {};
      const aw: Record<string, string> = {};
      for (const p of j.proposals ?? []) {
        overrides[p.id] = p.proposed_scope;
        aw[p.id] = p.proposed_applies_when ? JSON.stringify(p.proposed_applies_when, null, 2) : '';
      }
      setScopeOverrides(overrides);
      setAppliesWhenJson(aw);
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

  async function resolve(proposalId: string, action: 'approve' | 'reject') {
    setError(null);
    startTransition(async () => {
      try {
        const scope = scopeOverrides[proposalId];
        const appliesWhen = appliesWhenJson[proposalId]?.trim();
        let parsedAw: Record<string, string> | null = null;
        if (action === 'approve' && scope === 'cross-project' && appliesWhen) {
          try {
            parsedAw = JSON.parse(appliesWhen);
          } catch {
            setError('applies_when must be valid JSON');
            return;
          }
        }
        const r = await fetch(`/api/projects/${projectId}/kb-scope-proposals/${proposalId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            ...(action === 'approve' ? { scope_override: scope, applies_when_override: parsedAw } : {}),
          }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setProposals((prev) => prev.filter((p) => p.id !== proposalId));
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/30 p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-gray-100">Pending KB scope decisions</h2>
        <button type="button" onClick={refresh} className="text-xs text-gray-500 hover:text-emerald-400">
          Refresh
        </button>
      </div>
      <p className="mb-4 text-xs text-gray-500">
        For each newly ingested document, an LLM proposes whether it&apos;s project-only,
        cross-project (with an applies_when filter), or generally useful. Approving promotes
        the document; the rule engine then sees it when retrieving for any matching project.
        Wrongly promoting pollutes future projects — be conservative.
      </p>

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading && <div className="text-xs text-gray-500">Loading…</div>}

      {!loading && proposals.length === 0 && (
        <div className="text-xs text-gray-500">
          No pending scope decisions. Ingest a document under Sources to generate proposals.
        </div>
      )}

      <ul className="space-y-3">
        {proposals.map((p) => {
          const confidencePct = p.confidence !== null ? Math.round(p.confidence * 100) : null;
          const currentScope = scopeOverrides[p.id] ?? p.proposed_scope;
          return (
            <li key={p.id} className="rounded-lg border border-gray-800 bg-gray-950/60 p-3">
              <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                <span className="font-medium text-gray-200">
                  {p.kb_documents?.title ?? '(untitled doc)'}
                </span>
                <span className="text-xs text-gray-500">
                  {p.kb_documents?.source_kind ?? 'unknown source'}
                </span>
                {confidencePct !== null && (
                  <span className="text-xs text-gray-500">conf {confidencePct}%</span>
                )}
              </div>
              {p.reasoning && (
                <div className="mb-2 text-xs italic text-gray-400">{p.reasoning}</div>
              )}
              <div className="mb-2 space-y-1 text-xs">
                {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => (
                  <label key={s} className="flex cursor-pointer items-start gap-2 rounded p-1 hover:bg-gray-900">
                    <input
                      type="radio"
                      name={`scope-${p.id}`}
                      checked={currentScope === s}
                      onChange={() => setScopeOverrides((prev) => ({ ...prev, [p.id]: s }))}
                      className="mt-0.5 accent-emerald-500"
                    />
                    <div>
                      <div className="font-medium text-gray-100">{SCOPE_LABEL[s]}</div>
                      <div className="text-gray-500">{SCOPE_HINT[s]}</div>
                    </div>
                  </label>
                ))}
              </div>
              {currentScope === 'cross-project' && (
                <div className="mb-2">
                  <label className="mb-1 block text-xs text-gray-400">applies_when (JSON)</label>
                  <textarea
                    value={appliesWhenJson[p.id] ?? ''}
                    onChange={(e) => setAppliesWhenJson((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    rows={3}
                    className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 font-mono text-xs text-gray-100 outline-none focus:border-emerald-500"
                    placeholder={'{\n  "builder": "ModularWA"\n}'}
                  />
                </div>
              )}
              <div className="flex items-center justify-end gap-2 text-xs">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => resolve(p.id, 'reject')}
                  className="rounded border border-gray-700 px-2 py-1 text-gray-400 hover:border-red-500 hover:text-red-400 disabled:opacity-40"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => resolve(p.id, 'approve')}
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
