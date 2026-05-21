/**
 * Sign out of every active session for the calling user.
 *
 * Uses the service-role admin client to revoke ALL refresh tokens
 * (scope='global'), then signs the current request out too so the
 * operator lands on /login fresh. Useful when you suspect a session
 * has leaked or you want to force a re-login on every device.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const admin = createServiceClient();
  // signOut with scope='global' revokes every refresh token for this user
  // — every device gets booted to /login on its next request.
  const { error } = await admin.auth.admin.signOut(user.id, 'global');
  if (error) return NextResponse.json({ error: `Could not revoke sessions: ${error.message}` }, { status: 500 });

  // Sign out the current cookie-session too so the redirect lands cleanly.
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'), 303);
}
