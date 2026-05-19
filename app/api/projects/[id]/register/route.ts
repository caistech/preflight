import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

interface AddRuleBody {
  requirement: string;
  source: string;
  source_url?: string | null;
  severity: 'hard-fail' | 'review' | 'informational';
  // v0: manual-check is the only check_type the UI form creates.
  // text-rule + logic-rule still need code-level support to add via UI;
  // they continue to live in seed-rules.ts + scripts for now.
  check_type: 'manual-check';
  prompt: string;
  context_hints?: string[];
  use_kb_retrieval?: boolean;
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

  const body = (await request.json().catch(() => ({}))) as AddRuleBody;
  const requirement = (body.requirement ?? '').trim();
  const source = (body.source ?? '').trim();
  const prompt = (body.prompt ?? '').trim();
  const severity = body.severity ?? 'review';

  if (!requirement || requirement.length < 20) {
    return NextResponse.json({ error: 'Requirement must be at least 20 characters — describe the check clearly' }, { status: 400 });
  }
  if (!source) {
    return NextResponse.json({ error: 'Source attribution is required (where the rule came from)' }, { status: 400 });
  }
  if (!prompt || prompt.length < 30) {
    return NextResponse.json({ error: 'Prompt must be at least 30 characters — the LLM needs a clear question' }, { status: 400 });
  }
  if (!['hard-fail', 'review', 'informational'].includes(severity)) {
    return NextResponse.json({ error: 'Invalid severity' }, { status: 400 });
  }

  const { data: project } = await db.from('projects').select('id').eq('id', projectId).single();
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const check_spec = {
    kind: 'manual-check' as const,
    prompt,
    context_hints: body.context_hints ?? [],
    use_kb_retrieval: body.use_kb_retrieval ?? true,
    max_answer_chars: 500,
  };

  const { data: row, error: insErr } = await db
    .from('register_rows')
    .insert({
      project_id: projectId,
      requirement,
      source,
      source_url: body.source_url ?? null,
      check_type: 'manual-check',
      check_spec,
      severity,
      active: true,
    })
    .select('id')
    .single();
  if (insErr || !row) {
    return NextResponse.json({ error: insErr?.message ?? 'Insert failed' }, { status: 500 });
  }

  await db.from('audit_log').insert({
    project_id: projectId,
    actor_id: user.id,
    action: 'register_row_added',
    payload: { row_id: row.id, requirement, source, severity, check_type: 'manual-check' },
  });

  return NextResponse.json({ ok: true, id: row.id });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const { user, db, error } = await authenticateAndGetDb(request);
  if (error || !db || !user) {
    return NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const rowId = body.row_id as string | undefined;
  const active = body.active as boolean | undefined;
  if (!rowId || typeof active !== 'boolean') {
    return NextResponse.json({ error: 'row_id + active required' }, { status: 400 });
  }

  const { error: upErr } = await db
    .from('register_rows')
    .update({ active })
    .eq('id', rowId)
    .eq('project_id', projectId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  await db.from('audit_log').insert({
    project_id: projectId,
    actor_id: user.id,
    action: active ? 'register_row_enabled' : 'register_row_disabled',
    payload: { row_id: rowId },
  });

  return NextResponse.json({ ok: true });
}
