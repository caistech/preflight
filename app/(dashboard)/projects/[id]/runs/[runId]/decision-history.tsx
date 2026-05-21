'use client';

import { useState } from 'react';

export interface DecisionVersion {
  version_number: number;
  decision: string;
  rationale: string;
  operator_review: string | null;
  operator_review_rationale: string | null;
  change_kind: 'initial' | 'drafter_edit' | 'operator_review' | 'operator_edit';
  created_at: string;
}

const CHANGE_KIND_LABEL: Record<DecisionVersion['change_kind'], string> = {
  initial: 'Drafter created decision',
  drafter_edit: 'Drafter edited',
  operator_review: 'Operator reviewed',
  operator_edit: 'Operator edited review',
};

export function DecisionHistory({ versions }: { versions: DecisionVersion[] }) {
  const [open, setOpen] = useState(false);
  if (versions.length <= 1) return null;
  const sorted = [...versions].sort((a, b) => b.version_number - a.version_number);

  return (
    <div className="mt-3 border-t border-gray-800 pt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-xs text-gray-500 hover:text-emerald-400"
      >
        {open ? '▾' : '▸'} History — {versions.length} revisions
      </button>
      {open && (
        <ol className="mt-2 space-y-2 border-l-2 border-gray-700 pl-3 text-xs">
          {sorted.map((v) => (
            <li key={v.version_number}>
              <div className="text-gray-400">
                v{v.version_number} — {CHANGE_KIND_LABEL[v.change_kind]} ·{' '}
                <span className="text-gray-500">
                  {new Date(v.created_at).toLocaleString('en-AU')}
                </span>
              </div>
              <div className="text-gray-300">
                <span className="font-mono text-gray-500">drafter:</span> {v.decision} — &ldquo;{v.rationale}&rdquo;
              </div>
              {v.operator_review && (
                <div className="text-amber-300">
                  <span className="font-mono text-amber-500/70">operator:</span> {v.operator_review} — &ldquo;{v.operator_review_rationale}&rdquo;
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
