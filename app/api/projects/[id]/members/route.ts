import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';
import { createClient } from '@/lib/supabase/server';
import { resolveProjectId } from '@/lib/project-resolver';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idOrSlug } = await params;
  const { db, error } = await authenticateAndGetDb(request);
  if (error || !db) return NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 });
  const projectId = await resolveProjectId(db, idOrSlug);
  if (!projectId) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  // Use the user-scoped client so RLS via current_user_project_ids() inside
  // list_project_members filters correctly to the calling user.
  const userClient = await createClient();
  const { data, error: rpcErr } = await userClient.rpc('list_project_members', { in_project_id: projectId });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  return NextResponse.json({ members: data ?? [] });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idOrSlug } = await params;
  const { user, db, error } = await authenticateAndGetDb(request);
  if (error || !db || !user) return NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 });
  const projectId = await resolveProjectId(db, idOrSlug);
  if (!projectId) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const userClient = await createClient();
  const { data: isOwner } = await userClient.rpc('caller_is_project_owner', { in_project_id: projectId });
  if (!isOwner) return NextResponse.json({ error: 'Only project owners can add members' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const role = body.role === 'owner' ? 'owner' : 'member';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Provide a valid email address' }, { status: 400 });
  }

  // Look up the user. We don't auto-create — they have to sign in once
  // (Supabase magic link / signup) before they can be added.
  const { data: targetUserId } = await userClient.rpc('find_user_id_by_email', { in_email: email });
  if (!targetUserId) {
    return NextResponse.json(
      {
        error: `No registered user with email ${email}. They need to sign in once at /login (magic link) before you can add them.`,
      },
      { status: 404 },
    );
  }

  const { error: insErr } = await db
    .from('project_memberships')
    .upsert({ project_id: projectId, user_id: targetUserId, role }, { onConflict: 'project_id,user_id' });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  await db.from('audit_log').insert({
    project_id: projectId,
    actor_id: user.id,
    action: 'member_added',
    payload: { added_user_id: targetUserId, email, role },
  });

  return NextResponse.json({ ok: true, user_id: targetUserId, role });
}
