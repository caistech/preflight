import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  owner_label: string | null;
  drafter_label: string | null;
  council: string | null;
  description: string | null;
}

export default async function ProjectsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // User-scoped read — RLS via current_user_project_ids() restricts the
  // list to projects the signed-in user has a project_memberships row for.
  // The membership backfill (migration 0021) granted every existing user
  // 'owner' on every project as the single-operator MVP baseline.
  const { data } = await supabase
    .from('projects')
    .select('id, slug, name, owner_label, drafter_label, council, description')
    .order('created_at', { ascending: false });

  // Pending-reviews count for the inline CTA. Service client because the
  // count is a global queue signal and the per-row RLS would over-restrict.
  const adminDb = createServiceClient();
  const { count: pendingReviewCount } = await adminDb
    .from('check_result_decisions')
    .select('id', { count: 'exact', head: true })
    .is('operator_review', null);

  const projects = (data ?? []) as ProjectRow[];
  const reviewCount = pendingReviewCount ?? 0;
  void user;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">Projects</div>
      <h1 className="mb-2 text-3xl font-bold">Your projects</h1>
      <p className="mb-4 max-w-2xl text-sm text-gray-400">
        Each project carries its own requirements register and its own
        accumulated correspondence. Drafters receive a per-project shareable
        link from each project&apos;s page — they don&apos;t need an account
        here.
      </p>

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <Link
          href="/projects/new"
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-gray-950 hover:bg-emerald-400"
        >
          + New project
        </Link>
        <Link
          href="/reviews"
          className="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 hover:border-amber-500 hover:bg-amber-500/20"
        >
          <span>Pending decision reviews</span>
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-mono text-amber-200">
            {reviewCount}
          </span>
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-2xl border border-gray-800 bg-gray-900/30 p-10 text-center text-gray-400">
          No projects seeded yet. Run the seed script or insert a row in
          <code className="mx-1 rounded bg-gray-800 px-1 text-emerald-300">projects</code>
          to get started.
        </div>
      ) : (
        <div className="space-y-4">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="block rounded-2xl border border-gray-800 bg-gray-900/50 p-6 transition-colors hover:border-gray-700"
            >
              <div className="mb-1 flex items-center gap-3">
                <span className="text-xs font-mono text-gray-500">{p.slug}</span>
                {p.council && <span className="text-xs text-gray-500">· {p.council}</span>}
              </div>
              <div className="mb-2 text-xl font-semibold">{p.name}</div>
              <div className="text-sm text-gray-400">
                {p.owner_label && <span>Owner: {p.owner_label}</span>}
                {p.owner_label && p.drafter_label && <span className="mx-2">·</span>}
                {p.drafter_label && <span>Drafter: {p.drafter_label}</span>}
              </div>
              {p.description && (
                <div className="mt-2 text-sm text-gray-300">{p.description}</div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
