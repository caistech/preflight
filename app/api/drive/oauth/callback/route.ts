import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';
import { exchangeCodeForTokens, getOAuthClient } from '@/lib/drive/client';
import { google } from 'googleapis';

export const dynamic = 'force-dynamic';

/**
 * Google Drive OAuth callback.
 *
 * 1. Verifies state cookie matches
 * 2. Exchanges the auth code for tokens
 * 3. Fetches the user's Google email so we can show "connected as X" in the UI
 * 4. Stores tokens (base64-JSON in encrypted_tokens column) + email
 * 5. Leaves folder_id null — operator picks a folder via the panel after connection
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

  // Fetch the connecting user's Google email — helpful as "connected as X" UI
  let email: string | null = null;
  try {
    const oauth = getOAuthClient();
    oauth.setCredentials(tokens);
    const userinfo = await google.oauth2({ version: 'v2', auth: oauth }).userinfo.get();
    email = userinfo.data.email ?? null;
  } catch {
    // non-fatal; the connection still works without the email shown in UI
  }

  const encrypted = Buffer.from(JSON.stringify(tokens), 'utf-8').toString('base64');

  await db.from('drive_connections').upsert(
    {
      project_id: projectId,
      encrypted_tokens: encrypted,
      email,
      paused: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'project_id' }
  );

  await db.from('audit_log').insert({
    project_id: projectId,
    actor_id: user.id,
    action: 'drive_connected',
    payload: { email, scopes: tokens.scope },
  });

  return NextResponse.redirect(`${origin}/projects/${projectId}?drive_connected=1`);
}
