import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

interface AddressBody {
  formatted_address: string;
  latitude?: number | null;
  longitude?: number | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const { user, db, error } = await authenticateAndGetDb(request);
  if (error || !db || !user) {
    return NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as AddressBody;
  const formatted = (body.formatted_address ?? '').trim();
  if (!formatted) return NextResponse.json({ error: 'formatted_address required' }, { status: 400 });

  const { data: project } = await db.from('projects').select('id').eq('id', projectId).single();
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const facts: { key: string; value: string; source: string }[] = [
    { key: 'address_summary', value: formatted, source: 'Mapbox autocomplete' },
  ];
  if (body.latitude != null) facts.push({ key: 'address_latitude', value: String(body.latitude), source: 'Mapbox autocomplete' });
  if (body.longitude != null) facts.push({ key: 'address_longitude', value: String(body.longitude), source: 'Mapbox autocomplete' });
  if (body.suburb) facts.push({ key: 'address_suburb', value: body.suburb, source: 'Mapbox autocomplete' });
  if (body.state) facts.push({ key: 'address_state', value: body.state, source: 'Mapbox autocomplete' });
  if (body.postcode) facts.push({ key: 'address_postcode', value: body.postcode, source: 'Mapbox autocomplete' });

  for (const f of facts) {
    const { error: upErr } = await db.from('project_facts').upsert(
      { project_id: projectId, key: f.key, value: f.value, source: f.source, updated_at: new Date().toISOString() },
      { onConflict: 'project_id,key' }
    );
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  await db.from('audit_log').insert({
    project_id: projectId,
    actor_id: user.id,
    action: 'project_address_updated',
    payload: body as unknown as Record<string, unknown>,
  });

  return NextResponse.json({ ok: true, facts });
}
