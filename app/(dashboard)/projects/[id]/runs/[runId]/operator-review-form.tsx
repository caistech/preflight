'use client';

import { useState } from 'react';

type Review = 'agree' | 'disagree_overrule' | 'promote_to_rule' | 'add_more_context';

const REVIEW_LABEL: Record<Review, string> = {
  agree: 'Agree with drafter',
  disagree_overrule: 'Disagree — overrule the drafter',
  promote_to_rule: 'Promote to rule refinement',
  add_more_context: 'Add context (drafter decision stands)',
};

const REVIEW_HINT: Record<Review, string> = {
  agree: "The drafter's call is correct. Recorded as the canonical decision for this item.",
  disagree_overrule: "The drafter's call is wrong; your judgment supersedes. Outcome flips to whatever you specify in the rationale.",
  promote_to_rule: 'Signals that the underlying rule needs work — surfaces to the next register-update cycle.',
  add_more_context: "Drafter's outcome stands. You're adding clarification for future projects.",
};

interface Props {
  projectId: string;
  decisionId: string;
  drafterDecision: string;
  drafterRationale: string;
  existingReview?: {
    review: Review;
    rationale: string;
    reviewed_at: string;
  } | null;
}

export function OperatorReviewForm({
  projectId,
  decisionId,
  drafterDecision,
  drafterRationale,
  existingReview,
}: Props) {
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<Review>(existingReview?.review ?? 'agree');
  const [rationale, setRationale] = useState<string>(existingReview?.rationale ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(existingReview ?? null);

  async function save() {
    setError(null);
    if (rationale.trim().length < 5) {
      setError('Rationale must be at least 5 characters.');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/decisions/${decisionId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review, rationale: rationale.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setSaved({ review, rationale: rationale.trim(), reviewed_at: new Date().toISOString() });
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-700 bg-gray-900/40 p-3 text-xs">
      <div className="mb-2 border-l-2 border-emerald-600 pl-2">
        <div className="text-emerald-300">Drafter said: <span className="font-mono">{drafterDecision}</span></div>
        <div className="mt-0.5 text-gray-300">&ldquo;{drafterRationale}&rdquo;</div>
      </div>

      {saved && !open && (
        <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-semibold text-amber-300">Your review: {REVIEW_LABEL[saved.review]}</span>
            <button type="button" onClick={() => setOpen(true)} className="text-amber-300 hover:underline">
              Edit
            </button>
          </div>
          <div className="text-amber-200/80">{saved.rationale}</div>
        </div>
      )}

      {!saved && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-gray-400 underline-offset-2 hover:text-emerald-400 hover:underline"
        >
          Review this drafter decision →
        </button>
      )}

      {open && (
        <div className="mt-2 rounded border border-gray-700 bg-gray-950 p-2">
          <div className="mb-2 space-y-1">
            {(Object.keys(REVIEW_LABEL) as Review[]).map((r) => (
              <label key={r} className="flex cursor-pointer items-start gap-2 rounded p-1.5 hover:bg-gray-900">
                <input
                  type="radio"
                  name={`review-${decisionId}`}
                  checked={review === r}
                  onChange={() => setReview(r)}
                  className="mt-0.5 accent-emerald-500"
                />
                <div>
                  <div className="font-medium text-gray-100">{REVIEW_LABEL[r]}</div>
                  <div className="text-gray-500">{REVIEW_HINT[r]}</div>
                </div>
              </label>
            ))}
          </div>
          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="Your rationale. Operator-reviewed decisions feed cross-project KB — be specific."
            className="mb-2 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-emerald-500"
          />
          {error && (
            <div className="mb-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-red-300">{error}</div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => { setOpen(false); setError(null); }}
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
              {busy ? 'Saving…' : 'Save review'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
