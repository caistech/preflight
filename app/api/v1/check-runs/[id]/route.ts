// GET /api/v1/check-runs/:id — a run's state, and once it has finished, its result.
//
// `running` means not finished: the caller says so and asks again. A `failed` run
// says why, and is never reported as a clean result.

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authenticateApiKey, keyReachesProject } from '@/lib/api-key';
import { fail } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const db = createServiceClient();
  const auth = await authenticateApiKey(db, request);
  if ('error' in auth) return fail(auth.status, auth.error);
  if (!UUID.test(params.id)) return fail(404, 'No such check run for this key');

  const { data: run, error } = await db
    .from('check_runs')
    .select('id, project_id, status, started_at, completed_at, hard_fails, needs_review, confirmed_ok, triage_payload, error')
    .eq('id', params.id)
    .maybeSingle();
  if (error) return fail(503, "Couldn't read that check run just now");
  if (!run || !keyReachesProject(auth.key, run.project_id)) return fail(404, 'No such check run for this key');

  const status = run.status === 'complete' ? 'completed' : run.status;
  return NextResponse.json({
    ok: true,
    run: {
      id: run.id,
      projectId: run.project_id,
      status,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      counts: status === 'completed'
        ? { hardFails: run.hard_fails, needsReview: run.needs_review, confirmedOk: run.confirmed_ok }
        : null,
      result: status === 'completed' ? run.triage_payload : null,
      error: status === 'failed' ? run.error ?? 'The check did not finish.' : null,
    },
  });
}
