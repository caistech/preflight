'use client';

import { useState } from 'react';

export function AddRuleForm({ projectId, kbDocs }: { projectId: string; kbDocs: Array<{ id: string; title: string; source_kind: string }> }) {
  const [open, setOpen] = useState(false);
  const [requirement, setRequirement] = useState('');
  const [source, setSource] = useState('');
  const [prompt, setPrompt] = useState('');
  const [contextHints, setContextHints] = useState('');
  const [severity, setSeverity] = useState<'hard-fail' | 'review' | 'informational'>('review');
  const [useKbRetrieval, setUseKbRetrieval] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await fetch(`/api/projects/${projectId}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        check_type: 'manual-check',
        requirement,
        source,
        severity,
        prompt,
        context_hints: contextHints
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        use_kb_retrieval: useKbRetrieval,
      }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, text: j.error ?? `HTTP ${r.status}` });
      return;
    }
    setMsg({ ok: true, text: 'Rule added. Page will refresh.' });
    setTimeout(() => window.location.reload(), 800);
  };

  if (!open) {
    return (
      <div className="mb-4 flex items-center justify-between">
        <p className="max-w-2xl text-sm text-gray-400">
          Every checkable assertion this project will run drawing sets against.
          Each row carries its own source attribution — the register is the
          institutional memory of past rejections, never re-invented from
          scratch.
        </p>
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-gray-950 hover:bg-emerald-400"
        >
          + Add rule
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-2xl border border-gray-800 bg-gray-900/40 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Add an LLM-backed rule</h3>
        <button onClick={() => setOpen(false)} className="text-xs text-gray-500 hover:text-gray-300">
          Cancel
        </button>
      </div>
      <p className="mb-4 text-xs text-gray-500">
        Manual-check rules ask the LLM a narrow yes/no/unsure question against the
        drawing&apos;s extracted text + (optionally) the project KB. The LLM never
        auto-passes — &quot;unsure&quot; is a valid return. Text-rule and logic-rule
        types still need code-level changes; ask for those separately.
      </p>

      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-gray-400">Requirement (what the rule checks, in plain English)</label>
          <textarea
            value={requirement}
            onChange={(e) => setRequirement(e.target.value)}
            rows={2}
            placeholder="e.g. The DATUM note must accurately describe the datum used for the level values shown on the drawing."
            required
            minLength={20}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-gray-400">Source attribution (where this requirement came from)</label>
          <input
            type="text"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="e.g. Rev H 2026-05-18 email to Zulz — partial AHD conversion caught by F2K review"
            required
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-gray-400">Prompt — the narrow question the LLM is asked</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="Find the DATUM note on this drawing. Does it accurately describe what's shown? Answer pass / fail / unsure with a one-sentence reason. Do NOT recommend a fix — flag for human review only."
            required
            minLength={30}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-gray-400">Context hints (comma-separated terms to slice text around)</label>
            <input
              type="text"
              value={contextHints}
              onChange={(e) => setContextHints(e.target.value)}
              placeholder="DATUM, AHD, FFL, assumed"
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">Severity</label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as typeof severity)}
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            >
              <option value="hard-fail">hard-fail — Council will query this</option>
              <option value="review">review — needs human eyes</option>
              <option value="informational">informational — surface only</option>
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={useKbRetrieval}
            onChange={(e) => setUseKbRetrieval(e.target.checked)}
            className="h-4 w-4 rounded border-gray-700 bg-gray-900"
          />
          Use KB retrieval — let the LLM pull from inbound emails / planner letters / Council audits ingested via Sources
        </label>

        {kbDocs.length > 0 && useKbRetrieval && (
          <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3 text-xs text-gray-500">
            Currently in this project&apos;s KB ({kbDocs.length}):
            <ul className="mt-1 space-y-0.5">
              {kbDocs.slice(0, 5).map((d) => (
                <li key={d.id}>• <span className="font-mono text-gray-400">[{d.source_kind}]</span> {d.title}</li>
              ))}
              {kbDocs.length > 5 && <li className="text-gray-600">…and {kbDocs.length - 5} more</li>}
            </ul>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-gray-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            {busy ? 'Adding…' : 'Add rule'}
          </button>
          {msg && (
            <span className={msg.ok ? 'text-xs text-emerald-300' : 'text-xs text-red-300'}>{msg.text}</span>
          )}
        </div>
      </form>
    </div>
  );
}
