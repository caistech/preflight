import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';
import { resolveProjectId } from '@/lib/project-resolver';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idOrSlug } = await params;
  const { db, error } = await authenticateAndGetDb(request);
  if (error || !db) return NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 });
  const projectId = await resolveProjectId(db, idOrSlug);
  if (!projectId) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status') ?? 'pending';

  const { data, error: qErr } = await db
    .from('register_row_candidates')
    .select('id, source_decision_id, source_project_id, proposed_requirement, proposed_source, proposed_check_type, proposed_check_spec, proposed_severity, confidence, reasoning, status, created_at, projects!source_project_id(name)')
    .eq('project_id', projectId)
    .eq('status', statusFilter)
    .order('created_at', { ascending: false })
    .limit(200);

  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });
  return NextResponse.json({ candidates: data ?? [] });
}
