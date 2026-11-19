// POST /api/v1/projects/:id/rule-changes — what the owner has agreed, as a proposed change
// to the project's checking rules.
//
// Body: { said: string, saidBy?: string, saidOn?: "YYYY-MM-DD" }. `said` is the owner's own
// words, relayed verbatim (Kira → orchestrator, operation preflight.rules.propose_change).
//
// PROPOSES, NEVER APPLIES. The answer is a pending proposal in Preflight's rules queue —
// a change to the rule it amends, or a new rule. Nothing a check uses changes until the
// owner approves it in Preflight (migration 0030 replaces the old rule on approval). The
// message says exactly that, because it is read out to him as-is.

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { fail, projectForKey } from '@/lib/api-v1';
import { proposeRuleChange, type CurrentRule } from '@/lib/ai/rule-change-proposer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MIN_SAID_CHARS = 10;
const quoteShort = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const db = createServiceClient();
  const gate = await projectForKey(db, request, params.id);
  if ('response' in gate) return gate.response;

  const body = (await request.json().catch(() => null)) as { said?: unknown; saidBy?: unknown; saidOn?: unknown } | null;
  const said = typeof body?.said === 'string' ? body.said.trim() : '';
  if (said.length < MIN_SAID_CHARS) return fail(400, 'What was agreed? `said` needs the owner\'s words');
  const saidBy = typeof body?.saidBy === 'string' && body.saidBy.trim() ? body.saidBy.trim().slice(0, 80) : 'the project owner';
  const saidOn =
    typeof body?.saidOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.saidOn) ? body.saidOn : new Date().toISOString().slice(0, 10);

  const [{ data: rules, error: rulesErr }, { data: factRows }] = await Promise.all([
    db
      .from('register_rows')
      .select('id, requirement, source, check_type, check_spec, severity')
      .eq('project_id', gate.projectId)
      .eq('active', true),
    db.from('project_facts').select('key, value').eq('project_id', gate.projectId),
  ]);
  if (rulesErr) return fail(503, "Couldn't read the rules just now");
  const facts: Record<string, string> = {};
  for (const f of (factRows ?? []) as Array<{ key: string; value: string }>) facts[f.key] = f.value;

  const got = await proposeRuleChange(db, {
    projectId: gate.projectId,
    said,
    saidBy,
    saidOn,
    rules: (rules ?? []) as CurrentRule[],
    facts,
  });

  // `in`, not `.ok`: tsconfig has strict:false, which does not narrow on a boolean tag.
  if ('reason' in got) {
    const status = got.reason === 'no-change' || got.reason === 'invalid' ? 422 : 503;
    return fail(status, got.message, { reason: got.reason });
  }

  const where = `the ${gate.projectName} rules`;
  const message = got.duplicate
    ? `That change is already waiting for approval in Preflight, so nothing new was added to ${where}.`
    : got.amends
      ? `I've put that to Preflight as a change to ${where}: "${quoteShort(got.amends.requirement)}" would become "${quoteShort(got.proposal.requirement)}". It takes effect once it's approved in Preflight.`
      : `I've put that to Preflight as a new rule for ${where}: "${quoteShort(got.proposal.requirement)}". It takes effect once it's approved in Preflight.`;

  return NextResponse.json(
    {
      ok: true,
      candidateId: got.candidateId,
      duplicate: got.duplicate,
      amendsRuleId: got.amends?.id ?? null,
      proposed: { requirement: got.proposal.requirement, severity: got.proposal.severity },
      message,
    },
    { status: got.duplicate ? 200 : 201 },
  );
}
