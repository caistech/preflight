import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';
import { createClient } from '@/lib/supabase/server';
import { resolveProjectId } from '@/lib/project-resolver';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const { id: idOrSlug, userId } = await params;
  const { user, db, error } = await authenticateAndGetDb(request);
  if (error || !db || !user) return NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 });
  const projectId = await resolveProjectId(db, idOrSlug);
  if (!projectId) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const userClient = await createClient();
  const { data: isOwner } = await userClient.rpc('caller_is_project_owner', { in_project_id: projectId });
  if (!isOwner) return NextResponse.json({ error: 'Only project owners can change member roles' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body || (body.role !== 'owner' && body.role !== 'member')) {
    return NextResponse.json({ error: 'role must be "owner" or "member"' }, { status: 400 });
  }

  // Demoting the last owner would orphan the project. Block it.
  if (body.role === 'member') {
    const { data: ownerCount } = await userClient.rpc('count_project_owners', { in_project_id: projectId });
    const { data: target } = await db
      .from('project_memberships')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .single();
    if (target?.role === 'owner' && (ownerCount ?? 0) <= 1) {
      return NextResponse.json(
        { error: 'Cannot demote the last owner — add a second owner first.' },
        { status: 409 },
      );
    }
  }

  const { error: updErr } = await db
    .from('project_memberships')
    .update({ role: body.role })
    .eq('project_id', projectId)
    .eq('user_id', userId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  await db.from('audit_log').insert({
    project_id: projectId,
    actor_id: user.id,
    action: 'member_role_changed',
    payload: { target_user_id: userId, new_role: body.role },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const { id: idOrSlug, userId } = await params;
  const { user, db, error } = await authenticateAndGetDb(request);
  if (error || !db || !user) return NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 });
  const projectId = await resolveProjectId(db, idOrSlug);
  if (!projectId) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const userClient = await createClient();
  const { data: isOwner } = await userClient.rpc('caller_is_project_owner', { in_project_id: projectId });
  if (!isOwner) return NextResponse.json({ error: 'Only project owners can remove members' }, { status: 403 });

  // Last-owner protection.
  const { data: target } = await db
    .from('project_memberships')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .single();
  if (target?.role === 'owner') {
    const { data: ownerCount } = await userClient.rpc('count_project_owners', { in_project_id: projectId });
    if ((ownerCount ?? 0) <= 1) {
      return NextResponse.json(
        { error: 'Cannot remove the last owner — add a second owner first or delete the project.' },
        { status: 409 },
      );
    }
  }

  const { error: delErr } = await db
    .from('project_memberships')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  await db.from('audit_log').insert({
    project_id: projectId,
    actor_id: user.id,
    action: 'member_removed',
    payload: { removed_user_id: userId },
  });

  return NextResponse.json({ ok: true });
}
