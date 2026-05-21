/**
 * Delete the calling user's account.
 *
 * Requires the user to type their own email in the request body so an
 * accidental form submission can't nuke the account. Blocks the delete if
 * the user is the only owner on any project — otherwise that project would
 * be orphaned and unreachable. Operator must first add another owner or
 * delete the project.
 *
 * On success: cascading deletes via FK clean profiles, project_memberships,
 * check_result_decisions (decided_by_user_id → set null), and so on per
 * the migrations. supabase.auth.admin.deleteUser is the trigger.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  const confirmation = typeof body.email_confirmation === 'string'
    ? body.email_confirmation.trim().toLowerCase()
    : '';
  if (!user.email || confirmation !== user.email.toLowerCase()) {
    return NextResponse.json(
      { error: 'Email confirmation does not match. Type your account email exactly to delete.' },
      { status: 400 },
    );
  }

  const admin = createServiceClient();

  // Last-owner check across every project the user owns. If any project
  // would lose its last owner, refuse with a list.
  const { data: ownerships } = await admin
    .from('project_memberships')
    .select('project_id, projects(name, slug)')
    .eq('user_id', user.id)
    .eq('role', 'owner');

  const orphaned: Array<{ name: string; slug: string }> = [];
  for (const row of ownerships ?? []) {
    const { count } = await admin
      .from('project_memberships')
      .select('user_id', { count: 'exact', head: true })
      .eq('project_id', row.project_id)
      .eq('role', 'owner');
    if ((count ?? 0) <= 1) {
      const projectField = (row as { projects?: { name?: string; slug?: string } | Array<{ name?: string; slug?: string }> }).projects;
      const project = Array.isArray(projectField) ? projectField[0] : projectField;
      orphaned.push({
        name: project?.name ?? 'unnamed',
        slug: project?.slug ?? row.project_id,
      });
    }
  }

  if (orphaned.length > 0) {
    return NextResponse.json(
      {
        error: 'You are the only owner on one or more projects — add another owner or delete the project first.',
        orphaned_projects: orphaned,
      },
      { status: 409 },
    );
  }

  // Best-effort audit log BEFORE the auth.admin.deleteUser, since
  // audit_log.actor_id references auth.users which is about to be gone.
  // We capture the action with the resolved email so the trail survives.
  await admin.from('audit_log').insert({
    project_id: null,
    actor_id: user.id,
    action: 'account_deleted',
    payload: { email: user.email },
  });

  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) {
    return NextResponse.json({ error: `Could not delete account: ${delErr.message}` }, { status: 500 });
  }

  // Sign the local cookie out so the redirect to / doesn't keep a phantom
  // session referencing a deleted user.
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
