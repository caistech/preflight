// GET /api/v1/projects — the projects this API key may check, so "Lot 91" can be
// resolved to exactly one project before anything runs.

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authenticateApiKey } from '@/lib/api-key';
import { fail } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const db = createServiceClient();
  const auth = await authenticateApiKey(db, request);
  if ('error' in auth) return fail(auth.status, auth.error);
  if (auth.key.project_ids.length === 0) return NextResponse.json({ ok: true, projects: [] });

  const { data: projects, error } = await db
    .from('projects')
    .select('id, name, slug')
    .in('id', auth.key.project_ids);
  if (error) return fail(503, "Couldn't read the projects just now");

  const { data: rules, error: rulesError } = await db
    .from('register_rows')
    .select('project_id')
    .in('project_id', auth.key.project_ids)
    .eq('active', true);
  if (rulesError) return fail(503, "Couldn't read the projects just now");

  const counts = new Map<string, number>();
  for (const r of rules ?? []) counts.set(r.project_id, (counts.get(r.project_id) ?? 0) + 1);

  return NextResponse.json({
    ok: true,
    projects: (projects ?? []).map((p) => ({ id: p.id, name: p.name, slug: p.slug, activeRules: counts.get(p.id) ?? 0 })),
  });
}
