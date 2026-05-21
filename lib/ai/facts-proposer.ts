/**
 * Facts proposer — reads a freshly-ingested KB document, asks Haiku to
 * propose project_facts entries (key, value, confidence, evidence), and
 * persists each proposal as a fact_candidates row in pending status.
 *
 * Never writes to project_facts directly. Operator approval is the only
 * path that mutates the canonical fact store. The ModularWA / sub-floor-
 * vent false-fail is exactly the kind of mistake this guardrail prevents.
 *
 * Uses Haiku for cost + latency; the task is JSON list extraction, not
 * reasoning, so Sonnet would be overkill.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { anthropic, MODEL_HAIKU } from './anthropic';

const SYSTEM = `You read a building-project document and propose project facts that would help a pre-submission rule engine check drawings against project-specific requirements.

A "project fact" is a small key-value pair the rule engine can gate on. Examples:
- footing_system: slab-on-biscuit
- footing_system: modularwa-transportable-concrete-base
- unit_count: 8
- datum_reference: AHD
- builder: ModularWA
- subfloor_vents_required: yes
- council: City of Greater Geraldton

Constraints:
- Lowercase snake_case keys.
- Short, atomic values (not paragraphs).
- Only propose facts you can ground in a verbatim quote from the document.
- Skip facts that already appear in the EXISTING_FACTS list (don't re-propose).
- Skip transient or one-time things (job numbers, dates, revision codes) — these are not "facts" about the project, they're metadata.
- "confidence" is 0..1; 1.0 means the doc states it explicitly, 0.5 means you inferred it.

Output: JSON ONLY, no prose around it. Shape:
{"proposals": [{"key": "<snake_case>", "value": "<atomic>", "confidence": 0.0-1.0, "evidence_quote": "<verbatim line>", "reasoning": "<one short sentence>"}]}

If there are no useful facts in this document, return {"proposals": []}.`;

export interface FactProposal {
  key: string;
  value: string;
  confidence: number;
  evidence_quote: string;
  reasoning: string;
}

export interface ProposeFactsInput {
  documentId: string;
  projectId: string;
  documentTitle: string;
  documentContent: string;
  existingFacts: Record<string, string>;
}

export interface ProposeFactsResult {
  proposed: number;
  inserted: number;
  rejected_invalid: number;
  warnings: string[];
}

const MAX_CONTENT_CHARS = 18000;     // ~4-5k tokens, enough for a spec sheet
const VALID_KEY = /^[a-z][a-z0-9_]{1,63}$/;

export async function proposeFactsFromDocument(
  db: SupabaseClient,
  input: ProposeFactsInput,
): Promise<ProposeFactsResult> {
  const warnings: string[] = [];
  const content = input.documentContent.slice(0, MAX_CONTENT_CHARS);

  const existingBlock = Object.keys(input.existingFacts).length
    ? Object.entries(input.existingFacts).map(([k, v]) => `- ${k}: ${v}`).join('\n')
    : '(none yet)';

  const userPrompt = `EXISTING_FACTS:
${existingBlock}

DOCUMENT_TITLE: ${input.documentTitle}

DOCUMENT_CONTENT:
"""
${content}
"""

Propose any new facts as instructed. JSON only.`;

  let raw = '';
  let proposals: FactProposal[] = [];

  try {
    const msg = await anthropic().messages.create({
      model: MODEL_HAIKU,
      max_tokens: 1500,
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    });
    raw = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('\n');

    // The model is instructed to emit JSON only, but allow a tolerant
    // extraction so a leading/trailing newline doesn't sink the run.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      warnings.push('Proposer returned no parseable JSON object');
      return { proposed: 0, inserted: 0, rejected_invalid: 0, warnings };
    }
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed.proposals)) {
      warnings.push('Proposer JSON missing proposals array');
      return { proposed: 0, inserted: 0, rejected_invalid: 0, warnings };
    }
    proposals = parsed.proposals;
  } catch (e) {
    warnings.push(`Proposer LLM call failed: ${(e as Error).message}`);
    return { proposed: 0, inserted: 0, rejected_invalid: 0, warnings };
  }

  // Validate + filter before insert. We accept what looks well-formed and
  // skip the rest with a count, rather than aborting the whole batch.
  let rejected = 0;
  const rows: Array<{
    project_id: string;
    source_document_id: string;
    proposed_key: string;
    proposed_value: string;
    confidence: number | null;
    evidence_quote: string | null;
    reasoning: string | null;
  }> = [];

  for (const p of proposals) {
    if (
      !p ||
      typeof p.key !== 'string' ||
      typeof p.value !== 'string' ||
      !VALID_KEY.test(p.key) ||
      p.value.trim().length === 0 ||
      p.value.length > 500
    ) {
      rejected++;
      continue;
    }
    // Skip if exact key+value already in EXISTING_FACTS (LLM shouldn't but
    // does sometimes).
    if (input.existingFacts[p.key]?.toLowerCase() === p.value.toLowerCase()) {
      rejected++;
      continue;
    }
    rows.push({
      project_id: input.projectId,
      source_document_id: input.documentId,
      proposed_key: p.key,
      proposed_value: p.value.trim(),
      confidence:
        typeof p.confidence === 'number' && p.confidence >= 0 && p.confidence <= 1
          ? p.confidence
          : null,
      evidence_quote:
        typeof p.evidence_quote === 'string' && p.evidence_quote.length <= 1000
          ? p.evidence_quote
          : null,
      reasoning:
        typeof p.reasoning === 'string' && p.reasoning.length <= 500
          ? p.reasoning
          : null,
    });
  }

  let inserted = 0;
  if (rows.length > 0) {
    const { error: insErr, count } = await db
      .from('fact_candidates')
      .insert(rows, { count: 'exact' });
    if (insErr) {
      warnings.push(`Insert failed: ${insErr.message}`);
    } else {
      inserted = count ?? rows.length;
    }
  }

  return {
    proposed: proposals.length,
    inserted,
    rejected_invalid: rejected,
    warnings,
  };
}
