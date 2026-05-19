import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';
import { exchangeCodeForTokens } from '@/lib/drive/client';

export const dynamic = 'force-dynamic';

/**
 * Google Drive OAuth callback.
 *
 * Verifies the state cookie matches, exchanges the auth code for tokens,
 * persists a drive_connections row scoped to the project.
 */
export async function GET(request: NextRequest) {
  const { user, db, error } = await authenticateAndGetDb(request);
  if (error || !db || !user) return NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 });

  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const cookieState = request.cookies.get('preflight_drive_state')?.value;

  if (!code || !state) {
    return NextResponse.redirect(`${origin}/projects?drive_error=missing_code`);
  }
  if (!cookieState || cookieState !== state) {
    return NextResponse.redirect(`${origin}/projects?drive_error=state_mismatch`);
  }

  const [projectId] = state.split('.');
  if (!projectId) {
    return NextResponse.redirect(`${origin}/projects?drive_error=bad_state`);
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (e) {
    return NextResponse.redirect(
      `${origin}/projects/${projectId}?drive_error=${encodeURIComponent((e as Error).message)}`
    );
  }

  await db.from('drive_connections').upsert(
    {
      project_id: projectId,
      access_token: tokens.access_token ?? '',
      refresh_token: tokens.refresh_token ?? '',
      token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      scopes: tokens.scope ? tokens.scope.split(' ') : [],
      google_user_id: null,
      google_email: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'project_id,google_user_id' }
  );

  await db.from('audit_log').insert({
    project_id: projectId,
    actor_id: user.id,
    action: 'drive_connected',
    payload: { scopes: tokens.scope },
  });

  return NextResponse.redirect(`${origin}/projects/${projectId}?drive_connected=1`);
}
