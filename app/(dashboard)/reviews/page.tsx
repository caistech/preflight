import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

interface DecisionItem {
  id: string;
  check_result_id: string;
  check_run_id: string;
  project_id: string;
  decision: string;
  rationale: string;
  created_at: string;
  project_name: string;
  project_slug: string;
  requirement: string;
  outcome: string;
}

export default async function ReviewsPage() {
  // Auth (page is in (dashboard) — middleware enforces) plus service-role
  // for the cross-project read so we get everything in one query.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10 text-gray-400">Sign in to review drafter decisions.</div>
    );
  }
  const db = createServiceClient();

  const { data: decisions, error } = await db
    .from('check_result_decisions')
    .select('id, check_result_id, check_run_id, project_id, decision, rationale, created_at, projects(name, slug), check_results(outcome, register_rows(requirement))')
    .is('operator_review', null)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10 text-red-400">
        Could not load decisions: {error.message}
      </div>
    );
  }

  const items: DecisionItem[] = (decisions ?? []).map((d) => {
    const project = (d as { projects?: { name?: string; slug?: string } | Array<{ name?: string; slug?: string }> }).projects;
    const projectRow = Array.isArray(project) ? project[0] : project;
    const checkResults = (d as { check_results?: { outcome?: string; register_rows?: { requirement?: string } | Array<{ requirement?: string }> } | Array<{ outcome?: string; register_rows?: { requirement?: string } | Array<{ requirement?: string }> }> }).check_results;
    const cr = Array.isArray(checkResults) ? checkResults[0] : checkResults;
    const regRaw = cr?.register_rows;
    const reg = Array.isArray(regRaw) ? regRaw[0] : regRaw;
    return {
      id: d.id,
      check_result_id: d.check_result_id,
      check_run_id: d.check_run_id,
      project_id: d.project_id,
      decision: d.decision,
      rationale: d.rationale,
      created_at: d.created_at,
      project_name: projectRow?.name ?? 'unknown',
      project_slug: projectRow?.slug ?? d.project_id,
      requirement: reg?.requirement ?? '(unknown rule)',
      outcome: cr?.outcome ?? '',
    };
  });

  // Group by project for readability.
  const byProject = new Map<string, DecisionItem[]>();
  for (const item of items) {
    const key = `${item.project_slug}::${item.project_name}`;
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key)!.push(item);
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/projects" className="text-xs text-emerald-400 hover:underline">
        ← Projects
      </Link>
      <h1 className="mt-2 mb-2 text-3xl font-bold">Pending reviews</h1>
      <p className="mb-8 max-w-2xl text-sm text-gray-400">
        Drafter decisions across every project that have not yet been operator-reviewed.
        Each one is a per-item human signal you can confirm, overrule, promote into a
        rule, or annotate with context. Reviewed decisions disappear from this list and
        flow into the cross-project KB.
      </p>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-gray-800 bg-gray-900/30 p-10 text-center text-sm text-gray-400">
          No drafter decisions awaiting review. Either nothing&apos;s come in or you&apos;ve already
          worked through the queue.
        </div>
      ) : (
        <div className="space-y-6">
          {[...byProject.entries()].map(([key, group]) => {
            const [, projectName] = key.split('::');
            const projectSlug = group[0]?.project_slug ?? '';
            return (
              <section key={key} className="rounded-2xl border border-gray-800 bg-gray-900/30 p-5">
                <div className="mb-3 flex items-baseline justify-between">
                  <Link href={`/projects/${projectSlug}`} className="text-sm font-semibold text-gray-100 hover:text-emerald-400">
                    {projectName}
                  </Link>
                  <span className="text-xs text-gray-500">{group.length} pending</span>
                </div>
                <ul className="space-y-2">
                  {group.map((d) => (
                    <li key={d.id} className="rounded-lg border border-gray-800 bg-gray-950/60 p-3 text-xs">
                      <div className="mb-1 flex items-baseline justify-between">
                        <span className="font-mono text-gray-500">{d.decision}</span>
                        <span className="text-gray-500">
                          {new Date(d.created_at).toLocaleString('en-AU')}
                        </span>
                      </div>
                      <div className="mb-1 text-gray-200">{d.requirement}</div>
                      <div className="mb-2 italic text-gray-400">&ldquo;{d.rationale}&rdquo;</div>
                      <Link
                        href={`/projects/${projectSlug}/runs/${d.check_run_id}`}
                        className="text-emerald-400 hover:underline"
                      >
                        Review on triage page →
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
