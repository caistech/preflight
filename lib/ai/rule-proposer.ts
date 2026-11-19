/**
 * Rule proposer — reads an operator-decision document (the kb_document
 * written when a drafter decision gets the promote_to_rule review) and
 * proposes a NEW register_row that captures the operator's intent for
 * sibling projects.
 *
 * Never writes to register_rows directly. Proposals land in
 * register_row_candidates with status='pending' for per-sibling operator
 * approval — same human-in-the-loop guardrail as fact_candidates.
 *
 * Uses Sonnet (not Haiku) because rule check_spec construction is the
 * tightest reasoning task in the pipeline — a wrong check_type or a
 * malformed regex pollutes every future triage.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { anthropic, MODEL_MANUAL_CHECK } from './anthropic';

const SYSTEM = `You read an operator-decision document and propose a SINGLE new register row that captures the operator's intent for similar projects.

The operator picked promote_to_rule on a drafter decision. That means: "the existing rule was wrong OR a new rule should be added to catch this pattern in similar projects". You're proposing the rule itself.

A register_row has these fields:
- requirement (text, ≤500 chars): the check, written as a positive specification ("X must Y when Z")
- source (text, ≤200 chars): where the requirement comes from (council audit pattern, builder spec, project history, F2K drafting standard)
- check_type: one of "text-rule" | "logic-rule" | "cross-ref" | "manual-check"
- check_spec (JSON object): shape depends on check_type
- severity: one of "hard-fail" | "review" | "info"

check_spec shapes:

text-rule:
{ "kind": "text-rule", "fail_if_found": true|false, "contains": "<substring>" OR "regex": "<regex>", "when_facts": {"<key>": "<value>"} (optional) }
Use when the rule fires on the presence/absence of a literal string or pattern in the extracted text.

manual-check:
{ "kind": "manual-check", "prompt": "<one-sentence yes/no/unsure question>", "context_hints": ["<keyword>", ...], "use_kb_retrieval": true, "when_facts": {...} }
Use when the rule needs LLM reasoning, e.g. spatial relationships, free-form judgment. PREFER this when in doubt — it's safer than a brittle regex.

cross-ref:
{ "kind": "cross-ref", "fact_a": "<key>", "fact_b": "<key or $extracted:term>", "must": "equal" | "differ" | "present" }
Use when comparing two project facts or a fact vs an extracted value.

logic-rule:
{ "kind": "logic-rule", "logic": "<name>", "params": {...} }
ONLY use when the logic name is one of these (defined in lib/rules/engine.ts):
  - "unit_numbering_set" (params: expected_count OR use_project_units)
  - "title_block_count" (params: expected)
  - "orphan_section_callouts" (params: callout_regex)
Do NOT invent new logic names — the engine has no handler for them.

Output ONLY a JSON object, no prose:
{
  "proposed": {
    "requirement": "...",
    "source": "...",
    "check_type": "manual-check",
    "check_spec": {...},
    "severity": "review",
    "reasoning": "<one sentence>",
    "confidence": 0.0-1.0
  }
}

Or, if no useful rule can be derived (rare; the doc may not contain enough signal):
{ "proposed": null, "reasoning": "<why>" }

Constraints:
- Severity defaults to "review" unless the operator's rationale is unambiguous about hard-fail.
- when_facts MUST be set when the rule is project-type specific (e.g. ModularWA), so the rule only fires on matching projects. Use snake_case keys.
- NEVER include specific street names, lot numbers, dimensions, or other project-specific identifiers in the requirement — those are facts, not rules.`;

export interface RuleProposal {
  requirement: string;
  source: string;
  check_type: 'text-rule' | 'logic-rule' | 'cross-ref' | 'manual-check';
  check_spec: Record<string, unknown>;
  severity: 'hard-fail' | 'review' | 'info';
  reasoning: string;
  confidence: number;
}

export interface ProposeRuleInput {
  documentId: string;
  projectId: string;            // the SIBLING project this candidate is for
  sourceProjectId: string;      // the project the operator decision came from
  sourceDecisionId: string | null;
  documentTitle: string;
  documentContent: string;
  projectFacts: Record<string, string>;
}

export interface ProposeRuleResult {
  inserted: boolean;
  proposal?: RuleProposal | null;
  warnings: string[];
}

const VALID_CHECK_TYPES = ['text-rule', 'logic-rule', 'cross-ref', 'manual-check'] as const;
const VALID_SEVERITIES = ['hard-fail', 'review', 'info'] as const;
const VALID_LOGIC_NAMES = ['unit_numbering_set', 'title_block_count', 'orphan_section_callouts'] as const;
const MAX_CONTENT_CHARS = 12000;

/**
 * Why a proposed rule cannot be stored, or null when it can. Shared by every proposer
 * so a rule drafted from a decision and one drafted from the owner's words are held to
 * the same shape — a wrong check_type or a malformed spec pollutes every future run.
 */
export function proposalProblem(proposed: RuleProposal | null | undefined): string | null {
  if (
    !proposed ||
    typeof proposed.requirement !== 'string' ||
    proposed.requirement.trim().length < 10 ||
    proposed.requirement.length > 500 ||
    typeof proposed.source !== 'string' ||
    proposed.source.trim().length < 3 ||
    !(VALID_CHECK_TYPES as readonly string[]).includes(proposed.check_type) ||
    !(VALID_SEVERITIES as readonly string[]).includes(proposed.severity) ||
    typeof proposed.check_spec !== 'object' ||
    proposed.check_spec === null
  ) {
    return 'Proposed rule failed validation (required fields missing or out of range)';
  }
  // check_spec sanity: must have kind matching check_type, and logic-rule
  // must reference a known logic name.
  const spec = proposed.check_spec as { kind?: string; logic?: string };
  if (spec.kind !== proposed.check_type) {
    return `check_spec.kind (${spec.kind}) does not match check_type (${proposed.check_type})`;
  }
  if (proposed.check_type === 'logic-rule' && !(VALID_LOGIC_NAMES as readonly string[]).includes(spec.logic ?? '')) {
    return `logic-rule references unknown logic "${spec.logic}"`;
  }
  return null;
}

export async function proposeRuleFromDecision(
  db: SupabaseClient,
  input: ProposeRuleInput,
): Promise<ProposeRuleResult> {
  const warnings: string[] = [];
  const content = input.documentContent.slice(0, MAX_CONTENT_CHARS);

  const factsBlock = Object.keys(input.projectFacts).length
    ? Object.entries(input.projectFacts).map(([k, v]) => `- ${k}: ${v}`).join('\n')
    : '(none yet)';

  const userPrompt = `SIBLING_PROJECT_FACTS (the project this candidate is for):
${factsBlock}

OPERATOR_DECISION_DOCUMENT (from a different project, capturing the original decision + operator's intent):
TITLE: ${input.documentTitle}
"""
${content}
"""

Propose a SINGLE register row that captures the operator's intent, suitable for the sibling project above. JSON only.`;

  let raw = '';
  let proposed: RuleProposal | null = null;

  try {
    const msg = await anthropic().messages.create({
      model: MODEL_MANUAL_CHECK,
      max_tokens: 1500,
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    });
    raw = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('\n');
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      warnings.push('Rule proposer returned no parseable JSON');
      return { inserted: false, warnings };
    }
    const parsed = JSON.parse(match[0]);
    if (parsed.proposed === null) {
      return { inserted: false, proposal: null, warnings: [parsed.reasoning ?? 'Proposer returned null (no rule derivable)'] };
    }
    proposed = parsed.proposed as RuleProposal;
  } catch (e) {
    warnings.push(`Rule proposer LLM call failed: ${(e as Error).message}`);
    return { inserted: false, warnings };
  }

  const invalid = proposalProblem(proposed);
  if (invalid) {
    warnings.push(invalid);
    return { inserted: false, warnings };
  }

  // Two dedup constraints live on register_row_candidates:
  //   1. (project_id, source_decision_id, status='pending') — same source
  //      decision can't double-propose.
  //   2. (project_id, requirement_fingerprint, status='pending') — two
  //      DIFFERENT decisions proposing the same normalized requirement
  //      text on the same sibling collapse to one pending row.
  // Both are partial unique indexes that PostgREST onConflict can't target
  // cleanly, so we INSERT and treat unique-violations as expected (the
  // operator already has the equivalent pending row).
  const { error: insErr } = await db
    .from('register_row_candidates')
    .insert({
      project_id: input.projectId,
      source_document_id: input.documentId,
      source_decision_id: input.sourceDecisionId,
      source_project_id: input.sourceProjectId,
      proposed_requirement: proposed.requirement.trim(),
      proposed_source: proposed.source.trim(),
      proposed_source_url: null,
      proposed_check_type: proposed.check_type,
      proposed_check_spec: proposed.check_spec,
      proposed_severity: proposed.severity,
      confidence:
        typeof proposed.confidence === 'number' && proposed.confidence >= 0 && proposed.confidence <= 1
          ? proposed.confidence
          : null,
      reasoning: typeof proposed.reasoning === 'string' ? proposed.reasoning.slice(0, 500) : null,
    });

  if (insErr) {
    // 23505 = unique_violation. Either source-decision dup or fingerprint
    // dup — both mean an equivalent pending candidate already exists, which
    // is the dedup behaviour we want. Surface as a soft warning rather than
    // an error.
    if ((insErr as { code?: string }).code === '23505') {
      warnings.push(`Equivalent rule candidate already pending — skipped`);
      return { inserted: false, proposal: proposed, warnings };
    }
    warnings.push(`Could not insert rule candidate: ${insErr.message}`);
    return { inserted: false, proposal: proposed, warnings };
  }

  return { inserted: true, proposal: proposed, warnings };
}
