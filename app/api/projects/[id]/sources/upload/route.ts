import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';
import { extractFile } from '@/lib/ingest/extract-file';
import { ingestKbDocument } from '@/lib/kb/ingest';
import { proposeFactsFromDocument } from '@/lib/ai/facts-proposer';
import { resolveProjectId } from '@/lib/project-resolver';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB — Vercel function body limit is 4.5 MB so this is generous-ish
const ALLOWED_SOURCE_KINDS = [
  'upload',
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

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Expected multipart form' }, { status: 400 });

  const file = form.get('file');
  const title = (form.get('title') as string | null)?.trim() || null;
  const sourceKindRaw = (form.get('source_kind') as string | null) ?? 'upload';
  const sourceKind: SourceKind = (ALLOWED_SOURCE_KINDS as readonly string[]).includes(sourceKindRaw)
    ? (sourceKindRaw as SourceKind)
    : 'upload';

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Limit is ${MAX_BYTES / 1024 / 1024} MB. Compress the PDF or split it.` },
      { status: 413 }
    );
  }

  // Extract text. Dispatcher handles pdf / docx / xlsx / csv / txt / md /
  // html and falls back to UTF-8 for unknown types.
  const bytes = Buffer.from(await file.arrayBuffer());
  const extracted = await extractFile(file.name, file.type, bytes);
  const content = extracted.text;
  if (!content || content.length < 50) {
    return NextResponse.json(
      {
        error: `Extraction produced too little text (${content.length} chars from a ${extracted.format} file). For scanned/image PDFs the OCR path is not wired yet; for everything else this usually means the file is empty or binary.`,
        format: extracted.format,
        warnings: extracted.warnings,
      },
      { status: 422 },
    );
  }

  try {
    const result = await ingestKbDocument(db, {
      projectId,
      title: title ?? file.name,
      sourceKind,
      sourceRef: file.name,
      content,
    });

    await db.from('audit_log').insert({
      project_id: projectId,
      actor_id: user.id,
      action: 'kb_source_uploaded',
      payload: {
        document_id: result.document_id,
        source_kind: sourceKind,
        filename: file.name,
        byte_size: file.size,
        format: extracted.format,
        chunk_count: result.chunk_count,
        warnings: [...extracted.warnings, ...result.warnings],
      },
    });

    // Fire the facts proposer pass. Inline (not awaited via background)
    // because Vercel serverless terminates after the response; we accept the
    // extra few seconds of latency in exchange for not losing proposals.
    let factsResult: Awaited<ReturnType<typeof proposeFactsFromDocument>> | null = null;
    if (result.chunk_count > 0) {
      const { data: existingFactRows } = await db
        .from('project_facts')
        .select('key, value')
        .eq('project_id', projectId);
      const existingFacts: Record<string, string> = {};
      for (const f of existingFactRows ?? []) existingFacts[f.key] = f.value;
      try {
        factsResult = await proposeFactsFromDocument(db, {
          documentId: result.document_id,
          projectId,
          documentTitle: title ?? file.name,
          documentContent: content,
          existingFacts,
        });
      } catch (e) {
        // Proposer failure must not fail the upload — log a warning and move on.
        factsResult = {
          proposed: 0,
          inserted: 0,
          rejected_invalid: 0,
          warnings: [`Proposer threw: ${(e as Error).message}`],
        };
      }
    }

    return NextResponse.json({ ok: true, ...result, fact_candidates: factsResult });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
