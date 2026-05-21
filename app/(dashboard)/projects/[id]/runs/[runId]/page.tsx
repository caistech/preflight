import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveProjectId } from '@/lib/project-resolver';
import { OperatorReviewForm } from './operator-review-form';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string; runId: string }>;
}

type Review = 'agree' | 'disagree_overrule' | 'promote_to_rule' | 'add_more_context';

interface DecisionRow {
  id: string;
  check_result_id: string;
  decision: string;
  rationale: string;
  operator_review: Review | null;
  operator_review_rationale: string | null;
  reviewed_at: string | null;
}

interface ResultLine {
  check_result_id: string;
  outcome: string;
  message: string;
  severity: string;
  requirement: string;
  source: string;
  decision: DecisionRow | null;
}

export default async function OperatorRunPage({ params }: Props) {
  const { id: idOrSlug, runId } = await params;
  const db = await createClient();

  // Auth handled by middleware (/projects is in PROTECTED_PREFIXES).
  const projectId = await resolveProjectId(db, idOrSlug);
  if (!projectId) redirect('/projects');

  const { data: project } = await db.from('projects').select('name, slug').eq('id', projectId).single();
  if (!project) redirect('/projects');

  const { data: run } = await db
    .from('check_runs')
    .select('id, status, hard_fails, needs_review, confirmed_ok, created_at, drawing_sets(filename, page_count, byte_size)')
    .eq('id', runId)
    .eq('project_id', projectId)
    .single();
  if (!run) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12 text-white">
        <Link href={`/projects/${idOrSlug}`} className="text-xs text-emerald-400 hover:underline">
          ← Back to {project.name}
        </Link>
        <h1 className="mt-4 text-2xl font-bold">Run not found</h1>
      </main>
    );
  }

  const { data: results } = await db
    .from('check_results')
    .select('id, outcome, message, register_rows(requirement, source, severity)')
    .eq('check_run_id', runId);

  const { data: decisions } = await db
    .from('check_result_decisions')
    .select('id, check_result_id, decision, rationale, operator_review, operator_review_rationale, reviewed_at')
    .eq('check_run_id', runId);
  const decisionsByResult = new Map<string, DecisionRow>();
  for (const d of decisions ?? []) {
    decisionsByResult.set(d.check_result_id, d as DecisionRow);
  }

  const hardFails: ResultLine[] = [];
  const needsReview: ResultLine[] = [];
  const confirmedOk: ResultLine[] = [];
  for (const r of results ?? []) {
    const reg = (((r as { register_rows?: { requirement?: string; source?: string; severity?: string } | { requirement?: string; source?: string; severity?: string }[] }).register_rows) ?? {}) as { requirement?: string; source?: string; severity?: string };
    const line: ResultLine = {
      check_result_id: r.id,
      outcome: r.outcome,
      message: r.message ?? '',
      severity: reg.severity ?? 'review',
      requirement: reg.requirement ?? '',
      source: reg.source ?? '',
      decision: decisionsByResult.get(r.id) ?? null,
    };
    if (r.outcome === 'fail' && reg.severity === 'hard-fail') hardFails.push(line);
    else if (r.outcome === 'fail' || r.outcome === 'unsure') needsReview.push(line);
    else if (r.outcome === 'pass') confirmedOk.push(line);
  }

  const ds = ((run as { drawing_sets?: { filename?: string | null; page_count?: number; byte_size?: number } }).drawing_sets ?? {}) as { filename?: string | null; page_count?: number; byte_size?: number };
  const totalDecisions = decisions?.length ?? 0;
  const totalReviews = (decisions ?? []).filter((d) => d.operator_review).length;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 text-white">
      <Link href={`/projects/${idOrSlug}`} className="text-xs text-emerald-400 hover:underline">
        ← Back to {project.name}
      </Link>

      <div className="mt-2 mb-1 text-sm text-emerald-400">Preflight · operator triage view</div>
      <h1 className="mb-2 text-2xl font-bold">{ds.filename ?? '(unnamed upload)'}</h1>
      <p className="mb-4 max-w-2xl text-sm text-gray-400">
        Operator triage view of this drafter run. Each result row carries the drafter&apos;s decision
        (if any) and lets you stamp your review on top. Operator-reviewed decisions are what feed
        cross-project rule refinement — drafter decisions alone become candidate facts, but your
        review is the trusted signal.
      </p>
      <p className="mb-8 text-xs text-gray-500">
        Run on {new Date(run.created_at).toLocaleString('en-AU')} · {totalDecisions} drafter decision{totalDecisions === 1 ? '' : 's'} · {totalReviews} reviewed
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
        <Section title="🔴 Hard fails" lines={hardFails} tone="red" projectId={idOrSlug} />
      )}
      {needsReview.length > 0 && (
        <Section title="🟡 Needs eyes" lines={needsReview} tone="amber" projectId={idOrSlug} />
      )}
      {confirmedOk.length > 0 && (
        <Section title="✅ Confirmed OK" lines={confirmedOk} tone="emerald" projectId={idOrSlug} collapsible />
      )}
    </main>
  );
}

function Section({
  title,
  lines,
  tone,
  projectId,
  collapsible,
}: {
  title: string;
  lines: ResultLine[];
  tone: 'red' | 'amber' | 'emerald';
  projectId: string;
  collapsible?: boolean;
}) {
  const borderClass =
    tone === 'red' ? 'border-red-500/30' : tone === 'amber' ? 'border-amber-500/30' : 'border-emerald-500/30';
  return (
    <details className={`mb-4 rounded-2xl border bg-gray-900/30 ${borderClass}`} open={!collapsible}>
      <summary className="cursor-pointer list-none px-5 py-3 text-sm font-semibold text-gray-200">
        {title} <span className="text-xs font-normal text-gray-500">({lines.length})</span>
      </summary>
      <div className="space-y-2 px-5 pb-5">
        {lines.map((l) => (
          <div key={l.check_result_id} className="rounded-lg border border-gray-800 bg-gray-950/60 p-4 text-sm">
            <div className="mb-1 text-gray-100">{l.requirement}</div>
            <div className="mb-2 text-xs text-gray-400">{l.message}</div>
            <div className="text-xs text-gray-500">Source: {l.source}</div>

            {l.decision ? (
              <OperatorReviewForm
                projectId={projectId}
                decisionId={l.decision.id}
                drafterDecision={l.decision.decision}
                drafterRationale={l.decision.rationale}
                existingReview={
                  l.decision.operator_review
                    ? {
                        review: l.decision.operator_review,
                        rationale: l.decision.operator_review_rationale ?? '',
                        reviewed_at: l.decision.reviewed_at ?? '',
                      }
                    : null
                }
              />
            ) : (
              <div className="mt-3 text-xs text-gray-500 italic">
                Drafter has not recorded a decision on this item yet.
              </div>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
