import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';
import { generateAuthUrl } from '@/lib/drive/client';

export const dynamic = 'force-dynamic';

/**
 * Start the Google Drive OAuth flow.
 *
 * GET /api/drive/oauth?project_id=<uuid>
 * Issues a `state` cookie binding the in-flight OAuth to the project so the
 * callback can attach the resulting tokens to the right project.
 */
export async function GET(request: NextRequest) {
  const { user, error } = await authenticateAndGetDb(request);
  if (error || !user) return NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('project_id');
  if (!projectId) return NextResponse.json({ error: 'project_id required' }, { status: 400 });

  const state = `${projectId}.${user.id}.${Date.now()}`;
  let url: string;
  try {
    url = generateAuthUrl(state);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const response = NextResponse.redirect(url);
  response.cookies.set('preflight_drive_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    maxAge: 600,
  });
  return response;
}
