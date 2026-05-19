import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';
import { extractPdf } from '@/lib/pdf/extract';
import { ingestKbDocument } from '@/lib/kb/ingest';

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
  const { id: projectId } = await params;
  const { user, db, error } = await authenticateAndGetDb(request);
  if (error || !db || !user) {
    return NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 });
  }

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

  // Verify project exists (auth is enough for v0 — no per-project membership gate yet)
  const { data: project } = await db.from('projects').select('id').eq('id', projectId).single();
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  // Extract text. PDFs via pdf-parse; .txt/.md treated as raw.
  const bytes = Buffer.from(await file.arrayBuffer());
  let content = '';
  if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
    const extracted = await extractPdf(bytes);
    content = extracted.text;
    if (!content || content.length < 50) {
      return NextResponse.json(
        { error: `PDF extraction produced too little text (${content.length} chars). The CAD-PDF path is deferred; for now try a born-digital PDF or a .txt/.md version.` },
        { status: 422 }
      );
    }
  } else {
    content = bytes.toString('utf-8');
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
        chunk_count: result.chunk_count,
        warnings: result.warnings,
      },
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
