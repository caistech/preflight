// GET /api/v1/projects/:id/check-runs/latest — the most recent check THIS key started on the project.
//
// "How did the Lot 91 check go?" names a project, not a run id, so this is the read that answers it.
// Scoped to the caller's own runs: a drafter's upload is the drafter's to share, never Kira's to
// read back to the owner unasked (the drafter-chooses-what-to-share rule in CLAUDE.md).

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { describeRun, fail, projectForKey, RUN_COLUMNS, type RunRow } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const db = createServiceClient();
  const gate = await projectForKey(db, request, params.id);
  if ('response' in gate) return gate.response;

  const { data, error } = await db
    .from('check_runs')
    .select(RUN_COLUMNS)
    .eq('project_id', gate.projectId)
    .eq('api_key_id', gate.key.id)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return fail(503, "Couldn't read the last check just now");
  if (!data) {
    return NextResponse.json({
      ok: true,
      run: null,
      message: `No check has been run on ${gate.projectName} from here yet.`,
    });
  }

  const run = describeRun(data as RunRow, gate.projectName);
  return NextResponse.json({ ok: true, run, message: run.message });
}
