import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/service';
import { hashDrafterToken } from '@/lib/drafter-token';
import { DrafterUpload } from './drafter-upload';
import { Disclaimer } from '@/components/disclaimer';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ token: string }>;
}

interface PriorRun {
  id: string;
  created_at: string;
  filename: string | null;
  hard_fails: number;
  needs_review: number;
  confirmed_ok: number;
  status: string;
}

export default async function DrafterPage({ params }: Props) {
  const { token } = await params;
  const db = createServiceClient();

  let projectName = '';
  let projectId = '';
  let projectCouncil: string | null = null;
  let projectOwnerLabel: string | null = null;
  let projectUploadInstructions: string | null = null;
  let projectAddress: string | null = null;
  let drafterName: string | null = null;
  let drafterTokenId: string | null = null;
  let priorRuns: PriorRun[] = [];
  let tokenInvalid = false;
  let tokenInvalidReason = '';

  try {
    const hash = hashDrafterToken(token);
    const { data: t } = await db
      .from('drafter_tokens')
      .select('id, project_id, drafter_name, expires_at, revoked_at, projects(name, council, owner_label, upload_instructions)')
      .eq('token_hash', hash)
      .single();

    if (!t) {
      tokenInvalid = true;
      tokenInvalidReason = 'This link is not recognised. It may have been rotated or never issued.';
    } else if (t.revoked_at) {
      tokenInvalid = true;
      tokenInvalidReason = 'This link has been revoked by the project owner.';
    } else if (new Date(t.expires_at) < new Date()) {
      tokenInvalid = true;
      tokenInvalidReason = 'This link has expired. Ask the project owner for a fresh link.';
    } else {
      projectId = t.project_id;
      drafterName = t.drafter_name;
      drafterTokenId = t.id;
      const p = (t.projects ?? {}) as {
        name?: string;
        council?: string | null;
        owner_label?: string | null;
        upload_instructions?: string | null;
      };
      projectName = p.name ?? '';
      projectCouncil = p.council ?? null;
      projectOwnerLabel = p.owner_label ?? null;
      projectUploadInstructions = p.upload_instructions ?? null;

      const { data: addrFact } = await db
        .from('project_facts')
        .select('value')
        .eq('project_id', projectId)
        .eq('key', 'address_summary')
        .single();
      projectAddress = addrFact?.value ?? null;

      // Prior runs scoped to THIS drafter token (so different drafters on the
      // same project don't see each other's uploads).
      const { data: runs } = await db
        .from('check_runs')
        .select('id, status, hard_fails, needs_review, confirmed_ok, created_at, drawing_set_id, drawing_sets(filename)')
        .eq('drafter_token_id', drafterTokenId)
        .order('created_at', { ascending: false })
        .limit(20);
      priorRuns = (runs ?? []).map((r) => {
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
    }
  } catch (e) {
    tokenInvalid = true;
    tokenInvalidReason = `Could not validate link: ${(e as Error).message}`;
  }

  if (tokenInvalid) {
    return (
      <main className="min-h-screen bg-gray-950 text-white">
        <div className="mx-auto max-w-md px-6 py-16">
          <div className="mb-2 text-sm text-emerald-400">Preflight</div>
          <h1 className="mb-2 text-3xl font-bold">Link not valid</h1>
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200">
            {tokenInvalidReason}
          </div>
        </div>
      </main>
    );
  }

  const uploadGuidance =
    projectUploadInstructions ?? 'Upload your latest revision of the drawing set as a PDF.';

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-2 text-sm text-emerald-400">Preflight</div>
        <h1 className="mb-2 text-3xl font-bold">
          Pre-submission check{drafterName ? ` — ${drafterName}` : ''}
        </h1>

        {/* Explanatory header per the UI EXPLANATORY HEADER rule */}
        <p className="mb-6 max-w-2xl text-sm text-gray-400">
          Drop your latest <strong className="text-gray-200">{projectName}</strong> drawing set in
          and you&apos;ll get back a one-page sheet listing anything that matches a known
          recurring issue on this project — before the set goes to Council.
          No account, no portal; the result is yours to act on.
        </p>

        {/* Project details panel */}
        <section className="mb-6 rounded-2xl border border-gray-800 bg-gray-900/30 p-5">
          <div className="mb-3 text-xs uppercase tracking-wide text-gray-500">Project details</div>
          <dl className="grid grid-cols-1 gap-y-1 text-sm sm:grid-cols-[140px,1fr]">
            <dt className="text-gray-500">Project</dt>
            <dd className="text-gray-200">{projectName}</dd>
            {projectAddress && (<>
              <dt className="text-gray-500">Address</dt>
              <dd className="text-gray-200">{projectAddress}</dd>
            </>)}
            {projectCouncil && (<>
              <dt className="text-gray-500">Council</dt>
              <dd className="text-gray-200">{projectCouncil}</dd>
            </>)}
            {projectOwnerLabel && (<>
              <dt className="text-gray-500">Project owner</dt>
              <dd className="text-gray-200">{projectOwnerLabel}</dd>
            </>)}
          </dl>
        </section>

        {/* What to upload */}
        <section className="mb-6 rounded-2xl border border-gray-800 bg-gray-900/30 p-5">
          <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">What to upload</div>
          <p className="text-sm text-gray-300">{uploadGuidance}</p>
        </section>

        {/* Prior runs — only shown when there is history */}
        {priorRuns.length > 0 && (
          <section className="mb-6 rounded-2xl border border-gray-800 bg-gray-900/30 p-5">
            <div className="mb-3 flex items-baseline justify-between">
              <div className="text-xs uppercase tracking-wide text-gray-500">Your prior runs</div>
              <div className="text-xs text-gray-500">{priorRuns.length} {priorRuns.length === 1 ? 'run' : 'runs'}</div>
            </div>
            <ul className="divide-y divide-gray-800">
              {priorRuns.map((r) => (
                <li key={r.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm text-gray-200">{r.filename ?? '(unnamed upload)'}</div>
                    <div className="text-xs text-gray-500">{new Date(r.created_at).toLocaleString('en-AU')}</div>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-red-400">🔴 {r.hard_fails}</span>
                    <span className="text-amber-400">🟡 {r.needs_review}</span>
                    <span className="text-emerald-400">✅ {r.confirmed_ok}</span>
                    <Link
                      href={`/drafter/${token}/runs/${r.id}`}
                      className="ml-2 rounded-md border border-gray-700 px-2 py-1 text-gray-300 hover:border-emerald-500 hover:text-emerald-400"
                    >
                      View result
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Upload widget */}
        <section>
          <div className="mb-3 text-xs uppercase tracking-wide text-gray-500">
            {priorRuns.length > 0 ? 'Upload a new revision' : 'Upload the drawing set'}
          </div>
          <DrafterUpload token={token} projectId={projectId} />
        </section>

        {/* How it works */}
        <section className="mt-10 rounded-2xl border border-gray-800 bg-gray-900/30 p-5 text-sm text-gray-300">
          <div className="mb-3 text-xs uppercase tracking-wide text-gray-500">How it works</div>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              <strong>Deterministic checks</strong> fire on text-based rules — e.g.{' '}
              <em className="text-gray-400">
                &quot;if the legend lists sub-floor vents but the project uses
                slab-on-biscuit footings, flag it.&quot;
              </em>{' '}
              Clean pass or fail with a sheet reference.
            </li>
            <li>
              <strong>Manual-check rules</strong> use an LLM to scan the relevant
              excerpts and answer narrow yes/no/unsure questions. The LLM is
              allowed (and expected) to answer{' '}
              <span className="text-amber-400">unsure</span>. It never invents
              specifics like street names, dimensions, or citations — those
              always come back for human judgment.
            </li>
          </ol>
        </section>

        {/* What you'll get */}
        <section className="mt-6 rounded-2xl border border-gray-800 bg-gray-900/30 p-5 text-sm text-gray-300">
          <div className="mb-3 text-xs uppercase tracking-wide text-gray-500">What you&apos;ll get</div>
          <ul className="space-y-2">
            <li>
              <span className="text-red-400">🔴 Hard fails</span> — issues that
              will trigger a Council query. Fix before submission. Sheet reference
              is included.
            </li>
            <li>
              <span className="text-amber-400">🟡 Needs eyes</span> — the LLM was
              unsure, or it&apos;s a judgment call. Read these and decide; don&apos;t
              just trust the tool.
            </li>
            <li>
              <span className="text-emerald-400">✅ Confirmed OK</span> — short
              list of things the tool can positively confirm. Builds trust in the
              rest of the result.
            </li>
          </ul>
        </section>

        {/* What to do with it */}
        <section className="mt-6 rounded-2xl border border-gray-800 bg-gray-900/30 p-5 text-sm text-gray-300">
          <div className="mb-3 text-xs uppercase tracking-wide text-gray-500">What to do with the results</div>
          <ul className="list-disc space-y-2 pl-5">
            <li>Fix the hard fails before sending the set on.</li>
            <li>For <em className="text-amber-400">needs eyes</em>, use your own judgment — the tool&apos;s prompting you, not gating you.</li>
            <li>
              Nothing is shared with {projectOwnerLabel ?? 'the project owner'} unless
              <strong className="text-gray-200"> you</strong> choose to share the result. The output is yours.
            </li>
            <li>
              If a row flags something you know is fine, or the tool missed
              something it should have caught — flag it back to the project owner.
              Those gaps are how the register gets smarter for next time.
            </li>
          </ul>
        </section>

        {/* Honest limits — kept at the bottom */}
        <div className="mt-10 rounded-2xl border border-gray-800 bg-gray-900/30 p-4 text-xs text-gray-500">
          <div className="mb-1 font-semibold text-gray-400">Honest limits</div>
          Preflight catches <strong>known</strong> error types only — every recurring rejection the
          project has logged. A novel error passes straight through. It is a
          regression check, not a substitute for human review. Items marked{' '}
          <span className="text-amber-400">needs eyes</span> are prompts for a human (you), not findings.
        </div>

        <Disclaimer />
      </div>
    </main>
  );
}
