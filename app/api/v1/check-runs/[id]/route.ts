// GET /api/v1/check-runs/:id — a run's state, and once it has finished, its result.
//
// `running` means not finished: the caller says so and asks again. A `failed` run
// says why, and is never reported as a clean result.

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authenticateApiKey, keyReachesProject } from '@/lib/api-key';
import { describeRun, fail, RUN_COLUMNS, type RunRow } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const db = createServiceClient();
  const auth = await authenticateApiKey(db, request);
  if ('error' in auth) return fail(auth.status, auth.error);
  if (!UUID.test(params.id)) return fail(404, 'No such check run for this key');

  const { data, error } = await db.from('check_runs').select(RUN_COLUMNS).eq('id', params.id).maybeSingle();
  if (error) return fail(503, "Couldn't read that check run just now");
  const run = data as RunRow | null;
  if (!run || !keyReachesProject(auth.key, run.project_id)) return fail(404, 'No such check run for this key');

  const { data: project } = await db.from('projects').select('name').eq('id', run.project_id).maybeSingle();
  const described = describeRun(run, (project?.name as string | undefined) ?? 'project');
  return NextResponse.json({ ok: true, run: described, message: described.message });
}
