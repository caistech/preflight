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

type LogFn = (phase: string, extra?: Record<string, unknown>) => void;

export async function POST(request: NextRequest) {
  const t0 = Date.now();
  const log: LogFn = (phase, extra) =>
    console.log(
      JSON.stringify({ src: 'drafter-upload', phase, ms: Date.now() - t0, ...(extra ?? {}) }),
    );
  log('received', { url: request.url });
  try {
    return await handleUpload(request, log);
  } catch (e) {
    const err = e as Error;
    console.error(
      JSON.stringify({
        src: 'drafter-upload',
        phase: 'fatal',
        ms: Date.now() - t0,
        message: err.message,
        stack: err.stack,
      }),
    );
    return NextResponse.json({ error: `Upload failed: ${err.message}` }, { status: 500 });
  }
}

async function handleUpload(request: NextRequest, log: LogFn) {
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
  log('form-parsed', {
    fileCount: files.length,
    totalBytes: files.reduce((s, f) => s + f.size, 0),
    fileSummaries: files.map((f) => ({ name: f.name, bytes: f.size, type: f.type })),
  });

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
  log('token-validated', { projectId, drafterTokenId: tokenRow.id });

  // Load project context: facts + active register rows.
  // Run sequentially (not Promise.all) so per-query timing pins down which
  // one stalls if either does. Each query is wrapped with a 15s timeout
  // race so a Supabase hang surfaces as a JSON 500 instead of dropping
  // the TCP connection on Vercel's timeout.
  const withTimeout = <T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> =>
    Promise.race<T>([
      Promise.resolve(p),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms),
      ),
    ]);

  const tFacts = Date.now();
  log('facts-query-start');
  const { data: factRows, error: factErr } = await withTimeout(
    db.from('project_facts').select('key, value').eq('project_id', projectId),
    15000,
    'project_facts',
  );
  log('facts-query-done', {
    ms: Date.now() - tFacts,
    count: factRows?.length ?? 0,
    err: factErr?.message,
  });

  const tReg = Date.now();
  log('register-query-start');
  const { data: registerRows, error: regErr } = await withTimeout(
    db
      .from('register_rows')
      .select('id, project_id, requirement, source, source_url, check_type, check_spec, severity, active')
      .eq('project_id', projectId)
      .eq('active', true),
    15000,
    'register_rows',
  );
  log('register-query-done', {
    ms: Date.now() - tReg,
    count: registerRows?.length ?? 0,
    bytes: JSON.stringify(registerRows ?? []).length,
    err: regErr?.message,
  });

  const facts: Record<string, string> = {};
  for (const f of factRows ?? []) facts[f.key] = f.value;
  const rows = (registerRows ?? []) as RegisterRow[];
  log('context-loaded', {
    factCount: Object.keys(facts).length,
    rowCount: rows.length,
  });

  // Extract each PDF; concatenate with === FILE === separators so rules can
  // grep for source-file context while still seeing all extracted text.
  const fileSummaries: FileSummary[] = [];
  const sections: string[] = [];
  const extractionWarnings: string[] = [];
  let totalBytes = 0;
  let totalPages = 0;

  for (const file of files) {
    const tFile = Date.now();
    log('pdf-extract-start', { name: file.name, bytes: file.size });
    const bytes = Buffer.from(await file.arrayBuffer());
    const extracted = await extractPdf(bytes);
    log('pdf-extract-done', {
      name: file.name,
      bytes: file.size,
      pages: extracted.page_count,
      method: extracted.extraction_method,
      textLen: extracted.text.length,
      warnings: extracted.warnings,
      extractMs: Date.now() - tFile,
    });
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
    log('persist-set-failed', { error: dsErr?.message });
    return NextResponse.json({ error: `Could not persist set: ${dsErr?.message}` }, { status: 500 });
  }
  log('set-persisted', { drawingSetId: ds.id, totalBytes, totalPages, extractionMethod: extractionMethodForRow });

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
    log('run-start-failed', { error: runErr?.message });
    return NextResponse.json({ error: `Could not start run: ${runErr?.message}` }, { status: 500 });
  }
  log('run-started', { checkRunId: run.id, rowCount: rows.length });

  const hard_fails: ResultLine[] = [];
  const needs_review: ResultLine[] = [];
  const confirmed_ok: ResultLine[] = [];
  let not_applicable = 0;
  let errors = 0;

  for (const row of rows) {
    let result: CheckEvaluationResult;
    let deferredToLlm = false;
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
        deferredToLlm = true;
        const tLlm = Date.now();
        result = await runManualCheck(
          row.check_spec as unknown as import('@/lib/rules/types').ManualCheckSpec,
          combinedText,
          facts,
          projectId
        );
        log('manual-check-done', {
          rowId: row.id,
          requirement: row.requirement.slice(0, 60),
          outcome: result.outcome,
          llmMs: Date.now() - tLlm,
        });
      }
    } catch (e) {
      const err = e as Error;
      log('row-eval-error', { rowId: row.id, message: err.message, deferredToLlm });
      result = { outcome: 'error', message: `Eval error: ${err.message}` };
    }

    const { error: resultInsertErr } = await db.from('check_results').insert({
      check_run_id: run.id,
      register_row_id: row.id,
      outcome: result.outcome,
      message: result.message,
      evidence: result.evidence ?? null,
      llm_reasoning: result.llm_reasoning ?? null,
    });
    if (resultInsertErr) log('check-result-insert-failed', { rowId: row.id, error: resultInsertErr.message });

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

  log('rule-loop-done', {
    hardFails: hard_fails.length,
    needsReview: needs_review.length,
    confirmedOk: confirmed_ok.length,
    notApplicable: not_applicable,
    errors,
  });

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

  log('completed', { checkRunId: run.id });
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
