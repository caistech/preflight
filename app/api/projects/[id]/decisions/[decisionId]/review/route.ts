import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';
import { resolveProjectId } from '@/lib/project-resolver';
import { ingestKbDocument } from '@/lib/kb/ingest';
import { proposeScopeForDocument } from '@/lib/ai/scope-classifier';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VALID_REVIEWS = ['agree', 'disagree_overrule', 'promote_to_rule', 'add_more_context'] as const;
type Review = (typeof VALID_REVIEWS)[number];

const REVIEW_LABEL: Record<Review, string> = {
  agree: 'Operator agrees with the drafter decision',
  disagree_overrule: 'Operator overruled the drafter decision',
  promote_to_rule: 'Operator wants the underlying rule refined based on this',
  add_more_context: 'Operator added more context (drafter decision stands)',
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; decisionId: string }> },
) {
  const { id: idOrSlug, decisionId } = await params;
  const { user, db, error } = await authenticateAndGetDb(request);
  if (error || !db || !user) return NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 });
  const projectId = await resolveProjectId(db, idOrSlug);
  if (!projectId) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  const reviewRaw = typeof body.review === 'string' ? body.review : null;
  const rationale = typeof body.rationale === 'string' ? body.rationale.trim() : '';

  if (!reviewRaw || !(VALID_REVIEWS as readonly string[]).includes(reviewRaw)) {
    return NextResponse.json({ error: `review must be one of ${VALID_REVIEWS.join(', ')}` }, { status: 400 });
  }
  const review = reviewRaw as Review;
  if (rationale.length < 5) {
    return NextResponse.json({ error: 'rationale must be at least 5 characters' }, { status: 400 });
  }
  if (rationale.length > 4000) {
    return NextResponse.json({ error: 'rationale capped at 4000 characters' }, { status: 400 });
  }

  // Load the decision + the original drafter context so the KB document
  // captures the full disagreement chain, not just the operator's opinion.
  const { data: decision, error: decErr } = await db
    .from('check_result_decisions')
    .select('id, project_id, check_result_id, decision, rationale, check_results(outcome, message, register_rows(requirement, source))')
    .eq('id', decisionId)
    .eq('project_id', projectId)
    .single();
  if (decErr || !decision) return NextResponse.json({ error: 'Decision not found' }, { status: 404 });

  // Stamp the review.
  const { error: updErr } = await db
    .from('check_result_decisions')
    .update({
      operator_review: review,
      operator_review_rationale: rationale,
      reviewed_by_user_id: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', decisionId)
    .eq('project_id', projectId);
  if (updErr) return NextResponse.json({ error: `Could not save review: ${updErr.message}` }, { status: 500 });

  // Write the operator's view as a kb_document so the facts proposer mines
  // candidate facts. This is the cross-project loop — operator-reviewed
  // decisions are the trusted signal.
  const cr = (decision as unknown as { check_results?: Array<{ outcome: string; message: string; register_rows?: Array<{ requirement: string; source: string }> | { requirement: string; source: string } }> | { outcome: string; message: string; register_rows?: Array<{ requirement: string; source: string }> | { requirement: string; source: string } } }).check_results;
  const checkResult = Array.isArray(cr) ? cr[0] : cr;
  const regRaw = checkResult?.register_rows;
  const reg = Array.isArray(regRaw) ? regRaw[0] : regRaw;

  let kbDocumentId: string | null = null;
  try {
    const ingestResult = await ingestKbDocument(db, {
      projectId,
      title: `Operator review — ${(reg?.requirement ?? 'unknown rule').slice(0, 80)}`,
      sourceKind: 'operator-decision',
      sourceRef: `review:${decisionId}`,
      content: [
        `Rule: ${reg?.requirement ?? '(unknown)'}`,
        `Source: ${reg?.source ?? '(unknown)'}`,
        `Tool outcome: ${checkResult?.outcome ?? '(unknown)'}`,
        `Tool message: ${checkResult?.message ?? '(none)'}`,
        `Drafter decision: ${decision.decision}`,
        `Drafter rationale: ${decision.rationale}`,
        `Operator review: ${REVIEW_LABEL[review]}`,
        `Operator rationale: ${rationale}`,
        `Reviewed by: ${user.email ?? user.id}`,
        `Reviewed at: ${new Date().toISOString()}`,
      ].join('\n\n'),
    });
    kbDocumentId = ingestResult.document_id;
    await db
      .from('check_result_decisions')
      .update({ operator_review_kb_document_id: kbDocumentId })
      .eq('id', decisionId);

    // promote_to_rule explicitly signals cross-project intent — force-run
    // the scope classifier so the operator gets a cross-project / general
    // proposal to approve. Without this, operator-decision docs are
    // project-scoped by default and the propagation never starts.
    if (review === 'promote_to_rule') {
      try {
        const { data: factRows } = await db
          .from('project_facts')
          .select('key, value')
          .eq('project_id', projectId);
        const projectFacts: Record<string, string> = {};
        for (const f of factRows ?? []) projectFacts[f.key] = f.value;

        await proposeScopeForDocument(db, {
          documentId: kbDocumentId,
          projectId,
          documentTitle: `Operator review — ${(reg?.requirement ?? 'unknown rule').slice(0, 80)}`,
          documentSourceKind: 'operator-decision',
          documentContent: [
            `Rule: ${reg?.requirement ?? ''}`,
            `Drafter decision: ${decision.decision}`,
            `Drafter rationale: ${decision.rationale}`,
            `Operator chose: promote_to_rule`,
            `Operator rationale: ${rationale}`,
          ].join('\n\n'),
          projectFacts,
          forceClassify: true,
        });
      } catch (e) {
        console.error(`[operator-review] force-classify failed: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    console.error(`[operator-review] KB feedback failed: ${(e as Error).message}`);
  }

  await db.from('audit_log').insert({
    project_id: projectId,
    actor_id: user.id,
    action: 'operator_decision_review',
    payload: {
      decision_id: decisionId,
      review,
      rationale,
      kb_document_id: kbDocumentId,
    },
  });

  return NextResponse.json({
    ok: true,
    review,
    operator_review_kb_document_id: kbDocumentId,
  });
}
