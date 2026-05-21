import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/service';
import { createClient } from '@/lib/supabase/server';
import { resolveProjectId } from '@/lib/project-resolver';

export const dynamic = 'force-dynamic';

interface PriorRun {
  id: string;
  created_at: string;
  filename: string | null;
  hard_fails: number;
  needs_review: number;
  confirmed_ok: number;
  status: string;
}

/**
 * Operator preview of the drafter view.
 *
 * Drafter tokens are HMAC-hashed at issue time (raw never stored) so the
 * operator can't open the actual /drafter/<raw-token> URL. This page is a
 * read-only mirror — same project facts, same prior-runs list for this
 * specific drafter token, same triage links — but reached via operator
 * auth and tokenId rather than the raw token. No upload form (operator
 * shouldn't impersonate uploads).
 */
export default async function DrafterPreviewPage({
  params,
}: {
  params: Promise<{ id: string; tokenId: string }>;
}) {
  const { id: idOrSlug, tokenId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const db = createServiceClient();
  const projectId = await resolveProjectId(db, idOrSlug);
  if (!projectId) redirect('/projects');

  const { data: token } = await db
    .from('drafter_tokens')
    .select('id, project_id, drafter_name, expires_at, revoked_at, uses, last_used_at, created_at')
    .eq('id', tokenId)
    .eq('project_id', projectId)
    .single();
  if (!token) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12 text-white">
        <Link href={`/projects/${idOrSlug}`} className="text-xs text-emerald-400 hover:underline">
          ← Back to project
        </Link>
        <h1 className="mt-4 text-2xl font-bold">Token not found on this project</h1>
      </main>
    );
  }

  const [{ data: project }, { data: addrFact }, { data: runs }] = await Promise.all([
    db.from('projects').select('name, council, owner_label, upload_instructions, slug').eq('id', projectId).single(),
    db.from('project_facts').select('value').eq('project_id', projectId).eq('key', 'address_summary').maybeSingle(),
    db
      .from('check_runs')
      .select('id, status, hard_fails, needs_review, confirmed_ok, created_at, drawing_set_id, drawing_sets(filename)')
      .eq('drafter_token_id', token.id)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  if (!project) redirect('/projects');

  const priorRuns: PriorRun[] = (runs ?? []).map((r) => {
    const ds = (r as { drawing_sets?: { filename?: string | null } }).drawing_sets;
    return {
      id: r.id,
      created_at: r.created_at,
      filename: ds?.filename ?? null,
      hard_fails: r.hard_fails ?? 0,
      needs_review: r.needs_review ?? 0,
      confirmed_ok: r.confirmed_ok ?? 0,
      status: r.status,
    };
  });

  const expired = new Date(token.expires_at) < new Date();
  const isActive = !token.revoked_at && !expired;

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link href={`/projects/${idOrSlug}`} className="text-xs text-emerald-400 hover:underline">
          ← Back to {project.name}
        </Link>

        <div className="mt-4 mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
          <div className="mb-1 font-semibold">Operator preview</div>
          This is a read-only mirror of what the drafter ({token.drafter_name ?? 'unnamed'})
          sees on their token. You&apos;re viewing it because you&apos;re signed in as an
          operator — drafter tokens are HMAC-hashed at issue time, so the raw URL the
          drafter has isn&apos;t reconstructable from this side. Use this for sanity-checking
          their experience and for clicking through into specific runs.
        </div>

        <div className="mb-2 text-sm text-emerald-400">Preflight · drafter view</div>
        <h1 className="mb-2 text-3xl font-bold">
          Pre-submission check{token.drafter_name ? ` — ${token.drafter_name}` : ''}
        </h1>
        <p className="mb-3 max-w-2xl text-sm text-gray-400">
          (Drafter would see the upload widget here. Suppressed in preview.)
        </p>
        <form
          action={`/api/projects/${idOrSlug}/drafter-tokens/${token.id}/impersonate`}
          method="post"
          target="_blank"
          rel="noreferrer"
          className="mb-6"
        >
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300 hover:border-emerald-500 hover:bg-emerald-500/20"
          >
            Enter as drafter ↗
            <span className="text-emerald-300/60">(10-min token, audit-logged)</span>
          </button>
        </form>

        <section className="mb-6 rounded-2xl border border-gray-800 bg-gray-900/30 p-5">
          <div className="mb-3 text-xs uppercase tracking-wide text-gray-500">Project details</div>
          <dl className="grid grid-cols-1 gap-y-1 text-sm sm:grid-cols-[140px,1fr]">
            <dt className="text-gray-500">Project</dt>
            <dd className="text-gray-200">{project.name}</dd>
            {addrFact?.value && (
              <>
                <dt className="text-gray-500">Address</dt>
                <dd className="text-gray-200">{addrFact.value}</dd>
              </>
            )}
            {project.council && (
              <>
                <dt className="text-gray-500">Council</dt>
                <dd className="text-gray-200">{project.council}</dd>
              </>
            )}
            {project.owner_label && (
              <>
                <dt className="text-gray-500">Project owner</dt>
                <dd className="text-gray-200">{project.owner_label}</dd>
              </>
            )}
          </dl>
        </section>

        <section className="mb-6 rounded-2xl border border-gray-800 bg-gray-900/30 p-5 text-xs">
          <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">Token status</div>
          <div className="grid grid-cols-2 gap-y-1 text-gray-300 sm:grid-cols-[140px,1fr]">
            <span className="text-gray-500">Status</span>
            <span>
              {token.revoked_at ? <span className="text-red-400">revoked</span> : expired ? <span className="text-gray-500">expired</span> : <span className="text-emerald-400">active</span>}
            </span>
            <span className="text-gray-500">Expires</span>
            <span>{new Date(token.expires_at).toLocaleString('en-AU')}</span>
            <span className="text-gray-500">Uses</span>
            <span>{token.uses}</span>
            <span className="text-gray-500">Last used</span>
            <span>{token.last_used_at ? new Date(token.last_used_at).toLocaleString('en-AU') : '—'}</span>
            <span className="text-gray-500">Created</span>
            <span>{new Date(token.created_at).toLocaleString('en-AU')}</span>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-800 bg-gray-900/30 p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <div className="text-xs uppercase tracking-wide text-gray-500">Drafter&apos;s prior runs</div>
            <div className="text-xs text-gray-500">
              {priorRuns.length} {priorRuns.length === 1 ? 'run' : 'runs'}
            </div>
          </div>
          {priorRuns.length === 0 ? (
            <div className="text-sm text-gray-500">No runs yet for this drafter token.</div>
          ) : (
            <ul className="divide-y divide-gray-800">
              {priorRuns.map((r) => (
                <li key={r.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm text-gray-200">{r.filename ?? '(unnamed upload)'}</div>
                    <div className="text-xs text-gray-500">
                      {new Date(r.created_at).toLocaleString('en-AU')} · {r.status}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-red-400">🔴 {r.hard_fails}</span>
                    <span className="text-amber-400">🟡 {r.needs_review}</span>
                    <span className="text-emerald-400">✅ {r.confirmed_ok}</span>
                    <Link
                      href={`/projects/${idOrSlug}/runs/${r.id}`}
                      className="rounded-md border border-gray-700 px-2 py-1 text-gray-300 hover:border-emerald-500 hover:text-emerald-400"
                    >
                      Operator review →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {!isActive && (
          <div className="mt-6 rounded-lg border border-gray-800 bg-gray-900/30 p-3 text-xs text-gray-500">
            This token is no longer accepting new uploads (revoked or expired). The drafter
            sees a &ldquo;Link not valid&rdquo; page if they try to use it.
          </div>
        )}
      </div>
    </main>
  );
}
