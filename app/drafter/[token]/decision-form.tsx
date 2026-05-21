'use client';

import { useState } from 'react';

type Decision = 'confirm_finding' | 'overrule_pass' | 'overrule_fail' | 'add_context';

interface ExistingDecision {
  id: string;
  decision: Decision;
  rationale: string;
  created_at: string;
}

interface Props {
  token: string;
  checkResultId: string;
  toolOutcome: string;          // 'pass' | 'fail' | 'unsure' | 'error' — what the tool said
  existingDecision?: ExistingDecision | null;
}

const DECISION_LABEL: Record<Decision, string> = {
  confirm_finding: 'Confirm the tool finding',
  overrule_pass: 'Overrule → actually fine',
  overrule_fail: 'Overrule → actually a fail',
  add_context: 'Just add context',
};

const DECISION_HINT: Record<Decision, string> = {
  confirm_finding: 'You agree with what the tool said. Recorded as-is.',
  overrule_pass: 'The tool flagged this but it is correct for this project. Decision feeds back to make future runs smarter.',
  overrule_fail: 'The tool passed this but it is actually a problem. Decision feeds back as a hard signal.',
  add_context: 'Outcome stands; you are adding context that future projects can learn from.',
};

export function DecisionForm({ token, checkResultId, toolOutcome, existingDecision }: Props) {
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<Decision>(
    existingDecision?.decision ?? (toolOutcome === 'pass' ? 'add_context' : 'confirm_finding'),
  );
  const [rationale, setRationale] = useState<string>(existingDecision?.rationale ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ExistingDecision | null>(existingDecision ?? null);

  async function save() {
    setError(null);
    if (rationale.trim().length < 5) {
      setError('Add a rationale of at least 5 characters — short one-word notes leave no signal for future projects.');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/drafter/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          check_result_id: checkResultId,
          decision,
          rationale: rationale.trim(),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setSaved({
        id: j.decision_id,
        decision,
        rationale: rationale.trim(),
        created_at: new Date().toISOString(),
      });
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Compact display when a decision exists and the form is closed.
  if (saved && !open) {
    return (
      <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-semibold text-emerald-300">
            Your decision: {DECISION_LABEL[saved.decision]}
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-emerald-300 hover:underline"
          >
            Edit
          </button>
        </div>
        <div className="text-emerald-200/80">{saved.rationale}</div>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs text-gray-400 underline-offset-2 hover:text-emerald-400 hover:underline"
        >
          Record a decision on this item →
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-700 bg-gray-950/80 p-3 text-xs">
      <div className="mb-2 text-gray-300">
        Tool said: <span className="font-mono text-gray-100">{toolOutcome}</span>. Your call:
      </div>
      <div className="mb-3 space-y-1">
        {(Object.keys(DECISION_LABEL) as Decision[]).map((d) => (
          <label key={d} className="flex cursor-pointer items-start gap-2 rounded p-1.5 hover:bg-gray-900">
            <input
              type="radio"
              name={`decision-${checkResultId}`}
              checked={decision === d}
              onChange={() => setDecision(d)}
              className="mt-0.5 accent-emerald-500"
            />
            <div>
              <div className="font-medium text-gray-100">{DECISION_LABEL[d]}</div>
              <div className="text-gray-500">{DECISION_HINT[d]}</div>
            </div>
          </label>
        ))}
      </div>
      <label className="mb-1 block text-gray-400">Why? (this is what feeds back into the KB)</label>
      <textarea
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        rows={3}
        maxLength={4000}
        placeholder="e.g. SV symbols are correct for ModularWA's biscuit-footing system per A107 detail; not a slab-on-ground."
        className="mb-2 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-emerald-500"
      />
      {error && (
        <div className="mb-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-red-300">{error}</div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded border border-gray-700 px-2 py-1 text-gray-400 hover:border-gray-500 hover:text-gray-200"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded bg-emerald-500/20 px-3 py-1 font-medium text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save decision'}
        </button>
      </div>
    </div>
  );
}
