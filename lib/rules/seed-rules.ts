import type { RegisterRow } from './types';

/**
 * Seed rules — the canonical starter register for any new project.
 *
 * These are the rules drawn straight from the DA Pre-Submission Checker brief.
 * They get inserted with `active=true` for every newly-created project.
 * Project owners add project-specific rules on top.
 *
 * Note: `project_id` is filled in at insert time; this module exposes the
 * project-agnostic shapes.
 */

export const SEED_RULES: Omit<RegisterRow, 'id' | 'project_id'>[] = [
  {
    requirement: 'Subfloor vents must NOT appear in the legend when the project uses a slab-on-biscuit footing system.',
    source: 'Project definition — footing system is slab-on-biscuit, no subfloor void',
    source_url: null,
    check_type: 'text-rule',
    check_spec: {
      kind: 'text-rule',
      fail_if_found: true,
      regex: '\\bSUB-?\\s*FLOOR\\s+VENT(?:S|ING)?\\b',
      when_facts: { footing_system: 'slab-on-biscuit' },
    },
    severity: 'hard-fail',
    active: true,
  },
  {
    requirement: 'The unit-numbering set on the site plan must be exactly {1..N} with no repeats, where N is the project unit_count.',
    source: 'Council audit pattern — repeated unit numbers were flagged in two prior submissions',
    source_url: null,
    check_type: 'logic-rule',
    check_spec: {
      kind: 'logic-rule',
      logic: 'unit_numbering_set',
      // expected_count is read from the row's spec; the engine will read the params.
      // For seed rules we leave a TODO marker — the project-creation step substitutes the actual unit_count fact value.
      params: { expected_count: 0 },
      when_facts: { has_multi_unit_site_plan: 'true' },
    },
    severity: 'hard-fail',
    active: true,
  },
  {
    requirement: 'A site-wide sheet should contain exactly one title block; multiple title blocks usually indicate a single-unit drawing accidentally placed on a site-wide sheet.',
    source: 'F2K drafting standard',
    source_url: null,
    check_type: 'logic-rule',
    check_spec: {
      kind: 'logic-rule',
      logic: 'title_block_count',
      params: { expected: 1 },
      when_facts: { sheet_is_site_wide: 'true' },
    },
    severity: 'review',
    active: true,
  },
  {
    requirement: 'Each lot boundary should be annotated. If a boundary has a bearing/distance but no street name, flag for human review (tool does not supply the street name).',
    source: 'Project history — wrong street name once propagated from the wrong source; tool must not become a new wrong source',
    source_url: null,
    check_type: 'manual-check',
    check_spec: {
      kind: 'manual-check',
      prompt:
        'Look at the extracted text excerpts that reference lot boundaries. For each boundary that has a bearing/distance value, is there an adjacent street name annotation? Answer pass / fail / unsure. If fail, list the boundary that is missing a street name. Do NOT suggest what the street name should be — that is for the human reviewer.',
      context_hints: ['boundary', 'bearing', 'street'],
      use_kb_retrieval: false,
      max_answer_chars: 400,
    },
    severity: 'review',
    active: true,
  },
  {
    requirement: 'A crossover annotation should be present and on the correct road reserve.',
    source: 'Council audit pattern — crossover off wrong reserve was flagged in three prior submissions',
    source_url: null,
    check_type: 'manual-check',
    check_spec: {
      kind: 'manual-check',
      prompt:
        'Look at the extracted text excerpts. Is a crossover annotated, and does it appear to be on the correct road reserve given the project address and orientation? Answer pass / fail / unsure with a one-sentence reason. Unsure is the right answer if the geometry cannot be determined from extracted text alone.',
      context_hints: ['crossover', 'driveway', 'road reserve'],
      use_kb_retrieval: true,
      max_answer_chars: 400,
    },
    severity: 'review',
    active: true,
  },
];

/**
 * Apply seed-row substitutions for a specific project — fills in
 * expected_count etc from the project's facts.
 */
export function instantiateSeedRules(
  projectId: string,
  facts: Record<string, string>
): Omit<RegisterRow, 'id'>[] {
  return SEED_RULES.map((r) => {
    let spec = r.check_spec;
    if (spec.kind === 'logic-rule' && spec.logic === 'unit_numbering_set') {
      const count = Number(facts.unit_count ?? 0);
      spec = { ...spec, params: { ...spec.params, expected_count: count } };
    }
    return { ...r, check_spec: spec, project_id: projectId };
  });
}
