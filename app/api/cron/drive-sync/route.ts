import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { verifyCronSecret } from '@/lib/supabase/auth';
import { syncDriveForProject } from '@/lib/drive/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createServiceClient();
  const url = new URL(request.url);
  const projectFilter = url.searchParams.get('project');

  // Optional ?project=<slug> or ?project=<uuid> to sync just one project.
  // Useful for diagnostics when the bulk enumerate has trouble.
  let connections: Array<{ project_id: string }> = [];
  if (projectFilter) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectFilter);
    const lookup = isUuid
      ? await db.from('projects').select('id').eq('id', projectFilter).maybeSingle()
      : await db.from('projects').select('id').eq('slug', projectFilter).maybeSingle();
    if (lookup.data?.id) connections = [{ project_id: lookup.data.id }];
  } else {
    const { data } = await db.from('drive_connections').select('project_id').eq('paused', false);
    connections = data ?? [];
  }

  const results: Array<{ project_id: string; result: unknown; error?: string }> = [];
  for (const c of connections) {
    try {
      const r = await syncDriveForProject(db, c.project_id);
      results.push({ project_id: c.project_id, result: r });
    } catch (e) {
      results.push({ project_id: c.project_id, result: null, error: (e as Error).message });
    }
  }

  // Also report a raw count of non-paused connections for diagnostics
  const { count: rawCount } = await db
    .from('drive_connections')
    .select('*', { count: 'exact', head: true })
    .eq('paused', false);

  return NextResponse.json({
    projects: connections.length,
    raw_nonpaused_count: rawCount,
    results,
  });
}
