/**
 * WHAT THE OWNER AGREED, AS A PROPOSED CHANGE TO THE RULES.
 *
 * The register is only as good as its agreement with what the owner actually decided.
 * On Lot 91 the written scope said the carport and deck may not fix to the module; the
 * owner and the engineer later agreed verbally that they could. Preflight kept failing
 * a correct design against the stale rule, and nothing recorded the change.
 *
 * This takes the owner's own words (relayed verbatim by Kira through the orchestrator)
 * and the project's current rules, and proposes ONE of:
 *   - a change to an existing rule  → candidate with amends_register_row_id (approval
 *     replaces that rule, migration 0030), or
 *   - a new rule, when no existing rule covers what he said.
 *
 * Never writes a rule. The proposal lands PENDING in register_row_candidates and takes
 * effect only when the owner approves it in Preflight — the same human gate every other
 * proposal goes through. His words are kept verbatim on the proposal, so whoever
 * approves it can see exactly what was said.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { anthropic, MODEL_MANUAL_CHECK } from './anthropic';
import { proposalProblem, type RuleProposal } from './rule-proposer';

export interface CurrentRule {
  id: string;
  requirement: string;
  source: string;
  check_type: string;
  check_spec: unknown;
  severity: string;
}

export interface ProposeRuleChangeInput {
  projectId: string;
  /** The owner's words, verbatim. */
  said: string;
  /** Who said it, as the caller knows them ("Dennis McMahon"). */
  saidBy: string;
  /** ISO date the words were said. */
  saidOn: string;
  rules: CurrentRule[];
  facts: Record<string, string>;
}

export type ProposeRuleChangeResult =
  | { ok: true; candidateId: string | null; amends: CurrentRule | null; proposal: RuleProposal; duplicate: boolean }
  | { ok: false; reason: 'no-change' | 'invalid' | 'model-failed' | 'insert-failed'; message: string };

const SYSTEM = `You turn what a building project's owner has just said into ONE proposed change to that project's checking rules.

You get the project's current rules (each with an id) and the owner's words. Decide:
- If his words change, relax, tighten or replace what an existing rule requires, propose the AMENDED version of that rule and give its id in "amends".
- If they add a requirement no existing rule covers, propose a NEW rule with "amends": null.
- If they are not a decision about what the drawings or the work must satisfy (a meeting time, a payment, a greeting), return {"proposed": null, "reasoning": "<why>"}.

The amended or new rule has the same fields as a register row:
- requirement (≤500 chars): positive specification, in plain words, reflecting EXACTLY what he agreed — never stricter, never looser.
- source (≤200 chars): leave as "" — the caller records his words as the source.
- check_type: "manual-check" unless the existing rule's type still fits.
- check_spec: for manual-check {"kind":"manual-check","prompt":"<one yes/no/unsure question>","context_hints":["<keyword>",...],"use_kb_retrieval":true}. When amending, keep the existing spec's useful hints.
- severity: keep the amended rule's severity unless his words change how serious it is; "review" for a new rule unless he was unambiguous.

Output ONLY a JSON object:
{"amends": "<rule id or null>", "proposed": {"requirement": "...", "source": "", "check_type": "...", "check_spec": {...}, "severity": "...", "reasoning": "<one sentence>", "confidence": 0.0-1.0}}`;

const MAX_SAID_CHARS = 2000;

export async function proposeRuleChange(
  db: SupabaseClient,
  input: ProposeRuleChangeInput,
): Promise<ProposeRuleChangeResult> {
  const said = input.said.trim().slice(0, MAX_SAID_CHARS);
  const rulesBlock = input.rules.length
    ? input.rules
        .map((r) => `- id: ${r.id}\n  requirement: ${r.requirement}\n  severity: ${r.severity}\n  check_type: ${r.check_type}\n  check_spec: ${JSON.stringify(r.check_spec)}`)
        .join('\n')
    : '(no rules yet)';
  const factsBlock = Object.keys(input.facts).length
    ? Object.entries(input.facts).map(([k, v]) => `- ${k}: ${v}`).join('\n')
    : '(none)';

  let parsed: { amends?: unknown; proposed?: RuleProposal | null; reasoning?: string };
  try {
    const msg = await anthropic().messages.create({
      model: MODEL_MANUAL_CHECK,
      max_tokens: 1500,
      temperature: 0,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `PROJECT FACTS:\n${factsBlock}\n\nCURRENT RULES:\n${rulesBlock}\n\nWHAT THE OWNER SAID (${input.saidBy}, ${input.saidOn}):\n"""\n${said}\n"""\n\nJSON only.`,
        },
      ],
    });
    const raw = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('\n');
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { ok: false, reason: 'model-failed', message: 'Preflight could not turn that into a rule change.' };
    parsed = JSON.parse(match[0]);
  } catch (e) {
    return { ok: false, reason: 'model-failed', message: `Preflight could not turn that into a rule change (${(e as Error).message}).` };
  }

  if (!parsed.proposed) {
    return {
      ok: false,
      reason: 'no-change',
      message: `That doesn't read as a change to what the drawings must meet${parsed.reasoning ? ` (${parsed.reasoning})` : ''}, so no rule change was proposed.`,
    };
  }

  // His words are the source of the change, recorded by us — never the model's paraphrase.
  const source = `Owner (${input.saidBy}), ${input.saidOn}: "${said}"`.slice(0, 200);
  const proposal: RuleProposal = { ...parsed.proposed, source };
  const problem = proposalProblem(proposal);
  if (problem) return { ok: false, reason: 'invalid', message: `The proposed rule change didn't hold together: ${problem}.` };

  // Only an id the model was actually given can be amended.
  const amends = typeof parsed.amends === 'string' ? input.rules.find((r) => r.id === parsed.amends) ?? null : null;

  const { data, error } = await db
    .from('register_row_candidates')
    .insert({
      project_id: input.projectId,
      amends_register_row_id: amends?.id ?? null,
      proposed_requirement: proposal.requirement.trim(),
      proposed_source: proposal.source,
      proposed_source_url: null,
      proposed_check_type: proposal.check_type,
      proposed_check_spec: proposal.check_spec,
      proposed_severity: proposal.severity,
      confidence: typeof proposal.confidence === 'number' && proposal.confidence >= 0 && proposal.confidence <= 1 ? proposal.confidence : null,
      reasoning: `Said by ${input.saidBy} on ${input.saidOn}: "${said}"`.slice(0, 500),
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    // 23505: an equivalent proposal is already waiting (requirement fingerprint index, 0026).
    if ((error as { code?: string }).code === '23505') {
      return { ok: true, candidateId: null, amends, proposal, duplicate: true };
    }
    return { ok: false, reason: 'insert-failed', message: `The rule change could not be saved: ${error.message}.` };
  }
  return { ok: true, candidateId: (data as { id: string }).id, amends, proposal, duplicate: false };
}
