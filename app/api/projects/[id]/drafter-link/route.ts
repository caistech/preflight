import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';
import { newDrafterToken } from '@/lib/drafter-token';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const { user, db, error } = await authenticateAndGetDb(request);
  if (error || !db || !user) {
    return NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const drafterName: string | null = body.drafter_name ?? null;
  const days = Math.min(90, Math.max(1, Number(body.days) || 14));

  const { data: project } = await db.from('projects').select('id, slug').eq('id', projectId).single();
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const { raw, hash } = newDrafterToken();
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const { error: insertErr } = await db.from('drafter_tokens').insert({
    project_id: projectId,
    token_hash: hash,
    drafter_name: drafterName,
    expires_at: expiresAt.toISOString(),
    created_by: user.id,
  });
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  await db.from('audit_log').insert({
    project_id: projectId,
    actor_id: user.id,
    action: 'drafter_link_issued',
    payload: { drafter_name: drafterName, expires_at: expiresAt.toISOString(), days },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  const url = `${appUrl}/drafter/${raw}`;
  return NextResponse.json({ ok: true, url, expires_at: expiresAt.toISOString() });
}
