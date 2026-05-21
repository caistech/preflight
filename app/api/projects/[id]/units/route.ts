import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';
import { resolveProjectId } from '@/lib/project-resolver';

export const dynamic = 'force-dynamic';

interface UnitInput {
  unit_number: number;
  unit_type?: string | null;
  area_sqm?: number | null;
  ffl_m?: number | null;
  footing_system?: string | null;
  status?: 'active' | 'archived' | 'planned';
  source?: string | null;
  raw_row?: Record<string, unknown> | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idOrSlug } = await params;
  const { db, error } = await authenticateAndGetDb(request);
  if (error || !db) return NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 });
  const projectId = await resolveProjectId(db, idOrSlug);
  if (!projectId) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const { data, error: qErr } = await db
    .from('project_units')
    .select('id, unit_number, unit_type, area_sqm, ffl_m, footing_system, status, source, raw_row, created_at, updated_at')
    .eq('project_id', projectId)
    .order('unit_number', { ascending: true });

  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });
  return NextResponse.json({ units: data ?? [] });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idOrSlug } = await params;
  const { user, db, error } = await authenticateAndGetDb(request);
  if (error || !db || !user) return NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 });
  const projectId = await resolveProjectId(db, idOrSlug);
  if (!projectId) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  // Accept either { unit: UnitInput } or { units: UnitInput[] } for single
  // and bulk operations through the same route.
  const incoming: UnitInput[] = Array.isArray(body.units)
    ? body.units
    : body.unit
      ? [body.unit]
      : null;
  if (!incoming || incoming.length === 0) {
    return NextResponse.json({ error: 'Provide { unit } or { units: [...] }' }, { status: 400 });
  }

  // Validate each row before sending to the DB so a bad input doesn't
  // partially-apply.
  for (const u of incoming) {
    if (typeof u.unit_number !== 'number' || !Number.isInteger(u.unit_number) || u.unit_number < 1) {
      return NextResponse.json({ error: `unit_number must be a positive integer (got ${JSON.stringify(u.unit_number)})` }, { status: 400 });
    }
  }

  const rows = incoming.map((u) => ({
    project_id: projectId,
    unit_number: u.unit_number,
    unit_type: u.unit_type ?? null,
    area_sqm: u.area_sqm ?? null,
    ffl_m: u.ffl_m ?? null,
    footing_system: u.footing_system ?? null,
    status: u.status ?? 'active',
    source: u.source ?? 'manual',
    raw_row: u.raw_row ?? null,
  }));

  const { data, error: insErr } = await db
    .from('project_units')
    .upsert(rows, { onConflict: 'project_id,unit_number' })
    .select('id, unit_number, unit_type, area_sqm, ffl_m, footing_system, status');

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  await db.from('audit_log').insert({
    project_id: projectId,
    actor_id: user.id,
    action: 'project_units_upsert',
    payload: { count: rows.length, unit_numbers: rows.map((r) => r.unit_number) },
  });

  return NextResponse.json({ ok: true, units: data ?? [] });
}
