import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { hashDrafterToken } from '@/lib/drafter-token';
import { extractPdf } from '@/lib/pdf/extract';
import { evaluateRow } from '@/lib/rules/engine';
import { runManualCheck, type PreScopeEvidence } from '@/lib/ai/manual-check';
import type { RegisterRow, CheckEvaluationResult, ManualCheckSpec, ProjectUnit } from '@/lib/rules/types';

export const dynamic = 'force-dynamic';
// 300s ceiling so a Lot 442-sized register (many manual-check rules) has room
// to land. Phase-2 of the loop below already parallelises the LLM calls, so
// the worst case is the slowest single call, not the sum.
export const maxDuration = 300;

interface ResultLine {
  check_result_id: string;
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

// Wrap any thenable in a Promise.race so a Supabase / fetch hang becomes a
// deterministic timeout error instead of dragging the function to its
// platform maxDuration limit and dropping the TCP connection.
function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms),
    ),
  ]);
}

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

  // Verify drafter token (timeout-wrapped — this is the first Supabase call
  // and the one we've seen hang silently on the live function).
  const hash = hashDrafterToken(token);
  const tTok = Date.now();
  log('token-query-start');
  const { data: tokenRow, error: tokenErr } = await withTimeout(
    db
      .from('drafter_tokens')
      .select('id, project_id, drafter_name, expires_at, revoked_at, uses')
      .eq('token_hash', hash)
      .single(),
    10000,
    'drafter_tokens',
  );
  log('token-query-done', { ms: Date.now() - tTok, found: !!tokenRow, err: tokenErr?.message });
  if (!tokenRow) return NextResponse.json({ error: 'Invalid link' }, { status: 401 });
  if (tokenRow.revoked_at) return NextResponse.json({ error: 'Link revoked' }, { status: 401 });
  if (new Date(tokenRow.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Link expired' }, { status: 401 });
  }

  const projectId = tokenRow.project_id;
  log('token-validated', { projectId, drafterTokenId: tokenRow.id });

  // Load project context: facts + active register rows.
  // Run sequentially (not Promise.all) so per-query timing pins down which
  // one stalls if either does. withTimeout (module scope) makes a hang
  // surface as a JSON 500 instead of dropping the TCP connection.
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

  const tUnits = Date.now();
  log('units-query-start');
  const { data: unitRows, error: unitErr } = await withTimeout(
    db
      .from('project_units')
      .select('unit_number, unit_type, area_sqm, ffl_m, footing_system, status')
      .eq('project_id', projectId),
    10000,
    'project_units',
  );
  log('units-query-done', {
    ms: Date.now() - tUnits,
    count: unitRows?.length ?? 0,
    err: unitErr?.message,
  });

  const facts: Record<string, string> = {};
  for (const f of factRows ?? []) facts[f.key] = f.value;
  const rows = (registerRows ?? []) as RegisterRow[];
  const units = (unitRows ?? []) as ProjectUnit[];
  log('context-loaded', {
    factCount: Object.keys(facts).length,
    rowCount: rows.length,
    unitCount: units.length,
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

  // Phase 1 — deterministic eval for every row, fire LLM calls in parallel
  // (don't await yet). The deterministic step is microsecond-cheap; the LLM
  // step is the only thing worth parallelising. Per-call timeout is 25s so a
  // single stalled call can't drag the whole batch.
  const tPhase1 = Date.now();
  const rowResults: Array<{
    row: RegisterRow;
    result: CheckEvaluationResult;
    llmPromise?: Promise<CheckEvaluationResult>;
  }> = [];

  for (const row of rows) {
    let result: CheckEvaluationResult;
    let llmPromise: Promise<CheckEvaluationResult> | undefined;
    try {
      result = evaluateRow({
        row,
        extractedText: combinedText,
        facts,
        projectId,
        units,
      });
      if (
        result.outcome === 'unsure' &&
        result.evidence &&
        (result.evidence as Record<string, unknown>).defer_to_llm
      ) {
        const tLlm = Date.now();
        // Pre-scope: when the engine narrowed context to specific sheets,
        // forward its evidence so the LLM layer can substitute scoped_text
        // for combinedText AND cite the candidate sheet in its answer.
        const ev = result.evidence as Record<string, unknown>;
        let preScope: PreScopeEvidence | undefined;
        if (typeof ev.pre_scope === 'string' && Array.isArray(ev.pre_scope_candidates)) {
          preScope = {
            pre_scope: ev.pre_scope,
            candidates: ev.pre_scope_candidates as PreScopeEvidence['candidates'],
            scoped_text: typeof ev.pre_scoped_text === 'string' ? ev.pre_scoped_text : null,
          };
        }
        llmPromise = withTimeout(
          runManualCheck(
            row.check_spec as unknown as ManualCheckSpec,
            combinedText,
            facts,
            projectId,
            db,
            preScope,
          ),
          25000,
          `manual-check[${row.id}]`,
        )
          .then((r) => {
            log('manual-check-done', {
              rowId: row.id,
              requirement: row.requirement.slice(0, 60),
              outcome: r.outcome,
              llmMs: Date.now() - tLlm,
            });
            return r;
          })
          .catch((e) => {
            const err = e as Error;
            log('manual-check-failed', {
              rowId: row.id,
              error: err.message,
              llmMs: Date.now() - tLlm,
            });
            return {
              outcome: 'error' as const,
              message: `Manual check failed: ${err.message}`,
            };
          });
      }
    } catch (e) {
      const err = e as Error;
      log('row-eval-error', { rowId: row.id, message: err.message });
      result = { outcome: 'error', message: `Eval error: ${err.message}` };
    }
    rowResults.push({ row, result, llmPromise });
  }
  const llmRowCount = rowResults.filter((r) => r.llmPromise).length;
  log('phase1-done', {
    ms: Date.now() - tPhase1,
    totalRows: rowResults.length,
    llmRows: llmRowCount,
  });

  // Phase 2 — await every LLM call in parallel. Walltime = slowest single
  // call (≤25s), not sum of all calls.
  const tPhase2 = Date.now();
  await Promise.all(
    rowResults
      .filter((r) => r.llmPromise)
      .map(async (r) => {
        r.result = await r.llmPromise!;
      }),
  );
  log('phase2-done', { ms: Date.now() - tPhase2, llmRows: llmRowCount });

  // Phase 3 — persist + categorise in original row order
  const tPhase3 = Date.now();
  for (const { row, result } of rowResults) {
    const { data: insertedResult, error: resultInsertErr } = await db
      .from('check_results')
      .insert({
        check_run_id: run.id,
        register_row_id: row.id,
        outcome: result.outcome,
        message: result.message,
        evidence: result.evidence ?? null,
        llm_reasoning: result.llm_reasoning ?? null,
      })
      .select('id')
      .single();
    if (resultInsertErr) log('check-result-insert-failed', { rowId: row.id, error: resultInsertErr.message });

    const line: ResultLine = {
      check_result_id: insertedResult?.id ?? '',
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
  log('phase3-done', { ms: Date.now() - tPhase3 });

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
