import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';
import { ingestKbDocument, fetchUrlAsText } from '@/lib/kb/ingest';
import { proposeFactsFromDocument } from '@/lib/ai/facts-proposer';
import { resolveProjectId } from '@/lib/project-resolver';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const ALLOWED_SOURCE_KINDS = [
  'url',
  'planner-letter',
  'council-audit',
  'engineer-note',
  'manual',
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
  const url: string | null = body.url ?? null;
  const sourceKindRaw: string = body.source_kind ?? 'url';
  const sourceKind: SourceKind = (ALLOWED_SOURCE_KINDS as readonly string[]).includes(sourceKindRaw)
    ? (sourceKindRaw as SourceKind)
    : 'url';
  const titleOverride: string | null = (body.title ?? null)?.toString().trim() || null;

  if (!url || !/^https?:\/\//.test(url)) {
    return NextResponse.json({ error: 'Provide a valid http(s) URL' }, { status: 400 });
  }

  let fetched: { title: string; content: string };
  try {
    fetched = await fetchUrlAsText(url);
  } catch (e) {
    return NextResponse.json({ error: `Fetch failed: ${(e as Error).message}` }, { status: 502 });
  }

  if (!fetched.content || fetched.content.length < 50) {
    return NextResponse.json(
      { error: `Fetched too little text from the URL (${fetched.content.length} chars). Paste the content as manual text instead.` },
      { status: 422 }
    );
  }

  try {
    const result = await ingestKbDocument(db, {
      projectId,
      title: titleOverride ?? fetched.title,
      sourceKind,
      sourceRef: url,
      content: fetched.content,
    });

    await db.from('audit_log').insert({
      project_id: projectId,
      actor_id: user.id,
      action: 'kb_source_url_ingested',
      payload: {
        document_id: result.document_id,
        source_kind: sourceKind,
        url,
        chunk_count: result.chunk_count,
        warnings: result.warnings,
      },
    });

    let factsResult: Awaited<ReturnType<typeof proposeFactsFromDocument>> | null = null;
    if (result.chunk_count > 0) {
      const { data: existingFactRows } = await db.from('project_facts').select('key, value').eq('project_id', projectId);
      const existingFacts: Record<string, string> = {};
      for (const f of existingFactRows ?? []) existingFacts[f.key] = f.value;
      try {
        factsResult = await proposeFactsFromDocument(db, {
          documentId: result.document_id,
          projectId,
          documentTitle: titleOverride ?? fetched.title,
          documentContent: fetched.content,
          existingFacts,
        });
      } catch (e) {
        factsResult = { proposed: 0, inserted: 0, rejected_invalid: 0, warnings: [`Proposer threw: ${(e as Error).message}`] };
      }
    }

    return NextResponse.json({ ok: true, ...result, fact_candidates: factsResult });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
