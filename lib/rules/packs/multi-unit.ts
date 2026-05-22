import type { RegisterRow } from '../types';

/**
 * Multi-unit pack — rules that only make sense when the project contains
 * more than one unit on a single lot (subdivision, group dwelling, strata).
 *
 * Gated by selectSeedRules() on `unit_count > 1` or
 * `has_multi_unit_site_plan === 'true'`. A single-dwelling project never
 * sees these rows.
 *
 * Note on engine wiring: the unit-numbering rule's `expected_count` is
 * filled in at insert time from the project's `unit_count` fact — see
 * instantiateSeedRules() in ../seed-rules.ts. The title-block rule needs
 * the engine to bind the offending sheet name in its output (engine bug
 * tracked separately — output currently doesn't cite "A109" etc.).
 */
export const MULTI_UNIT_PACK: Omit<RegisterRow, 'id' | 'project_id'>[] = [
  {
    requirement:
      'The letterbox bank on the fencing/site sheet must contain one cell per unit, with no duplicates and none missing — exactly the {1..N} set (or the project_units active set when present). A bank that shows UNIT 4 twice and no UNIT 8 is a hard-fail.',
    source: 'Council audit pattern — duplicate/missing letterbox cells flagged in prior submissions (e.g. Lot 442 A110: UNIT 4 duplicated, UNIT 8 missing)',
    source_url: null,
    check_type: 'logic-rule',
    check_spec: {
      kind: 'logic-rule',
      logic: 'unit_numbering_set',
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
        "For each candidate sheet listed in the pre-scoping block above, read its title block (the CLIENT / ADDRESS / HOUSE TYPE labels — usually near the bottom of the page). Decide whether the title-block scope (e.g. 'UNIT 1 - 2x1 DWELLING (UNIT 1)') matches the scope of what the sheet depicts (a single unit vs the whole site). FAIL when at least one site-wide candidate sheet carries a single-unit title block — name each failing sheet by its sheet_id (e.g. A109). PASS only when every candidate sheet's title-block scope matches what's on the sheet. UNSURE if the title-block text isn't recoverable from the excerpts. Do NOT propose a corrected title — that's for the drafter.",
      context_hints: ['title block', 'CLIENT', 'ADDRESS', 'HOUSE TYPE', 'UNIT', 'DWELLING', 'SHEET', 'PROJECT NO', 'SCALE', 'FENCING PLAN', 'SITE PLAN'],
      use_kb_retrieval: false,
      max_answer_chars: 400,
      pre_scope: 'site_wide_sheets',
    },
    severity: 'hard-fail',
    active: true,
  },
];
