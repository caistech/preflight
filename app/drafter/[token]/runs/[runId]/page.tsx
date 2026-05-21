import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/service';
import { hashDrafterToken } from '@/lib/drafter-token';
import { Disclaimer } from '@/components/disclaimer';
import { DecisionForm } from '../../decision-form';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ token: string; runId: string }>;
}

type Decision = 'confirm_finding' | 'overrule_pass' | 'overrule_fail' | 'add_context';
type OperatorReview = 'agree' | 'disagree_overrule' | 'promote_to_rule' | 'add_more_context';

interface ExistingDecision {
  id: string;
  decision: Decision;
  rationale: string;
  created_at: string;
}

interface ExistingOperatorReview {
  review: OperatorReview;
  rationale: string;
  reviewed_at: string;
}

interface ResultLine {
  check_result_id: string;
  outcome: string;
  message: string;
  severity: string;
  requirement: string;
  source: string;
  decision: ExistingDecision | null;
  operatorReview: ExistingOperatorReview | null;
}

export default async function DrafterRunPage({ params }: Props) {
  const { token, runId } = await params;
  const db = createServiceClient();

  // Verify the token still owns this run — defence in depth even with a UUID
  let tokenInvalid = false;
  let drafterTokenId: string | null = null;
  let projectName = '';

  try {
    const hash = hashDrafterToken(token);
    const { data: t } = await db
      .from('drafter_tokens')
      .select('id, expires_at, revoked_at, projects(name)')
      .eq('token_hash', hash)
      .single();
    if (!t) tokenInvalid = true;
    else if (t.revoked_at) tokenInvalid = true;
    else if (new Date(t.expires_at) < new Date()) tokenInvalid = true;
    else {
      drafterTokenId = t.id;
      const p = (t.projects ?? {}) as { name?: string };
      projectName = p.name ?? '';
    }
  } catch {
    tokenInvalid = true;
  }

  if (tokenInvalid || !drafterTokenId) {
    return (
      <main className="min-h-screen bg-gray-950 text-white">
        <div className="mx-auto max-w-md px-6 py-16">
          <div className="mb-2 text-sm text-emerald-400">Preflight</div>
          <h1 className="mb-2 text-3xl font-bold">Link not valid</h1>
        </div>
      </main>
    );
  }

  // Pull the run + drawing set + results, scoped by drafter_token_id
  const { data: run } = await db
    .from('check_runs')
    .select('id, drafter_token_id, status, hard_fails, needs_review, confirmed_ok, created_at, completed_at, drawing_sets(filename, page_count, byte_size)')
    .eq('id', runId)
    .single();

  if (!run || run.drafter_token_id !== drafterTokenId) {
    return (
      <main className="min-h-screen bg-gray-950 text-white">
        <div className="mx-auto max-w-md px-6 py-16">
          <div className="mb-2 text-sm text-emerald-400">Preflight</div>
          <h1 className="mb-2 text-3xl font-bold">Run not found</h1>
          <p className="text-sm text-gray-400">
            This result either does not exist or belongs to a different drafter link.
          </p>
          <Link
            href={`/drafter/${token}`}
            className="mt-6 inline-block text-sm text-emerald-400 hover:underline"
          >
            ← Back to your project page
          </Link>
        </div>
      </main>
    );
  }

  const { data: results } = await db
    .from('check_results')
    .select('id, outcome, message, evidence, register_rows(requirement, source, severity)')
    .eq('check_run_id', runId);

  const { data: decisionRows } = await db
    .from('check_result_decisions')
    .select('id, check_result_id, decision, rationale, created_at, operator_review, operator_review_rationale, reviewed_at')
    .eq('check_run_id', runId);
  const decisionsByResult = new Map<string, ExistingDecision>();
  const operatorReviewByResult = new Map<string, ExistingOperatorReview>();
  for (const d of decisionRows ?? []) {
    decisionsByResult.set(d.check_result_id, {
      id: d.id,
      decision: d.decision as Decision,
      rationale: d.rationale,
      created_at: d.created_at,
    });
    if (d.operator_review) {
      operatorReviewByResult.set(d.check_result_id, {
        review: d.operator_review as OperatorReview,
        rationale: d.operator_review_rationale ?? '',
        reviewed_at: d.reviewed_at ?? '',
      });
    }
  }

  const hardFails: ResultLine[] = [];
  const needsReview: ResultLine[] = [];
  const confirmedOk: ResultLine[] = [];
  for (const r of results ?? []) {
    const reg = ((r as { register_rows?: { requirement?: string; source?: string; severity?: string } }).register_rows ?? {}) as {
      requirement?: string;
      source?: string;
      severity?: string;
    };
    const line: ResultLine = {
      check_result_id: r.id,
      outcome: r.outcome,
      message: r.message ?? '',
      severity: reg.severity ?? 'review',
      requirement: reg.requirement ?? '',
      source: reg.source ?? '',
      decision: decisionsByResult.get(r.id) ?? null,
      operatorReview: operatorReviewByResult.get(r.id) ?? null,
    };
    if (r.outcome === 'fail' && reg.severity === 'hard-fail') hardFails.push(line);
    else if (r.outcome === 'fail' || r.outcome === 'unsure') needsReview.push(line);
    else if (r.outcome === 'pass') confirmedOk.push(line);
  }

  const ds = ((run as { drawing_sets?: { filename?: string | null; page_count?: number; byte_size?: number } }).drawing_sets ?? {}) as {
    filename?: string | null;
    page_count?: number;
    byte_size?: number;
  };

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Link
          href={`/drafter/${token}`}
          className="mb-4 inline-block text-xs text-emerald-400 hover:underline"
        >
          ← Back to {projectName || 'project'}
        </Link>

        <div className="mb-2 text-sm text-emerald-400">Preflight · result</div>
        <h1 className="mb-2 text-2xl font-bold">{ds.filename ?? '(unnamed upload)'}</h1>
        <p className="mb-8 max-w-2xl text-sm text-gray-400">
          Run on {new Date(run.created_at).toLocaleString('en-AU')}
          {ds.page_count ? ` · ${ds.page_count} pages` : ''}
          {ds.byte_size ? ` · ${(ds.byte_size / 1024 / 1024).toFixed(1)} MB` : ''}
        </p>

        <div className="mb-8 grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-center">
            <div className="text-3xl font-bold text-red-300">{run.hard_fails ?? 0}</div>
            <div className="text-xs text-red-400">Hard fails</div>
          </div>
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-center">
            <div className="text-3xl font-bold text-amber-300">{run.needs_review ?? 0}</div>
            <div className="text-xs text-amber-400">Needs eyes</div>
          </div>
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
            <div className="text-3xl font-bold text-emerald-300">{run.confirmed_ok ?? 0}</div>
            <div className="text-xs text-emerald-400">Confirmed OK</div>
          </div>
        </div>

        {hardFails.length > 0 && (
          <Section title="🔴 Hard fails — fix before submission" lines={hardFails} tone="red" token={token} />
        )}
        {needsReview.length > 0 && (
          <Section title="🟡 Needs eyes — read and decide" lines={needsReview} tone="amber" token={token} />
        )}
        {confirmedOk.length > 0 && (
          <Section title="✅ Confirmed OK" lines={confirmedOk} tone="emerald" collapsible token={token} />
        )}

        {hardFails.length + needsReview.length + confirmedOk.length === 0 && (
          <div className="rounded-2xl border border-gray-800 bg-gray-900/30 p-6 text-sm text-gray-400">
            No results recorded for this run. The check engine may have errored on every row,
            or the upload completed before any register row evaluated.
          </div>
        )}

        <Disclaimer />
      </div>
    </main>
  );
}

function operatorReviewLabel(r: OperatorReview): string {
  switch (r) {
    case 'agree': return 'agrees with your call';
    case 'disagree_overrule': return 'overruled your call';
    case 'promote_to_rule': return 'wants the rule refined based on this';
    case 'add_more_context': return 'added context';
  }
}

function Section({
  title,
  lines,
  tone,
  token,
  collapsible,
}: {
  title: string;
  lines: ResultLine[];
  tone: 'red' | 'amber' | 'emerald';
  token: string;
  collapsible?: boolean;
}) {
  const borderClass =
    tone === 'red' ? 'border-red-500/30' : tone === 'amber' ? 'border-amber-500/30' : 'border-emerald-500/30';
  return (
    <details
      className={`mb-4 rounded-2xl border bg-gray-900/30 ${borderClass}`}
      open={!collapsible}
    >
      <summary className="cursor-pointer list-none px-5 py-3 text-sm font-semibold text-gray-200">
        {title}{' '}
        <span className="text-xs font-normal text-gray-500">({lines.length})</span>
      </summary>
      <div className="space-y-2 px-5 pb-5">
        {lines.map((l) => (
          <div key={l.check_result_id} className="rounded-lg border border-gray-800 bg-gray-950/60 p-4 text-sm">
            <div className="mb-1 text-gray-100">{l.requirement}</div>
            <div className="mb-2 text-xs text-gray-400">{l.message}</div>
            <div className="text-xs text-gray-500">Source: {l.source}</div>
            {l.operatorReview && (
              <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                <div className="mb-1 font-semibold text-amber-300">
                  Project owner reviewed: {operatorReviewLabel(l.operatorReview.review)}
                </div>
                <div className="text-amber-200/90">{l.operatorReview.rationale}</div>
                {l.operatorReview.reviewed_at && (
                  <div className="mt-1 text-amber-300/60">
                    {new Date(l.operatorReview.reviewed_at).toLocaleString('en-AU')}
                  </div>
                )}
              </div>
            )}
            {l.check_result_id && (
              <DecisionForm
                token={token}
                checkResultId={l.check_result_id}
                toolOutcome={l.outcome}
                existingDecision={l.decision}
              />
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
