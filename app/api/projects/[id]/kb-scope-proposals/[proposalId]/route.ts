import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';
import { resolveProjectId } from '@/lib/project-resolver';

export const dynamic = 'force-dynamic';

/**
 * PATCH resolves a kb scope proposal: approve → updates kb_documents.scope
 * (+ scope_applies_when for cross-project) and supersedes any older
 * pending proposal for the same doc. Reject → just flips status.
 *
 * Supports operator override of both fields:
 *   - scope_override: 'project' | 'cross-project' | 'general'  (defaults to proposal)
 *   - applies_when_override: { ... }                            (defaults to proposal)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; proposalId: string }> },
) {
  const { id: idOrSlug, proposalId } = await params;
  const { user, db, error } = await authenticateAndGetDb(request);
  if (error || !db || !user) return NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 });
  const projectId = await resolveProjectId(db, idOrSlug);
  if (!projectId) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body || (body.action !== 'approve' && body.action !== 'reject')) {
    return NextResponse.json({ error: 'Provide { action: "approve" | "reject", scope_override?, applies_when_override?, note? }' }, { status: 400 });
  }

  const { data: proposal, error: fetchErr } = await db
    .from('kb_scope_proposals')
    .select('id, project_id, kb_document_id, proposed_scope, proposed_applies_when, status')
    .eq('id', proposalId)
    .eq('project_id', projectId)
    .single();
  if (fetchErr || !proposal) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  if (proposal.status !== 'pending') {
    return NextResponse.json({ error: `Already ${proposal.status}; cannot re-resolve` }, { status: 409 });
  }

  if (body.action === 'approve') {
    const finalScope: string =
      typeof body.scope_override === 'string' &&
      ['project', 'cross-project', 'general'].includes(body.scope_override)
        ? body.scope_override
        : proposal.proposed_scope;

    const finalAppliesWhen =
      finalScope === 'cross-project'
        ? body.applies_when_override ?? proposal.proposed_applies_when ?? null
        : null;

    if (finalScope === 'cross-project' && (!finalAppliesWhen || Object.keys(finalAppliesWhen).length === 0)) {
      return NextResponse.json({ error: 'cross-project scope requires a non-empty applies_when filter' }, { status: 400 });
    }

    const { error: updDocErr } = await db
      .from('kb_documents')
      .update({
        scope: finalScope,
        scope_applies_when: finalAppliesWhen,
      })
      .eq('id', proposal.kb_document_id);
    if (updDocErr) return NextResponse.json({ error: `Could not update document scope: ${updDocErr.message}` }, { status: 500 });
  }

  const { error: updErr } = await db
    .from('kb_scope_proposals')
    .update({
      status: body.action === 'approve' ? 'approved' : 'rejected',
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
      resolution_note: typeof body.note === 'string' ? body.note.slice(0, 500) : null,
    })
    .eq('id', proposalId);
  if (updErr) return NextResponse.json({ error: `Could not update proposal: ${updErr.message}` }, { status: 500 });

  await db.from('audit_log').insert({
    project_id: projectId,
    actor_id: user.id,
    action: body.action === 'approve' ? 'kb_scope_proposal_approved' : 'kb_scope_proposal_rejected',
    payload: {
      proposal_id: proposalId,
      kb_document_id: proposal.kb_document_id,
      proposed_scope: proposal.proposed_scope,
      final_scope: body.action === 'approve'
        ? (typeof body.scope_override === 'string' ? body.scope_override : proposal.proposed_scope)
        : null,
    },
  });

  return NextResponse.json({ ok: true, action: body.action });
}
