/**
 * Drafter records a per-item decision on a triage result.
 *
 * Flow:
 *   1. Validate the drafter token (same HMAC pattern as upload).
 *   2. Verify the check_result belongs to a run owned by this token's
 *      project — prevents cross-token reads.
 *   3. Upsert the decision (one decision per result; re-submit overwrites).
 *   4. Write the rationale as a kb_document so the facts proposer mines
 *      candidate facts for operator approval. This is the loop-closure.
 *
 * Decision options:
 *   - confirm_finding: human agrees with the tool's outcome as-is.
 *   - overrule_pass: tool said fail/unsure, human says this is actually fine.
 *   - overrule_fail: tool said pass, human says this is actually a fail.
 *   - add_context: outcome stands; human adds context for future runs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { hashDrafterToken } from '@/lib/drafter-token';
import { ingestKbDocument } from '@/lib/kb/ingest';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VALID_DECISIONS = ['confirm_finding', 'overrule_pass', 'overrule_fail', 'add_context'] as const;
type Decision = (typeof VALID_DECISIONS)[number];

export async function POST(request: NextRequest) {
  const db = createServiceClient();

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  const token = typeof body.token === 'string' ? body.token : null;
  const checkResultId = typeof body.check_result_id === 'string' ? body.check_result_id : null;
  const decisionRaw = typeof body.decision === 'string' ? body.decision : null;
  const rationale = typeof body.rationale === 'string' ? body.rationale.trim() : '';
  const feedToKb = body.feed_to_kb === false ? false : true;

  if (!token || !checkResultId || !decisionRaw) {
    return NextResponse.json(
      { error: 'Provide { token, check_result_id, decision, rationale }' },
      { status: 400 },
    );
  }
  if (!(VALID_DECISIONS as readonly string[]).includes(decisionRaw)) {
    return NextResponse.json(
      { error: `decision must be one of ${VALID_DECISIONS.join(', ')}` },
      { status: 400 },
    );
  }
  const decision = decisionRaw as Decision;
  if (rationale.length < 5) {
    return NextResponse.json(
      { error: 'rationale must be at least 5 characters — a single word like "ok" leaves no signal for future projects' },
      { status: 400 },
    );
  }
  if (rationale.length > 4000) {
    return NextResponse.json({ error: 'rationale capped at 4000 characters' }, { status: 400 });
  }

  // Verify drafter token + that this result belongs to that token's project.
  const hash = hashDrafterToken(token);
  const { data: tokenRow } = await db
    .from('drafter_tokens')
    .select('id, project_id, drafter_name, expires_at, revoked_at')
    .eq('token_hash', hash)
    .single();
  if (!tokenRow) return NextResponse.json({ error: 'Invalid link' }, { status: 401 });
  if (tokenRow.revoked_at) return NextResponse.json({ error: 'Link revoked' }, { status: 401 });
  if (new Date(tokenRow.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Link expired' }, { status: 401 });
  }

  const { data: result, error: resErr } = await db
    .from('check_results')
    .select('id, check_run_id, register_row_id, outcome, message, check_runs!inner(project_id, drafter_token_id), register_rows!inner(requirement, source)')
    .eq('id', checkResultId)
    .single();
  if (resErr || !result) {
    return NextResponse.json({ error: 'Check result not found' }, { status: 404 });
  }

  // Supabase typegen returns single-row joins as arrays; flatten here.
  const checkRunsRaw = (result as unknown as { check_runs?: Array<{ project_id: string; drafter_token_id: string | null }> | { project_id: string; drafter_token_id: string | null } }).check_runs;
  const run = Array.isArray(checkRunsRaw) ? checkRunsRaw[0] : checkRunsRaw;
  if (!run || run.project_id !== tokenRow.project_id) {
    return NextResponse.json({ error: 'This result belongs to a different project' }, { status: 403 });
  }

  const regRaw = (result as unknown as { register_rows?: Array<{ requirement: string; source: string }> | { requirement: string; source: string } }).register_rows;
  const reg = Array.isArray(regRaw) ? regRaw[0] : regRaw;

  // Upsert the decision. The unique index on check_result_id means we
  // overwrite a previous decision rather than stack them.
  const { data: decisionRow, error: decErr } = await db
    .from('check_result_decisions')
    .upsert(
      {
        check_result_id: checkResultId,
        check_run_id: result.check_run_id,
        register_row_id: result.register_row_id,
        project_id: tokenRow.project_id,
        decided_by_drafter_token_id: tokenRow.id,
        decided_by_user_id: null,
        decision,
        rationale,
        feed_to_kb: feedToKb,
      },
      { onConflict: 'check_result_id' },
    )
    .select('id')
    .single();
  if (decErr || !decisionRow) {
    return NextResponse.json({ error: `Could not save decision: ${decErr?.message}` }, { status: 500 });
  }

  // Write the rationale as a kb_document so the facts proposer can mine
  // candidate facts. Skip if the drafter opted out via feed_to_kb=false.
  let kbDocumentId: string | null = null;
  if (feedToKb) {
    const decisionLabel: Record<Decision, string> = {
      confirm_finding: 'Confirmed the tool finding',
      overrule_pass: 'Overruled to PASS (tool flagged but item is actually fine)',
      overrule_fail: 'Overruled to FAIL (tool passed but item is actually a problem)',
      add_context: 'Added context (outcome unchanged)',
    };

    const docTitle = `Decision — ${(reg?.requirement ?? 'unknown rule').slice(0, 80)}`;
    const docContent = [
      `Rule: ${reg?.requirement ?? '(unknown)'}`,
      `Source: ${reg?.source ?? '(unknown)'}`,
      `Tool outcome: ${result.outcome}`,
      `Tool message: ${result.message ?? '(none)'}`,
      `Drafter decision: ${decisionLabel[decision]}`,
      `Rationale: ${rationale}`,
      `Decided by drafter: ${tokenRow.drafter_name ?? '(unnamed token)'}`,
      `Decided at: ${new Date().toISOString()}`,
    ].join('\n\n');

    try {
      const ingestResult = await ingestKbDocument(db, {
        projectId: tokenRow.project_id,
        title: docTitle,
        sourceKind: 'operator-decision',
        sourceRef: `decision:${decisionRow.id}`,
        content: docContent,
      });
      kbDocumentId = ingestResult.document_id;
      await db
        .from('check_result_decisions')
        .update({ fed_to_kb_document_id: kbDocumentId })
        .eq('id', decisionRow.id);
    } catch (e) {
      // KB ingest failure must not lose the decision itself.
      console.error(`[decision] KB feedback failed: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({
    ok: true,
    decision_id: decisionRow.id,
    decision,
    fed_to_kb_document_id: kbDocumentId,
  });
}
