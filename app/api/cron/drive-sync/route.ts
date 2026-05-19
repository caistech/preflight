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
  const { data: connections } = await db
    .from('drive_connections')
    .select('project_id')
    .eq('paused', false);

  const results: Array<{ project_id: string; result: unknown; error?: string }> = [];
  for (const c of connections ?? []) {
    try {
      const r = await syncDriveForProject(db, c.project_id);
      results.push({ project_id: c.project_id, result: r });
    } catch (e) {
      results.push({ project_id: c.project_id, result: null, error: (e as Error).message });
    }
  }

  return NextResponse.json({ projects: connections?.length ?? 0, results });
}
