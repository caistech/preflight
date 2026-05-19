import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';
import { ingestKbDocument } from '@/lib/kb/ingest';
import { resolveProjectId } from '@/lib/project-resolver';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const ALLOWED_SOURCE_KINDS = [
  'manual',
  'planner-letter',
  'council-audit',
  'engineer-note',
] as const;

type SourceKind = (typeof ALLOWED_SOURCE_KINDS)[number];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idOrSlug } = await params;
  const { user, db, error } = await authenticateAndGetDb(request);
  if (error || !db || !user) {
    return NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 });
  }
  const projectId = await resolveProjectId(db, idOrSlug);
  if (!projectId) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const title: string | null = (body.title ?? null)?.toString().trim() || null;
  const content: string | null = (body.content ?? null)?.toString() ?? null;
  const sourceKindRaw: string = body.source_kind ?? 'manual';
  const sourceKind: SourceKind = (ALLOWED_SOURCE_KINDS as readonly string[]).includes(sourceKindRaw)
    ? (sourceKindRaw as SourceKind)
    : 'manual';

  if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  if (!content || content.trim().length < 30) {
    return NextResponse.json({ error: 'Content is too short (need at least 30 chars)' }, { status: 400 });
  }

  try {
    const result = await ingestKbDocument(db, {
      projectId,
      title,
      sourceKind,
      sourceRef: null,
      content,
    });

    await db.from('audit_log').insert({
      project_id: projectId,
      actor_id: user.id,
      action: 'kb_source_manual_ingested',
      payload: { document_id: result.document_id, source_kind: sourceKind, title, chunk_count: result.chunk_count },
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
