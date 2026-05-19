import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { hashDrafterToken } from '@/lib/drafter-token';
import { extractPdf } from '@/lib/pdf/extract';
import { evaluateRow } from '@/lib/rules/engine';
import { runManualCheck } from '@/lib/ai/manual-check';
import type { RegisterRow, CheckEvaluationResult } from '@/lib/rules/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ResultLine {
  outcome: string;
  message: string;
  severity: string;
  requirement: string;
  source: string;
}

interface FileSummary {
  name: string;
  bytes: number;
  pages: number;
  extraction_method: string;
}

export async function POST(request: NextRequest) {
  const db = createServiceClient();

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Expected multipart form' }, { status: 400 });

  const token = form.get('token');
  if (typeof token !== 'string') {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  // Accept either a single 'file' or multiple 'file' fields (the same key
  // repeated). Filter to actual File instances; tolerate any null junk.
  const files = form.getAll('file').filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: 'Missing file(s)' }, { status: 400 });
  }

  // Verify drafter token
  const hash = hashDrafterToken(token);
  const { data: tokenRow } = await db
    .from('drafter_tokens')
    .select('id, project_id, drafter_name, expires_at, revoked_at, uses')
    .eq('token_hash', hash)
    .single();
  if (!tokenRow) return NextResponse.json({ error: 'Invalid link' }, { status: 401 });
  if (tokenRow.revoked_at) return NextResponse.json({ error: 'Link revoked' }, { status: 401 });
  if (new Date(tokenRow.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Link expired' }, { status: 401 });
  }

  const projectId = tokenRow.project_id;

  // Load project context: facts + active register rows
  const [{ data: factRows }, { data: registerRows }] = await Promise.all([
    db.from('project_facts').select('key, value').eq('project_id', projectId),
    db
      .from('register_rows')
      .select('id, project_id, requirement, source, source_url, check_type, check_spec, severity, active')
      .eq('project_id', projectId)
      .eq('active', true),
  ]);

  const facts: Record<string, string> = {};
  for (const f of factRows ?? []) facts[f.key] = f.value;
  const rows = (registerRows ?? []) as RegisterRow[];

  // Extract each PDF; concatenate with === FILE === separators so rules can
  // grep for source-file context while still seeing all extracted text.
  const fileSummaries: FileSummary[] = [];
  const sections: string[] = [];
  const extractionWarnings: string[] = [];
  let totalBytes = 0;
  let totalPages = 0;

  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const extracted = await extractPdf(bytes);
    fileSummaries.push({
      name: file.name,
      bytes: file.size,
      pages: extracted.page_count,
      extraction_method: extracted.extraction_method,
    });
    sections.push(`=== FILE: ${file.name} ===\n${extracted.text}`);
    extractionWarnings.push(...extracted.warnings);
    totalBytes += file.size;
    totalPages += extracted.page_count;
  }

  const combinedText = sections.join('\n\n');
  const combinedFilename =
    files.length === 1 ? files[0].name : `${files[0].name} + ${files.length - 1} more`;
  // Use the dominant extraction method for the row; if any used pdfjs (cad-pdf), prefer that.
  const extractionMethodForRow = fileSummaries.some((f) => f.extraction_method === 'cad-pdf')
    ? 'cad-pdf'
    : fileSummaries.every((f) => f.extraction_method === 'pdf-parse')
      ? 'pdf-parse'
      : 'failed';

  // Persist drawing_set
  const { data: ds, error: dsErr } = await db
    .from('drawing_sets')
    .insert({
      project_id: projectId,
      drafter_token_id: tokenRow.id,
      uploaded_by: tokenRow.drafter_name ?? 'drafter',
      filename: combinedFilename,
      byte_size: totalBytes,
      page_count: totalPages,
      extracted_text: combinedText,
      extraction_method: extractionMethodForRow,
    })
    .select('id')
    .single();
  if (dsErr || !ds) {
    return NextResponse.json({ error: `Could not persist set: ${dsErr?.message}` }, { status: 500 });
  }

  const { data: run, error: runErr } = await db
    .from('check_runs')
    .insert({
      project_id: projectId,
      drawing_set_id: ds.id,
      drafter_token_id: tokenRow.id,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (runErr || !run) {
    return NextResponse.json({ error: `Could not start run: ${runErr?.message}` }, { status: 500 });
  }

  const hard_fails: ResultLine[] = [];
  const needs_review: ResultLine[] = [];
  const confirmed_ok: ResultLine[] = [];
  let not_applicable = 0;
  let errors = 0;

  for (const row of rows) {
    let result: CheckEvaluationResult;
    try {
      result = evaluateRow({
        row,
        extractedText: combinedText,
        facts,
        projectId,
      });
      if (
        result.outcome === 'unsure' &&
        result.evidence &&
        (result.evidence as Record<string, unknown>).defer_to_llm
      ) {
        result = await runManualCheck(
          row.check_spec as unknown as import('@/lib/rules/types').ManualCheckSpec,
          combinedText,
          facts,
          projectId
        );
      }
    } catch (e) {
      result = { outcome: 'error', message: `Eval error: ${(e as Error).message}` };
    }

    await db.from('check_results').insert({
      check_run_id: run.id,
      register_row_id: row.id,
      outcome: result.outcome,
      message: result.message,
      evidence: result.evidence ?? null,
      llm_reasoning: result.llm_reasoning ?? null,
    });

    const line: ResultLine = {
      outcome: result.outcome,
      message: result.message,
      severity: row.severity,
      requirement: row.requirement,
      source: row.source,
    };

    if (result.outcome === 'fail' && row.severity === 'hard-fail') hard_fails.push(line);
    else if (result.outcome === 'fail' || result.outcome === 'unsure') needs_review.push(line);
    else if (result.outcome === 'pass') confirmed_ok.push(line);
    else if (result.outcome === 'not-applicable') not_applicable++;
    else if (result.outcome === 'error') errors++;
  }

  await db
    .from('check_runs')
    .update({
      status: 'completed',
      hard_fails: hard_fails.length,
      needs_review: needs_review.length,
      confirmed_ok: confirmed_ok.length,
      completed_at: new Date().toISOString(),
    })
    .eq('id', run.id);

  await db
    .from('drafter_tokens')
    .update({ uses: (tokenRow.uses ?? 0) + 1, last_used_at: new Date().toISOString() })
    .eq('id', tokenRow.id);

  return NextResponse.json({
    check_run_id: run.id,
    hard_fails,
    needs_review,
    confirmed_ok,
    not_applicable,
    errors,
    warnings: extractionWarnings,
    files: fileSummaries,
  });
}
