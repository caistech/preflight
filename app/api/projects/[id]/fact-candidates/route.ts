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
    .from('fact_candidates')
    .select('id, proposed_key, proposed_value, confidence, evidence_quote, reasoning, status, source_document_id, created_at, kb_documents(title)')
    .eq('project_id', projectId)
    .eq('status', statusFilter)
    .order('created_at', { ascending: false })
    .limit(200);

  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });
  return NextResponse.json({ candidates: data ?? [] });
}
