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
    requirement:
      'On a site-wide sheet (showing multiple units), the title block must reflect the full scope — not a single unit. A title block reading "UNIT 1 - 2x1 DWELLING (UNIT 1)" on a sheet that depicts the whole subdivision is a hard-fail; the title block must describe the site-wide scope instead.',
    source: 'F2K drafting standard',
    source_url: null,
    check_type: 'manual-check',
    check_spec: {
      kind: 'manual-check',
      prompt:
        "Look at the title block on this sheet (usually bottom-right corner — contains project name, sheet number, scale, etc.). Read what scope the title block describes — does it name a single unit (e.g. 'UNIT 1', '2x1 DWELLING (UNIT 1)') or the full site? Then check what the sheet itself depicts — does it show multiple units / a site-wide plan / multiple buildings? Answer pass / fail / unsure. FAIL = single-unit title block on a sheet showing multiple units (or vice versa). PASS = title block scope matches what's on the sheet. UNSURE = cannot determine from extracted text. Do NOT recommend a new title; flag for human review only.",
      context_hints: ['title block', 'UNIT', 'DWELLING', 'SHEET', 'PROJECT NO', 'SCALE'],
      use_kb_retrieval: false,
      max_answer_chars: 400,
    },
    severity: 'hard-fail',
    active: true,
  },
  {
    requirement:
      'All level values on the drawing set must use the SAME datum reference. Mixing AHD-converted FFL/FCL values with assumed-datum contour levels is a hard-fail — produces misleading readings (e.g. a ~38m stilt where there is actually a ~600mm pad).',
    source: 'Project history — partial AHD conversions caught in prior reviews; datum inconsistency is a recurring pattern',
    source_url: null,
    check_type: 'manual-check',
    check_spec: {
      kind: 'manual-check',
      prompt:
        'Look at the level values on this drawing set: FFL, FCL, NGL, and any RL contour heights on the site plan or location plan. Is there an internal inconsistency between datum systems — for example FFL/FCL values in the 40–50m range (suggesting AHD) sitting alongside contour levels in the 9–11m range (suggesting assumed datum)? Answer pass / fail / unsure with a one-sentence reason. Cite specific values if you find a mismatch. Do NOT recommend which datum to use — that is a project-owner decision.',
      context_hints: ['FFL', 'FCL', 'NGL', 'AHD', 'datum', 'RL', 'contour'],
      use_kb_retrieval: true,
      max_answer_chars: 500,
    },
    severity: 'hard-fail',
    active: true,
  },
  {
    requirement:
      'The DATUM note (typically in the title block or bottom-right of the sheet) must accurately describe the datum used for the level values shown on the drawing. A note that says "All levels shown are assumed datum. Add Xm to convert to AHD" is invalid if FFL/FCL values are already shown in AHD.',
    source: 'Project history — DATUM note inaccuracy is a recurring pattern when level conversions are partial',
    source_url: null,
    check_type: 'manual-check',
    check_spec: {
      kind: 'manual-check',
      prompt:
        'Find the DATUM note on this drawing (typically in or near the title block, bottom-right). Does the note accurately describe what is shown on the drawing? If the note says levels are in assumed datum, are the FFL/FCL values actually in the assumed range? If the note says levels are in AHD, are they in the AHD range? Answer pass / fail / unsure with a one-sentence reason quoting the DATUM note and a sample FFL value. Do NOT recommend a rewrite of the note — flag the discrepancy for human review only.',
      context_hints: ['DATUM', 'AHD', 'assumed', 'convert', 'FFL'],
      use_kb_retrieval: true,
      max_answer_chars: 500,
    },
    severity: 'review',
    active: true,
  },
  {
    requirement:
      'The revision-history line in the title block must accurately describe what changed in the current revision. Generic claims like "Datum conversion — all levels revised to AHD" must match what is actually on the drawing; a partial conversion described as complete is a fail.',
    source: 'Project history — revision-history mis-description is a recurring pattern',
    source_url: null,
    check_type: 'manual-check',
    check_spec: {
      kind: 'manual-check',
      prompt:
        'Find the revision-history block on this drawing (usually in or above the title block). Read the description for the latest revision. Does that description accurately reflect what is shown on the drawing? Examples of misalignment to flag: revision says "all levels revised to AHD" but contour levels are still in assumed datum; revision says "DATUM note added" but no DATUM note is visible; revision says "Unit numbering corrected" but the letterbox still shows duplicates. Answer pass / fail / unsure with a one-sentence reason. Do NOT rewrite the revision line for the drafter.',
      context_hints: ['REVISION', 'REV ', 'revision history', 'DATUM', 'AHD'],
      use_kb_retrieval: true,
      max_answer_chars: 500,
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
