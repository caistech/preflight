/**
 * ONE CHECK ENGINE, TWO FRONT DOORS.
 *
 * The drafter upload (`/api/drafter/upload`) and the machine API
 * (`/api/v1/projects/:id/check-runs`) both run a drawing set against a
 * project's register. This is the single implementation they share, so the
 * two can never disagree about what a check found — a rule that behaves one
 * way when a drafter uploads and another when Kira asks would make every
 * answer untrustworthy.
 *
 * Extracted verbatim from the drafter route: context load → per-file text
 * extraction → deterministic evaluation of every active row → manual-check
 * rows to the LLM in parallel → persist results → categorise.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { extractPdf } from '@/lib/pdf/extract';
import { isUnread, transcribePdf, type TranscribeResult } from '@/lib/pdf/transcribe';
import { evaluateRow } from '@/lib/rules/engine';
import { runManualCheck, type PreScopeEvidence } from '@/lib/ai/manual-check';
import type { RegisterRow, CheckEvaluationResult, ManualCheckSpec, ProjectUnit } from '@/lib/rules/types';

export interface ResultLine {
  check_result_id: string;
  outcome: string;
  message: string;
  severity: string;
  requirement: string;
  source: string;
}

export interface FileSummary {
  name: string;
  bytes: number;
  pages: number;
  extraction_method: string;
}

export interface CheckFile {
  name: string;
  bytes: Buffer;
}

export interface TriagePayload {
  check_run_id: string;
  hard_fails: ResultLine[];
  needs_review: ResultLine[];
  confirmed_ok: ResultLine[];
  not_applicable: number;
  errors: number;
  warnings: string[];
  files: FileSummary[];
  /** Files no text could be taken from, even from the drawing image. Nothing in them was checked. */
  unreadable_files?: string[];
}

/** A file whose text layer was empty, waiting to be read from the drawing image. */
export interface UnreadFile {
  index: number;
  file: CheckFile;
  pages: number;
}

export interface OpenedRun {
  runId: string;
  drawingSetId?: string;
  combinedText: string;
  fileSummaries: FileSummary[];
  warnings: string[];
  /** One `=== FILE: … ===` section per file, in upload order. */
  sections?: string[];
  unread?: UnreadFile[];
}

const fileSection = (name: string, text: string) => `=== FILE: ${name} ===\n${text}`;

type Transcriber = (name: string, bytes: Buffer, pages: number) => Promise<TranscribeResult>;

/**
 * Read every unread file from its drawing image, four at a time, and fold the
 * transcriptions back into the run. Returns the names that still could not be read.
 * Mutates `opened` so the evaluation below sees the transcribed text.
 */
export async function readUnreadFiles(
  opened: OpenedRun,
  log: LogFn,
  transcribe: Transcriber = transcribePdf,
): Promise<Array<{ name: string; reason: string }>> {
  const unread = opened.unread ?? [];
  if (unread.length === 0 || !opened.sections) return [];

  const stillUnread: Array<{ name: string; reason: string }> = [];
  const queue = [...unread];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const { index, file, pages } = next;
      log('vision-read-start', { name: file.name, bytes: file.bytes.byteLength });
      const got = await transcribe(file.name, file.bytes, pages);
      // `in`, not `.ok`: tsconfig has strict:false, which does not narrow on a boolean tag.
      if ('text' in got) {
        opened.sections![index] = fileSection(file.name, got.text);
        opened.fileSummaries[index] = { ...opened.fileSummaries[index], extraction_method: 'vision' };
        log('vision-read-done', { name: file.name, textLen: got.text.length, ms: got.ms });
      } else {
        stillUnread.push({ name: file.name, reason: got.reason });
        opened.warnings.push(`${file.name}: no text could be read — ${got.reason}. Nothing on this sheet was checked.`);
        log('vision-read-failed', { name: file.name, reason: got.reason });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, unread.length) }, worker));

  opened.combinedText = opened.sections.join('\n\n');
  opened.unread = [];
  // Keep upload order in what the caller reads back.
  const order = new Map(opened.fileSummaries.map((f, i) => [f.name, i]));
  return stillUnread.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
}

export type LogFn = (phase: string, extra?: Record<string, unknown>) => void;

/** Who started the run. Exactly one of the two ids is set; the label is what the record shows. */
export interface RunOrigin {
  drafterTokenId?: string | null;
  apiKeyId?: string | null;
  label: string;
}

// Wrap any thenable in a Promise.race so a Supabase / fetch hang becomes a
// deterministic timeout error instead of dragging the function to its
// platform maxDuration limit and dropping the TCP connection.
export function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms),
    ),
  ]);
}

export class CheckRunError extends Error {}

/**
 * Persist the drawing set and open a `running` check_runs row. Split from the
 * evaluation so the API can hand back the run id before the slow part starts.
 */
export async function openRun(
  db: SupabaseClient,
  projectId: string,
  files: CheckFile[],
  origin: RunOrigin,
  log: LogFn,
  extra: Record<string, unknown> = {},
): Promise<OpenedRun & { drawingSetId: string }> {
  const fileSummaries: FileSummary[] = [];
  const sections: string[] = [];
  const warnings: string[] = [];
  const unread: UnreadFile[] = [];
  let totalBytes = 0;
  let totalPages = 0;

  for (const [index, file] of files.entries()) {
    const tFile = Date.now();
    log('pdf-extract-start', { name: file.name, bytes: file.bytes.byteLength });
    const extracted = await extractPdf(file.bytes);
    log('pdf-extract-done', {
      name: file.name,
      pages: extracted.page_count,
      method: extracted.extraction_method,
      textLen: extracted.text.length,
      warnings: extracted.warnings,
      extractMs: Date.now() - tFile,
    });
    fileSummaries.push({
      name: file.name,
      bytes: file.bytes.byteLength,
      pages: extracted.page_count,
      extraction_method: extracted.extraction_method,
    });
    sections.push(fileSection(file.name, extracted.text));
    // A drawn sheet with no text layer is read from its image in evaluateRun (the slow,
    // after-the-reply half), so its extractor warnings would only describe a problem
    // that is about to be dealt with.
    if (isUnread(extracted.text)) unread.push({ index, file, pages: extracted.page_count });
    else warnings.push(...extracted.warnings);
    totalBytes += file.bytes.byteLength;
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

  const { data: ds, error: dsErr } = await db
    .from('drawing_sets')
    .insert({
      project_id: projectId,
      drafter_token_id: origin.drafterTokenId ?? null,
      uploaded_by: origin.label,
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
    throw new CheckRunError(`Could not persist set: ${dsErr?.message}`);
  }
  log('set-persisted', { drawingSetId: ds.id, totalBytes, totalPages, extractionMethod: extractionMethodForRow });

  const { data: run, error: runErr } = await db
    .from('check_runs')
    .insert({
      project_id: projectId,
      drawing_set_id: ds.id,
      drafter_token_id: origin.drafterTokenId ?? null,
      api_key_id: origin.apiKeyId ?? null,
      status: 'running',
      started_at: new Date().toISOString(),
      ...extra,
    })
    .select('id')
    .single();
  if (runErr || !run) {
    log('run-start-failed', { error: runErr?.message });
    throw new CheckRunError(`Could not start run: ${runErr?.message}`);
  }
  log('run-started', { checkRunId: run.id });

  return { runId: run.id, drawingSetId: ds.id, combinedText, fileSummaries, warnings, sections, unread };
}

/** Load the project's facts, active register and units. */
async function loadContext(db: SupabaseClient, projectId: string, log: LogFn) {
  const tFacts = Date.now();
  const { data: factRows, error: factErr } = await withTimeout(
    db.from('project_facts').select('key, value').eq('project_id', projectId),
    15000,
    'project_facts',
  );
  log('facts-query-done', { ms: Date.now() - tFacts, count: factRows?.length ?? 0, err: factErr?.message });

  const tReg = Date.now();
  const { data: registerRows, error: regErr } = await withTimeout(
    db
      .from('register_rows')
      .select('id, project_id, requirement, source, source_url, check_type, check_spec, severity, active')
      .eq('project_id', projectId)
      .eq('active', true),
    15000,
    'register_rows',
  );
  log('register-query-done', { ms: Date.now() - tReg, count: registerRows?.length ?? 0, err: regErr?.message });

  const tUnits = Date.now();
  const { data: unitRows, error: unitErr } = await withTimeout(
    db
      .from('project_units')
      .select('unit_number, unit_type, area_sqm, ffl_m, footing_system, status')
      .eq('project_id', projectId),
    10000,
    'project_units',
  );
  log('units-query-done', { ms: Date.now() - tUnits, count: unitRows?.length ?? 0, err: unitErr?.message });

  // FAIL CLOSED. A register that could not be read must not produce a run that
  // reports "nothing failed" — that is the one answer this tool exists to make
  // trustworthy.
  if (regErr) throw new CheckRunError(`Could not read the register: ${regErr.message}`);

  const facts: Record<string, string> = {};
  for (const f of factRows ?? []) facts[f.key] = f.value;
  return {
    facts,
    rows: (registerRows ?? []) as RegisterRow[],
    units: (unitRows ?? []) as ProjectUnit[],
  };
}

/**
 * Evaluate every active row against an opened run and write the outcome.
 * Marks the run `failed` (never `completed`) if anything throws.
 */
export async function evaluateRun(
  db: SupabaseClient,
  projectId: string,
  opened: OpenedRun,
  log: LogFn,
  transcribe: Transcriber = transcribePdf,
): Promise<TriagePayload> {
  try {
    const unreadable = await readUnreadFiles(opened, log, transcribe);
    // NOTHING READ, NOTHING CHECKED. A run over blank text "finishes" with every rule
    // unsure — which reads out as "15 items need eyes" when the truth is that no sheet
    // was looked at. That is a failed run, and it says which files and why.
    if (unreadable.length > 0 && unreadable.length === opened.fileSummaries.length) {
      const reasons = [...new Set(unreadable.map((u) => u.reason))];
      throw new CheckRunError(
        `Preflight couldn't read any text from ${unreadable.length === 1 ? unreadable[0].name : `the ${unreadable.length} sheets`}, ` +
          `even from the drawing image (${reasons.slice(0, 2).join('; ')})`,
      );
    }
    if (opened.drawingSetId && opened.fileSummaries.some((f) => f.extraction_method === 'vision')) {
      const { error: dsErr } = await db
        .from('drawing_sets')
        .update({ extracted_text: opened.combinedText, extraction_method: 'vision' })
        .eq('id', opened.drawingSetId);
      if (dsErr) log('set-text-update-failed', { error: dsErr.message });
    }

    const { facts, rows, units } = await loadContext(db, projectId, log);
    const { combinedText } = opened;

    const hard_fails: ResultLine[] = [];
    const needs_review: ResultLine[] = [];
    const confirmed_ok: ResultLine[] = [];
    let not_applicable = 0;
    let errors = 0;

    // Phase 1 — deterministic eval for every row, fire LLM calls in parallel
    // (don't await yet). Per-call timeout is 25s so a single stalled call can't
    // drag the whole batch.
    const rowResults: Array<{
      row: RegisterRow;
      result: CheckEvaluationResult;
      llmPromise?: Promise<CheckEvaluationResult>;
    }> = [];

    for (const row of rows) {
      let result: CheckEvaluationResult;
      let llmPromise: Promise<CheckEvaluationResult> | undefined;
      try {
        result = evaluateRow({ row, extractedText: combinedText, facts, projectId, units });
        if (
          result.outcome === 'unsure' &&
          result.evidence &&
          (result.evidence as Record<string, unknown>).defer_to_llm
        ) {
          const tLlm = Date.now();
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
            runManualCheck(row.check_spec as unknown as ManualCheckSpec, combinedText, facts, projectId, db, preScope),
            25000,
            `manual-check[${row.id}]`,
          )
            .then((r) => {
              log('manual-check-done', { rowId: row.id, outcome: r.outcome, llmMs: Date.now() - tLlm });
              return r;
            })
            .catch((e) => {
              const err = e as Error;
              log('manual-check-failed', { rowId: row.id, error: err.message, llmMs: Date.now() - tLlm });
              return { outcome: 'error' as const, message: `Manual check failed: ${err.message}` };
            });
        }
      } catch (e) {
        const err = e as Error;
        log('row-eval-error', { rowId: row.id, message: err.message });
        result = { outcome: 'error', message: `Eval error: ${err.message}` };
      }
      rowResults.push({ row, result, llmPromise });
    }

    // Phase 2 — await every LLM call in parallel.
    await Promise.all(
      rowResults
        .filter((r) => r.llmPromise)
        .map(async (r) => {
          r.result = await r.llmPromise!;
        }),
    );

    // Phase 3 — persist + categorise in original row order
    for (const { row, result } of rowResults) {
      const { data: insertedResult, error: resultInsertErr } = await db
        .from('check_results')
        .insert({
          check_run_id: opened.runId,
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

    const payload: TriagePayload = {
      check_run_id: opened.runId,
      hard_fails,
      needs_review,
      confirmed_ok,
      not_applicable,
      errors,
      warnings: opened.warnings,
      files: opened.fileSummaries,
      ...(unreadable.length > 0 ? { unreadable_files: unreadable.map((u) => u.name) } : {}),
    };

    await db
      .from('check_runs')
      .update({
        status: 'completed',
        hard_fails: hard_fails.length,
        needs_review: needs_review.length,
        confirmed_ok: confirmed_ok.length,
        triage_payload: payload,
        completed_at: new Date().toISOString(),
      })
      .eq('id', opened.runId);

    log('completed', { checkRunId: opened.runId });
    return payload;
  } catch (e) {
    const err = e as Error;
    log('run-failed', { checkRunId: opened.runId, message: err.message });
    await db
      .from('check_runs')
      .update({ status: 'failed', error: err.message.slice(0, 500), completed_at: new Date().toISOString() })
      .eq('id', opened.runId);
    throw e;
  }
}
