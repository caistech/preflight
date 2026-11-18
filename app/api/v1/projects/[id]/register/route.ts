// GET /api/v1/projects/:id/register — what a check on this project will actually
// test. Read before a run so "does it check the carport?" has a true answer.

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { fail, projectForKey } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const db = createServiceClient();
  const gate = await projectForKey(db, request, params.id);
  if ('response' in gate) return gate.response;

  const { data, error } = await db
    .from('register_rows')
    .select('id, requirement, source, check_type, severity')
    .eq('project_id', gate.projectId)
    .eq('active', true)
    .order('created_at', { ascending: true });
  if (error) return fail(503, "Couldn't read the rules just now");

  return NextResponse.json({ ok: true, rules: data ?? [] });
}
