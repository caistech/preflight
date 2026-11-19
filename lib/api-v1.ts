/**
 * Shared plumbing for /api/v1 — the machine API (Kira, through the orchestrator).
 *
 * Every route here authenticates by API key (lib/api-key.ts), never by session,
 * and every answer is JSON with `ok`. A refusal carries a sentence a person could
 * be read, because that is exactly what the caller does with it.
 */

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authenticateApiKey, keyReachesProject, type ApiKeyRow } from '@/lib/api-key';
import { resolveProjectId } from '@/lib/project-resolver';

export function fail(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

export interface RunRow {
  id: string;
  project_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  hard_fails: number | null;
  needs_review: number | null;
  confirmed_ok: number | null;
  triage_payload: unknown;
  error: string | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The run as the caller should say it. Counts first, because that is the question; every
 * "unsure" is counted with the needs-eyes rows and never folded into "OK" — a check that could
 * not decide has not passed.
 */
export function describeRun(run: RunRow, projectName: string, now: Date = new Date()) {
  const status = run.status === 'complete' ? 'completed' : run.status;
  const payload = (run.triage_payload ?? null) as {
    files?: Array<{ name: string; extraction_method?: string }>;
    unreadable_files?: string[];
  } | null;
  const files = payload?.files?.map((f) => f.name) ?? [];
  const on = files.length ? ` on ${files.join(', ')}` : '';
  let message: string;
  if (status === 'running') {
    const minutes = Math.max(0, Math.round((now.getTime() - new Date(run.started_at).getTime()) / 60000));
    message = `The ${projectName} check is still running (started ${minutes === 0 ? 'just now' : `${plural(minutes, 'minute', 'minutes')} ago`}). Ask again shortly.`;
  } else if (status === 'failed') {
    message = `The last ${projectName} check did not finish: ${run.error ?? 'no reason recorded'}. Nothing was checked.`;
  } else {
    message =
      `The ${projectName} check${on} finished: ${plural(run.hard_fails ?? 0, 'hard fail', 'hard fails')}, ` +
      `${plural(run.needs_review ?? 0, 'item that needs eyes', 'items that need eyes')}, ` +
      `${run.confirmed_ok ?? 0} confirmed OK.`;
    // How much of the set was actually looked at belongs in the same sentence as the counts:
    // "0 hard fails" over a set with unread sheets is not a clean result.
    const drawn = payload?.files?.filter((f) => f.extraction_method === 'vision').length ?? 0;
    if (drawn > 0) {
      message += ` ${drawn === files.length ? (drawn === 1 ? 'The sheet was' : `All ${drawn} sheets were`) : `${drawn} of the ${files.length} sheets were`} read from the drawing image, so check anything it flags against the sheet itself.`;
    }
    const unreadable = payload?.unreadable_files ?? [];
    if (unreadable.length > 0) {
      message += ` Nothing could be read from ${unreadable.join(', ')}, so ${unreadable.length === 1 ? 'that sheet was' : 'those sheets were'} not checked.`;
    }
  }
  return {
    id: run.id,
    projectId: run.project_id,
    status,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    counts:
      status === 'completed'
        ? { hardFails: run.hard_fails ?? 0, needsReview: run.needs_review ?? 0, confirmedOk: run.confirmed_ok ?? 0 }
        : null,
    result: status === 'completed' ? run.triage_payload : null,
    error: status === 'failed' ? run.error ?? 'The check did not finish.' : null,
    message,
  };
}

export const RUN_COLUMNS =
  'id, project_id, status, started_at, completed_at, hard_fails, needs_review, confirmed_ok, triage_payload, error';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Which of `projects` the words name — the way an owner says it ("Lot 91", "the Lot 91 carport
 * drawings"), not the slug. A project is named when the words contain the opening words of its name
 * up to and including its first number ("Lot 91" of "Lot 91 Wavecrest"), or its whole name. Exactly
 * one match, or none: two is a question for the caller, never a guess.
 *
 * Pure, for testing.
 */
export function projectsNamedBy<T extends { name: string }>(words: string, projects: T[]): T[] {
  const said = ` ${norm(words)} `;
  return projects.filter((p) => {
    const tokens = norm(p.name).split(' ').filter(Boolean);
    if (tokens.length === 0) return false;
    const numberAt = tokens.findIndex((t) => /\d/.test(t));
    const handle = numberAt >= 0 ? tokens.slice(0, numberAt + 1) : tokens;
    return said.includes(` ${handle.join(' ')} `) || said.includes(` ${tokens.join(' ')} `);
  });
}

/**
 * Authenticate, then resolve `ref` — a uuid, a slug, or the project's name in words — to a project
 * this key may touch.
 */
export async function projectForKey(
  db: SupabaseClient,
  request: Request,
  ref: string,
): Promise<{ ok: true; key: ApiKeyRow; projectId: string; projectName: string } | { ok: false; response: NextResponse }> {
  const auth = await authenticateApiKey(db, request);
  if ('error' in auth) return { ok: false, response: fail(auth.status, auth.error) };

  const decoded = decodeURIComponent(ref);
  let projectId = await resolveProjectId(db, decoded);

  if (!projectId && auth.key.project_ids.length > 0) {
    const { data, error } = await db.from('projects').select('id, name').in('id', auth.key.project_ids);
    if (error) return { ok: false, response: fail(503, "Couldn't read the projects just now") };
    const named = projectsNamedBy(decoded, (data ?? []) as Array<{ id: string; name: string }>);
    if (named.length > 1) {
      return {
        ok: false,
        response: fail(409, `That could be more than one project: ${named.map((p) => p.name).join('; ')}. Which one?`, {
          candidates: named.map((p) => p.name),
        }),
      };
    }
    projectId = named[0]?.id ?? null;
  }

  // Not found and not permitted read the same to the caller: a key must not be
  // able to discover which projects exist outside its own list.
  if (!projectId || !keyReachesProject(auth.key, projectId)) {
    return { ok: false, response: fail(404, `No project called "${decoded}" is set up for checks here.`) };
  }
  const { data: project } = await db.from('projects').select('name').eq('id', projectId).maybeSingle();
  return { ok: true, key: auth.key, projectId, projectName: (project?.name as string | undefined) ?? decoded };
}
