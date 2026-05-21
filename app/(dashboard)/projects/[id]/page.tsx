import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/service';
import { resolveProjectId } from '@/lib/project-resolver';
import { DrafterLinkPanel } from './drafter-link-panel';
import { SourcesPanel } from './sources-panel';
import { FactCandidatesPanel } from './fact-candidates-panel';
import { KbScopePanel } from './kb-scope-panel';
import { UnitsPanel } from './units-panel';
import { RuleCandidatesPanel } from './rule-candidates-panel';
import { AddressEditor } from './address-editor';
import { AddRuleForm } from './add-rule-form';
import { Disclaimer } from '@/components/disclaimer';

export const dynamic = 'force-dynamic';

interface ProjectFact {
  key: string;
  value: string;
  source: string | null;
  notes: string | null;
}

interface RegisterRow {
  id: string;
  requirement: string;
  source: string;
  source_url: string | null;
  check_type: string;
  severity: string;
  active: boolean;
}

interface DrafterToken {
  id: string;
  drafter_name: string | null;
  expires_at: string;
  revoked_at: string | null;
  uses: number;
  last_used_at: string | null;
  created_at: string;
}

interface CheckRun {
  id: string;
  status: string;
  hard_fails: number;
  needs_review: number;
  confirmed_ok: number;
  created_at: string;
  drawing_set_id: string;
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idOrSlug } = await params;
  const db = createServiceClient();
  const resolved = await resolveProjectId(db, idOrSlug);
  if (!resolved) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10 text-gray-400">Project not found.</div>
    );
  }
  const id = resolved;

  const [
    { data: project },
    { data: facts },
    { data: register },
    { data: tokens },
    { data: runs },
    { data: kbDocs },
    { data: driveConn },
    { data: inbound },
  ] = await Promise.all([
    db.from('projects').select('*').eq('id', id).single(),
    db.from('project_facts').select('key, value, source, notes').eq('project_id', id).order('key'),
    db
      .from('register_rows')
      .select('id, requirement, source, source_url, check_type, severity, active')
      .eq('project_id', id)
      .order('severity', { ascending: false })
      .order('created_at', { ascending: true }),
    db
      .from('drafter_tokens')
      .select('id, drafter_name, expires_at, revoked_at, uses, last_used_at, created_at')
      .eq('project_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
    db
      .from('check_runs')
      .select('id, status, hard_fails, needs_review, confirmed_ok, created_at, drawing_set_id')
      .eq('project_id', id)
      .order('created_at', { ascending: false })
      .limit(10),
    db
      .from('kb_documents')
      .select('id, title, source_kind, source_ref, created_at')
      .eq('project_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    db
      .from('drive_connections')
      .select('id, email, folder_id, paused, last_sync_at')
      .eq('project_id', id)
      .maybeSingle(),
    db
      .from('inbound_emails')
      .select('id, from_address, subject, parsed, kb_document_id, created_at')
      .eq('project_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  if (!project) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10 text-gray-400">Project not found.</div>
    );
  }

  const factRows = (facts ?? []) as ProjectFact[];
  const registerRows = (register ?? []) as RegisterRow[];
  const drafterTokens = (tokens ?? []) as DrafterToken[];
  const recentRuns = (runs ?? []) as CheckRun[];
  const existingKbDocs = (kbDocs ?? []) as Array<{
    id: string;
    title: string;
    source_kind: string;
    source_ref: string | null;
    created_at: string;
  }>;
  const drive = {
    connected: !!driveConn,
    email: driveConn?.email ?? null,
    folder_id: driveConn?.folder_id ?? null,
    last_sync_at: driveConn?.last_sync_at ?? null,
    paused: driveConn?.paused ?? false,
  };
  const inboundDomain = process.env.RESEND_INBOUND_DOMAIN || 'nexeukro.resend.app';
  const inboundEmailAlias = `${project.slug}@${inboundDomain}`;
  const recentInbound = (inbound ?? []) as Array<{
    id: string;
    from_address: string | null;
    subject: string | null;
    parsed: boolean;
    kb_document_id: string | null;
    created_at: string;
  }>;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">
        Project · {project.slug}
      </div>
      <h1 className="mb-2 text-3xl font-bold">{project.name}</h1>
      <p className="mb-8 max-w-2xl text-sm text-gray-400">
        Drafter-led pre-submission triage for this project. Every recurring
        rejection becomes a register row; every drawing set the drafter
        uploads runs against the register before it leaves their desk.
      </p>

      {/* Drafter link */}
      <DrafterLinkPanel projectId={id} projectSlug={project.slug} existingTokens={drafterTokens} />

      {/* Recent check runs */}
      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold">Recent check runs</h2>
        {recentRuns.length === 0 ? (
          <div className="rounded-2xl border border-gray-800 bg-gray-900/30 p-6 text-sm text-gray-400">
            No drawing sets uploaded yet for this project.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-900/60 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Hard fails</th>
                  <th className="px-4 py-3">Needs review</th>
                  <th className="px-4 py-3">Confirmed OK</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {recentRuns.map((r) => (
                  <tr key={r.id} className="text-gray-300">
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">{r.status}</td>
                    <td className="px-4 py-3 text-red-400">{r.hard_fails}</td>
                    <td className="px-4 py-3 text-amber-400">{r.needs_review}</td>
                    <td className="px-4 py-3 text-emerald-400">{r.confirmed_ok}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/projects/${idOrSlug}/runs/${r.id}`}
                        className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:border-emerald-500 hover:text-emerald-400"
                      >
                        Review →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Project address — uses Mapbox autocomplete */}
      <section className="mt-10 rounded-2xl border border-gray-800 bg-gray-900/30 p-5">
        <AddressEditor
          projectId={id}
          initialAddress={factRows.find((f) => f.key === 'address_summary')?.value ?? null}
        />
      </section>

      {/* Project facts */}
      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold">Project facts</h2>
        {factRows.length === 0 ? (
          <div className="rounded-2xl border border-gray-800 bg-gray-900/30 p-6 text-sm text-gray-400">
            No project facts yet. Facts gate rule evaluation (e.g.{' '}
            <code className="rounded bg-gray-800 px-1 text-emerald-300">footing_system = slab-on-biscuit</code>).
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-900/60 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Key</th>
                  <th className="px-4 py-3">Value</th>
                  <th className="px-4 py-3">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {factRows.map((f) => (
                  <tr key={f.key} className="text-gray-300">
                    <td className="px-4 py-3 font-mono text-xs">{f.key}</td>
                    <td className="px-4 py-3">{f.value}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{f.source ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Sources — background context for manual-check rules */}
      <SourcesPanel
        projectId={id}
        inboundEmailAlias={inboundEmailAlias}
        drive={drive}
        existingDocs={existingKbDocs}
        recentInbound={recentInbound}
      />

      {/* LLM-proposed facts pending operator approval — loaded client-side
          so the page renders without blocking on the candidate list */}
      <div className="mt-6">
        <FactCandidatesPanel projectId={id} />
      </div>

      {/* LLM-proposed KB scope upgrades pending operator approval. */}
      <div className="mt-6">
        <KbScopePanel projectId={id} />
      </div>

      {/* Per-unit specs — typed table the unit-numbering rule can query. */}
      <div className="mt-6">
        <UnitsPanel projectId={id} />
      </div>

      {/* LLM-proposed register rows from cross-project promote_to_rule decisions. */}
      <div className="mt-6">
        <RuleCandidatesPanel projectId={id} />
      </div>

      {/* Requirements register */}
      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold">Requirements register</h2>
        <AddRuleForm projectId={id} kbDocs={existingKbDocs} />
        {registerRows.length === 0 ? (
          <div className="rounded-2xl border border-gray-800 bg-gray-900/30 p-6 text-sm text-gray-400">
            No register rows yet.
          </div>
        ) : (
          <div className="space-y-3">
            {registerRows.map((r) => (
              <div
                key={r.id}
                className={`rounded-2xl border bg-gray-900/40 p-5 ${
                  r.active ? 'border-gray-800' : 'border-gray-900 opacity-50'
                }`}
              >
                <div className="mb-2 flex items-center gap-2 text-xs">
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ${
                      r.severity === 'hard-fail'
                        ? 'bg-red-500/20 text-red-300'
                        : r.severity === 'review'
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-gray-500/20 text-gray-300'
                    }`}
                  >
                    {r.severity}
                  </span>
                  <span className="rounded-full bg-gray-800 px-2 py-0.5 font-mono text-gray-300">
                    {r.check_type}
                  </span>
                  {!r.active && <span className="text-gray-500">inactive</span>}
                </div>
                <div className="mb-1 text-sm text-gray-100">{r.requirement}</div>
                <div className="text-xs text-gray-500">
                  Source: {r.source}
                  {r.source_url && (
                    <a href={r.source_url} className="ml-2 text-emerald-400 hover:underline">
                      open
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <Disclaimer />
    </div>
  );
}
