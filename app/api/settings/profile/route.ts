import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data, error } = await supabase.rpc('get_my_profile');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // get_my_profile returns at most one row; null fields when no row.
  const profile = Array.isArray(data) ? data[0] ?? {} : data ?? {};
  return NextResponse.json({ profile, email: user.email });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  // Normalise — null/undefined leaves the existing value alone, empty string clears.
  const norm = (v: unknown) => {
    if (v === undefined) return null;
    if (typeof v === 'string') return v.trim();
    return v;
  };

  const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);

  const { error } = await supabase.rpc('update_my_profile', {
    p_first_name: norm(body.first_name),
    p_last_name: norm(body.last_name),
    p_phone: norm(body.phone),
    p_company: norm(body.company),
    p_job_title: norm(body.job_title),
    p_email_marketing_opt_in: bool(body.email_marketing_opt_in),
    p_email_review_queue: bool(body.email_review_queue),
    p_email_weekly_digest: bool(body.email_weekly_digest),
    p_email_project_alerts: bool(body.email_project_alerts),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
