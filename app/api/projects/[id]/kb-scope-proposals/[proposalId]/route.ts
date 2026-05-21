import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/supabase/auth';
import { resolveProjectId } from '@/lib/project-resolver';
import { proposeFactsFromDocument } from '@/lib/ai/facts-proposer';
import { proposeRuleFromDecision } from '@/lib/ai/rule-proposer';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * PATCH resolves a kb scope proposal: approve → updates kb_documents.scope
 * (+ scope_applies_when for cross-project) and supersedes any older
 * pending proposal for the same doc. Reject → just flips status.
 *
 * Supports operator override of both fields:
 *   - scope_override: 'project' | 'cross-project' | 'general'  (defaults to proposal)
 *   - applies_when_override: { ... }                            (defaults to proposal)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; proposalId: string }> },
) {
  const { id: idOrSlug, proposalId } = await params;
  const { user, db, error } = await authenticateAndGetDb(request);
  if (error || !db || !user) return NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 });
  const projectId = await resolveProjectId(db, idOrSlug);
  if (!projectId) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body || (body.action !== 'approve' && body.action !== 'reject')) {
    return NextResponse.json({ error: 'Provide { action: "approve" | "reject", scope_override?, applies_when_override?, note? }' }, { status: 400 });
  }

  const { data: proposal, error: fetchErr } = await db
    .from('kb_scope_proposals')
    .select('id, project_id, kb_document_id, proposed_scope, proposed_applies_when, status')
    .eq('id', proposalId)
    .eq('project_id', projectId)
    .single();
  if (fetchErr || !proposal) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  if (proposal.status !== 'pending') {
    return NextResponse.json({ error: `Already ${proposal.status}; cannot re-resolve` }, { status: 409 });
  }

  if (body.action === 'approve') {
    const finalScope: string =
      typeof body.scope_override === 'string' &&
      ['project', 'cross-project', 'general'].includes(body.scope_override)
        ? body.scope_override
        : proposal.proposed_scope;

    const finalAppliesWhen =
      finalScope === 'cross-project'
        ? body.applies_when_override ?? proposal.proposed_applies_when ?? null
        : null;

    if (finalScope === 'cross-project' && (!finalAppliesWhen || Object.keys(finalAppliesWhen).length === 0)) {
      return NextResponse.json({ error: 'cross-project scope requires a non-empty applies_when filter' }, { status: 400 });
    }

    const { error: updDocErr } = await db
      .from('kb_documents')
      .update({
        scope: finalScope,
        scope_applies_when: finalAppliesWhen,
      })
      .eq('id', proposal.kb_document_id);
    if (updDocErr) return NextResponse.json({ error: `Could not update document scope: ${updDocErr.message}` }, { status: 500 });

    // Cross-project propagation. When a doc gets promoted above project
    // scope, fan out the facts proposer to every sibling project that
    // matches the scope — each sibling gets candidate facts on its own
    // panel scoped to that sibling's existing facts. Operator approves
    // per-sibling, keeping the human-in-the-loop guardrail.
    if (finalScope === 'cross-project' || finalScope === 'general') {
      try {
        await propagateToSiblings(db, {
          sourceProjectId: projectId,
          kbDocumentId: proposal.kb_document_id,
          scope: finalScope,
          appliesWhen: finalAppliesWhen,
        });
      } catch (e) {
        // Propagation failure must not block the approval — log and proceed.
        console.error(`[kb-scope-approve] propagation failed: ${(e as Error).message}`);
      }
    }
  }

  const { error: updErr } = await db
    .from('kb_scope_proposals')
    .update({
      status: body.action === 'approve' ? 'approved' : 'rejected',
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
      resolution_note: typeof body.note === 'string' ? body.note.slice(0, 500) : null,
    })
    .eq('id', proposalId);
  if (updErr) return NextResponse.json({ error: `Could not update proposal: ${updErr.message}` }, { status: 500 });

  await db.from('audit_log').insert({
    project_id: projectId,
    actor_id: user.id,
    action: body.action === 'approve' ? 'kb_scope_proposal_approved' : 'kb_scope_proposal_rejected',
    payload: {
      proposal_id: proposalId,
      kb_document_id: proposal.kb_document_id,
      proposed_scope: proposal.proposed_scope,
      final_scope: body.action === 'approve'
        ? (typeof body.scope_override === 'string' ? body.scope_override : proposal.proposed_scope)
        : null,
    },
  });

  return NextResponse.json({ ok: true, action: body.action });
}

/**
 * Fan-out the facts proposer to every sibling project that matches the
 * promoted document's scope. The proposer runs per-sibling so each
 * sibling's existing facts are considered (avoiding duplicate proposals)
 * and so the operator approves on a per-project basis.
 *
 * For cross-project: a sibling matches when its facts are a superset of
 * applies_when. For general: every sibling matches.
 */
async function propagateToSiblings(
  db: import('@supabase/supabase-js').SupabaseClient,
  args: {
    sourceProjectId: string;
    kbDocumentId: string;
    scope: 'cross-project' | 'general';
    appliesWhen: Record<string, string> | null;
  },
) {
  // Load the doc once so both proposers can run on its content.
  const { data: doc } = await db
    .from('kb_documents')
    .select('id, title, content, source_kind, source_ref')
    .eq('id', args.kbDocumentId)
    .single();
  if (!doc || !doc.content) return;

  // For operator-decision docs created from a promote_to_rule review, the
  // source_ref carries "review:<decision_id>" — we use this to backlink
  // candidate register_rows to the originating decision. For other docs,
  // we only fan out facts.
  let sourceDecisionId: string | null = null;
  if (doc.source_kind === 'operator-decision' && typeof doc.source_ref === 'string') {
    const m = doc.source_ref.match(/^review:([0-9a-f-]{36})$/i);
    if (m) sourceDecisionId = m[1];
  }
  const isPromoteToRuleDoc = sourceDecisionId !== null;

  // Load every project's facts in one query then build a per-project map.
  const { data: allFactRows } = await db
    .from('project_facts')
    .select('project_id, key, value');
  const factsByProject = new Map<string, Record<string, string>>();
  for (const f of allFactRows ?? []) {
    if (!factsByProject.has(f.project_id)) factsByProject.set(f.project_id, {});
    factsByProject.get(f.project_id)![f.key] = f.value;
  }

  // Resolve the candidate sibling list.
  const { data: allProjects } = await db.from('projects').select('id');
  const candidates: Array<{ id: string; facts: Record<string, string> }> = [];
  for (const p of allProjects ?? []) {
    if (p.id === args.sourceProjectId) continue;
    const facts = factsByProject.get(p.id) ?? {};
    if (args.scope === 'general') {
      candidates.push({ id: p.id, facts });
    } else if (args.scope === 'cross-project' && args.appliesWhen) {
      const matches = Object.entries(args.appliesWhen).every(([k, v]) => facts[k] === v);
      if (matches) candidates.push({ id: p.id, facts });
    }
  }

  if (candidates.length === 0) return;

  // Fan out per sibling. Always run the facts proposer. Additionally, for
  // promote_to_rule-derived docs, also run the rule proposer so each
  // sibling gets a register_row candidate alongside the facts.
  await Promise.all(
    candidates.flatMap((sibling) => {
      const tasks: Array<Promise<unknown>> = [];
      tasks.push(
        proposeFactsFromDocument(db, {
          documentId: args.kbDocumentId,
          projectId: sibling.id,
          documentTitle: doc.title ?? '(untitled)',
          documentContent: doc.content,
          existingFacts: sibling.facts,
        }).catch((e) => {
          console.error(`[kb-scope-approve] sibling ${sibling.id} facts-proposer failed: ${(e as Error).message}`);
        }),
      );
      if (isPromoteToRuleDoc) {
        tasks.push(
          proposeRuleFromDecision(db, {
            documentId: args.kbDocumentId,
            projectId: sibling.id,
            sourceProjectId: args.sourceProjectId,
            sourceDecisionId,
            documentTitle: doc.title ?? '(untitled)',
            documentContent: doc.content,
            projectFacts: sibling.facts,
          }).catch((e) => {
            console.error(`[kb-scope-approve] sibling ${sibling.id} rule-proposer failed: ${(e as Error).message}`);
          }),
        );
      }
      return tasks;
    }),
  );

  await db.from('audit_log').insert({
    project_id: args.sourceProjectId,
    actor_id: null,
    action: 'kb_scope_propagated',
    payload: {
      kb_document_id: args.kbDocumentId,
      scope: args.scope,
      applies_when: args.appliesWhen,
      sibling_project_ids: candidates.map((c) => c.id),
      included_rule_proposer: isPromoteToRuleDoc,
      source_decision_id: sourceDecisionId,
    },
  });
}
