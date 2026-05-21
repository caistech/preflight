import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  const current = typeof body.current_password === 'string' ? body.current_password : null;
  const next = typeof body.new_password === 'string' ? body.new_password : null;

  if (!current || !next) {
    return NextResponse.json({ error: 'Provide current_password and new_password' }, { status: 400 });
  }
  if (next.length < 8) {
    return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 });
  }

  // Re-authenticate with the current password before updating. Supabase
  // updateUser doesn't require this but doing it explicitly prevents a
  // stolen session token from rotating the password.
  if (!user.email) {
    return NextResponse.json({ error: 'Account has no email — cannot verify current password' }, { status: 400 });
  }
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: current,
  });
  if (signInErr) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
  }

  const { error: updErr } = await supabase.auth.updateUser({ password: next });
  if (updErr) {
    return NextResponse.json({ error: `Could not update password: ${updErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
