import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';
import { resolveProjectId } from '@/lib/project-resolver';

export const dynamic = 'force-dynamic';

/**
 * PATCH resolves a fact candidate: approve → upsert into project_facts,
 * reject → just flip status. Both write resolved_by/at and an audit-log
 * entry so the operator's actions are traceable.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; candidateId: string }> },
) {
  const { id: idOrSlug, candidateId } = await params;
  const { user, db, error } = await authenticateAndGetDb(request);
  if (error || !db || !user) return NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 });
  const projectId = await resolveProjectId(db, idOrSlug);
  if (!projectId) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body || (body.action !== 'approve' && body.action !== 'reject')) {
    return NextResponse.json({ error: 'Provide { action: "approve" | "reject", note?: string, value_override?: string }' }, { status: 400 });
  }

  const { data: candidate, error: fetchErr } = await db
    .from('fact_candidates')
    .select('id, project_id, proposed_key, proposed_value, status, source_document_id')
    .eq('id', candidateId)
    .eq('project_id', projectId)
    .single();
  if (fetchErr || !candidate) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }
  if (candidate.status !== 'pending') {
    return NextResponse.json({ error: `Already ${candidate.status}; cannot re-resolve` }, { status: 409 });
  }

  if (body.action === 'approve') {
    // Operator may override the proposed value at approval time — useful when
    // the LLM extracted the right concept but with a slightly wrong wording.
    const valueToWrite: string =
      typeof body.value_override === 'string' && body.value_override.trim().length > 0
        ? body.value_override.trim()
        : candidate.proposed_value;

    // If a fact with this key already exists, supersede it. The old fact's
    // value gets overwritten; the audit log captures the change.
    const { error: factErr } = await db
      .from('project_facts')
      .upsert(
        {
          project_id: projectId,
          key: candidate.proposed_key,
          value: valueToWrite,
          source: candidate.source_document_id
            ? `fact_candidate:${candidate.id}`
            : 'manual',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'project_id,key' },
      );
    if (factErr) return NextResponse.json({ error: `Could not write fact: ${factErr.message}` }, { status: 500 });
  }

  const { error: updErr } = await db
    .from('fact_candidates')
    .update({
      status: body.action === 'approve' ? 'approved' : 'rejected',
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
      resolution_note: typeof body.note === 'string' ? body.note.slice(0, 500) : null,
    })
    .eq('id', candidateId)
    .eq('project_id', projectId);
  if (updErr) return NextResponse.json({ error: `Could not update candidate: ${updErr.message}` }, { status: 500 });

  await db.from('audit_log').insert({
    project_id: projectId,
    actor_id: user.id,
    action: body.action === 'approve' ? 'fact_candidate_approved' : 'fact_candidate_rejected',
    payload: {
      candidate_id: candidateId,
      key: candidate.proposed_key,
      value: body.action === 'approve' ? (body.value_override ?? candidate.proposed_value) : candidate.proposed_value,
      note: body.note ?? null,
    },
  });

  return NextResponse.json({ ok: true, action: body.action });
}
