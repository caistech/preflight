import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';
import { resolveProjectId } from '@/lib/project-resolver';

export const dynamic = 'force-dynamic';

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
    return NextResponse.json({ error: 'Provide { action: "approve" | "reject", note?, edits? }' }, { status: 400 });
  }

  const { data: candidate, error: fetchErr } = await db
    .from('register_row_candidates')
    .select('id, project_id, proposed_requirement, proposed_source, proposed_source_url, proposed_check_type, proposed_check_spec, proposed_severity, status, amends_register_row_id')
    .eq('id', candidateId)
    .eq('project_id', projectId)
    .single();
  if (fetchErr || !candidate) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  if (candidate.status !== 'pending') {
    return NextResponse.json({ error: `Already ${candidate.status}` }, { status: 409 });
  }

  // A CHANGE TO AN EXISTING RULE replaces it: one database function switches the old
  // rule off, adds the new wording linked to it, and approves the candidate — all or
  // nothing (migration 0030). Never the two-step insert below, which would leave the
  // stale rule running beside the new one.
  if (body.action === 'approve' && candidate.amends_register_row_id) {
    const edits = (body.edits ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    const { data: newRowId, error: rpcErr } = await db.rpc('approve_register_amendment', {
      in_candidate_id: candidateId,
      in_note: str(body.note),
      in_requirement: str(edits.requirement),
      in_source: str(edits.source),
      in_source_url: str(edits.source_url),
      in_check_type: str(edits.check_type),
      in_check_spec: edits.check_spec && typeof edits.check_spec === 'object' ? edits.check_spec : null,
      in_severity: str(edits.severity),
    });
    if (rpcErr) {
      const status = /^already /.test(rpcErr.message) ? 409 : /not found|not in this project/.test(rpcErr.message) ? 404 : 500;
      return NextResponse.json({ error: rpcErr.message }, { status });
    }
    await db.from('audit_log').insert({
      project_id: projectId,
      actor_id: user.id,
      action: 'register_row_amendment_approved',
      payload: {
        candidate_id: candidateId,
        resulting_register_row_id: newRowId,
        superseded_register_row_id: candidate.amends_register_row_id,
      },
    });
    return NextResponse.json({
      ok: true,
      action: 'approve',
      register_row_id: newRowId,
      superseded_register_row_id: candidate.amends_register_row_id,
    });
  }

  let registerRowId: string | null = null;
  if (body.action === 'approve') {
    // Operator may override any field at approval time.
    const edits = (body.edits ?? {}) as Partial<{
      requirement: string;
      source: string;
      source_url: string | null;
      check_type: string;
      check_spec: Record<string, unknown>;
      severity: string;
    }>;

    const final = {
      project_id: projectId,
      requirement: (edits.requirement ?? candidate.proposed_requirement).trim(),
      source: (edits.source ?? candidate.proposed_source).trim(),
      source_url: edits.source_url ?? candidate.proposed_source_url ?? null,
      check_type: edits.check_type ?? candidate.proposed_check_type,
      check_spec: edits.check_spec ?? candidate.proposed_check_spec,
      severity: edits.severity ?? candidate.proposed_severity,
      active: true,
    };

    const { data: inserted, error: insErr } = await db
      .from('register_rows')
      .insert(final)
      .select('id')
      .single();
    if (insErr || !inserted) {
      return NextResponse.json({ error: `Could not create register row: ${insErr?.message}` }, { status: 500 });
    }
    registerRowId = inserted.id;
  }

  const { error: updErr } = await db
    .from('register_row_candidates')
    .update({
      status: body.action === 'approve' ? 'approved' : 'rejected',
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
      resolution_note: typeof body.note === 'string' ? body.note.slice(0, 500) : null,
      resulting_register_row_id: registerRowId,
    })
    .eq('id', candidateId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  await db.from('audit_log').insert({
    project_id: projectId,
    actor_id: user.id,
    action: body.action === 'approve' ? 'register_row_candidate_approved' : 'register_row_candidate_rejected',
    payload: {
      candidate_id: candidateId,
      resulting_register_row_id: registerRowId,
    },
  });

  return NextResponse.json({ ok: true, action: body.action, register_row_id: registerRowId });
}
