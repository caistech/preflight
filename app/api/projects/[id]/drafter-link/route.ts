import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';
import { newDrafterToken } from '@/lib/drafter-token';
import { sendDrafterLinkEmail } from '@/lib/email/drafter-link';
import { resolveProjectId } from '@/lib/project-resolver';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idOrSlug } = await params;
  const { user, db, error } = await authenticateAndGetDb(request);
  if (error || !db || !user) {
    return NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 });
  }
  const projectId = await resolveProjectId(db, idOrSlug);
  if (!projectId) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const drafterName: string | null = body.drafter_name ?? null;
  const drafterEmail: string | null = body.drafter_email ?? null;
  const days = Math.min(90, Math.max(1, Number(body.days) || 14));

  const { data: project } = await db
    .from('projects')
    .select('id, slug, name, owner_label, council, upload_instructions')
    .eq('id', projectId)
    .single();
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  // Pull address from project_facts (kept in facts so rule evaluation can gate on it)
  const { data: addressFact } = await db
    .from('project_facts')
    .select('value')
    .eq('project_id', projectId)
    .eq('key', 'address_summary')
    .single();
  const address = addressFact?.value ?? null;

  const { raw, hash } = newDrafterToken();
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const { error: insertErr } = await db.from('drafter_tokens').insert({
    project_id: projectId,
    token_hash: hash,
    drafter_name: drafterName,
    drafter_email: drafterEmail,
    expires_at: expiresAt.toISOString(),
    created_by: user.id,
  });
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  const url = `${appUrl}/drafter/${raw}`;

  let emailSent: { ok: boolean; error?: string; id?: string } | null = null;
  if (drafterEmail) {
    emailSent = await sendDrafterLinkEmail({
      to: drafterEmail,
      drafterName,
      projectName: project.name,
      ownerLabel: project.owner_label,
      council: project.council,
      address,
      uploadInstructions: project.upload_instructions,
      url,
      expiresAt,
      ownerEmail: user.email ?? null,
    });
  }

  await db.from('audit_log').insert({
    project_id: projectId,
    actor_id: user.id,
    action: 'drafter_link_issued',
    payload: {
      drafter_name: drafterName,
      drafter_email: drafterEmail,
      expires_at: expiresAt.toISOString(),
      days,
      email_sent: emailSent?.ok ?? null,
      email_error: emailSent?.error ?? null,
    },
  });

  return NextResponse.json({
    ok: true,
    url,
    expires_at: expiresAt.toISOString(),
    email_sent: emailSent?.ok ?? false,
    email_error: emailSent?.error ?? null,
  });
}
