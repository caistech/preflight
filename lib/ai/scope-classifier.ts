/**
 * Scope classifier — reads a freshly ingested kb_document and proposes
 * one of three scopes:
 *
 *   project        applies only to THIS project (default; e.g. a council
 *                  audit letter naming this lot, a project-specific email)
 *   cross-project  useful to multiple projects with a definable filter
 *                  (e.g. "all ModularWA dwellings" — applies_when:
 *                  { builder: 'ModularWA' })
 *   general        broadly useful with no filter (e.g. a council audit
 *                  pattern that applies regardless of builder/dwelling)
 *
 * Never writes to kb_documents.scope directly. Proposals land in
 * kb_scope_proposals pending operator approval — same guardrail as
 * fact_candidates. Auto-upgrades are tempting but the cost of a wrongly-
 * promoted "general" doc is high (it pollutes retrieval for every future
 * project).
 *
 * Uses Haiku for cost + latency.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { anthropic, MODEL_HAIKU } from './anthropic';

const SYSTEM = `You classify a building-project document by how widely it should be available to the rule engine.

Three scopes:

1. "project" — applies ONLY to the specific project that owns it.
   Examples: an email from this project's drafter, a council letter naming this exact lot, a site survey for this address, a planning approval for this DA, anything with this project's address / unit count / lot number embedded.

2. "cross-project" — useful to multiple projects that share a definable property. You MUST be able to express that property as a key-value filter in applies_when.
   Examples: a ModularWA construction detail (applies_when: { builder: "ModularWA" }); a CGG council audit pattern letter (applies_when: { council: "City of Greater Geraldton" }); a 2x1 dwelling spec sheet (applies_when: { dwelling_type: "mwa-2x1" }).
   Use snake_case keys. Only filter on properties that are obviously durable across projects.

3. "general" — broadly useful regardless of project type / builder / council. Truly cross-cutting reference material.
   Examples: an Australian-building-code section reference; a general DA-submission checklist that's not council-specific; an industry-standard drafting convention.

Output ONLY a JSON object, no prose:
{"proposed_scope": "project" | "cross-project" | "general",
 "applies_when": { "<key>": "<value>" } or null,
 "confidence": 0.0-1.0,
 "reasoning": "<one short sentence>"}

When in doubt, propose "project". Wrongly promoting a doc to "general" pollutes retrieval for every future project — being conservative is correct. confidence 0.5 or lower → prefer "project".
applies_when is REQUIRED when proposed_scope is "cross-project" and MUST be null otherwise.`;

export interface ScopeProposal {
  proposed_scope: 'project' | 'cross-project' | 'general';
  applies_when: Record<string, string> | null;
  confidence: number;
  reasoning: string;
}

export interface ProposeScopeInput {
  documentId: string;
  projectId: string;
  documentTitle: string;
  documentSourceKind: string;
  documentContent: string;
  /** Known facts about the owning project, so the classifier can reason
   *  about what an applies_when filter would mean. */
  projectFacts: Record<string, string>;
  /** Bypass the operator-decision source-kind skip. Used by the operator
   *  review path when review=promote_to_rule signals explicit cross-project
   *  intent. */
  forceClassify?: boolean;
}

export interface ProposeScopeResult {
  inserted: boolean;
  proposal?: ScopeProposal;
  warnings: string[];
}

const MAX_CONTENT_CHARS = 12000;
const VALID_SCOPES = ['project', 'cross-project', 'general'] as const;

export async function proposeScopeForDocument(
  db: SupabaseClient,
  input: ProposeScopeInput,
): Promise<ProposeScopeResult> {
  const warnings: string[] = [];
  const content = input.documentContent.slice(0, MAX_CONTENT_CHARS);

  // Operator-decision docs skip auto-classification by default (most are
  // per-item judgments specific to one project). The operator review path
  // overrides this when review=promote_to_rule signals explicit cross-
  // project intent.
  if (input.documentSourceKind === 'operator-decision' && !input.forceClassify) {
    return { inserted: false, warnings: ['operator-decision docs skip auto-scope-classify (use forceClassify to override)'] };
  }

  const factsBlock = Object.keys(input.projectFacts).length
    ? Object.entries(input.projectFacts).map(([k, v]) => `- ${k}: ${v}`).join('\n')
    : '(none)';

  const userPrompt = `OWNING_PROJECT_FACTS:
${factsBlock}

DOCUMENT_TITLE: ${input.documentTitle}
DOCUMENT_SOURCE_KIND: ${input.documentSourceKind}

DOCUMENT_CONTENT:
"""
${content}
"""

Propose a scope as instructed. JSON only.`;

  let raw = '';
  let parsed: ScopeProposal | null = null;

  try {
    const msg = await anthropic().messages.create({
      model: MODEL_HAIKU,
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    });
    raw = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('\n');
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      warnings.push('Classifier returned no parseable JSON');
      return { inserted: false, warnings };
    }
    const obj = JSON.parse(match[0]) as Partial<ScopeProposal>;
    if (
      !obj.proposed_scope ||
      !(VALID_SCOPES as readonly string[]).includes(obj.proposed_scope) ||
      typeof obj.confidence !== 'number' ||
      typeof obj.reasoning !== 'string'
    ) {
      warnings.push('Classifier JSON missing required fields');
      return { inserted: false, warnings };
    }
    // applies_when must be present iff scope is cross-project.
    const aw = obj.applies_when;
    if (obj.proposed_scope === 'cross-project') {
      if (!aw || typeof aw !== 'object' || Array.isArray(aw) || Object.keys(aw).length === 0) {
        warnings.push('cross-project proposed without a valid applies_when — downgrading to project');
        obj.proposed_scope = 'project';
        obj.applies_when = null;
      }
    } else {
      // Force null for non-cross-project scopes to avoid weird stored state.
      obj.applies_when = null;
    }
    parsed = obj as ScopeProposal;
  } catch (e) {
    warnings.push(`Scope classifier failed: ${(e as Error).message}`);
    return { inserted: false, warnings };
  }

  // Don't queue a proposal if the LLM proposes 'project' — that's the
  // default; no operator action needed.
  if (parsed.proposed_scope === 'project') {
    return { inserted: false, proposal: parsed, warnings };
  }

  const { error: insErr } = await db.from('kb_scope_proposals').insert({
    project_id: input.projectId,
    kb_document_id: input.documentId,
    proposed_scope: parsed.proposed_scope,
    proposed_applies_when: parsed.applies_when,
    confidence: parsed.confidence >= 0 && parsed.confidence <= 1 ? parsed.confidence : null,
    reasoning: parsed.reasoning.slice(0, 500),
  });

  if (insErr) {
    // Unique-pending-per-doc index will reject a second pending proposal for
    // the same document. That's expected when an operator-edited kb_document
    // re-runs the classifier; surface as warning, not error.
    warnings.push(`Could not insert scope proposal: ${insErr.message}`);
    return { inserted: false, proposal: parsed, warnings };
  }

  return { inserted: true, proposal: parsed, warnings };
}
