import type { RegisterRow } from '../types';

/**
 * Universal pack — rules that apply to every DA drawing set, regardless of
 * council, builder, LDP, or whether the project is single-dwelling or
 * multi-unit. These get seeded into every new project at creation time.
 *
 * Anything that depends on multi-unit context lives in packs/multi-unit.ts.
 * Anything that depends on a specific builder (ModularWA, Unison, etc.)
 * lives in packs/<builder>.ts.
 */
export const UNIVERSAL_PACK: Omit<RegisterRow, 'id' | 'project_id'>[] = [
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
        'Find the revision-history block on this drawing (usually in or above the title block). Read the description for the latest revision. Does that description accurately reflect what is shown on the drawing? Examples of misalignment to flag: revision says "all levels revised to AHD" but contour levels are still in assumed datum; revision says "DATUM note added" but no DATUM note is visible; revision says "Unit numbering corrected" but the letterbox still shows duplicates. When the revision lists elements (e.g. "added carport and verandah to elevations") and the extracted text contains both those element labels and elevation-sheet markers (E1/E2/E3/E4 or "ELEVATION"), treat the claim as confirmed (pass). Answer pass / fail / unsure with a one-sentence reason. Do NOT rewrite the revision line for the drafter.',
      context_hints: ['REVISION', 'REV ', 'revision history', 'DATUM', 'AHD', 'ELEVATION', 'E1', 'E2', 'E3', 'E4'],
      use_kb_retrieval: true,
      max_answer_chars: 500,
    },
    severity: 'review',
    active: true,
  },
  {
    requirement:
      'Each lot boundary should be annotated. If a boundary has a bearing/distance but no street name, flag for human review (the tool does not supply the street name).',
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
      requires_geometric_reasoning: true,
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
      requires_geometric_reasoning: true,
    },
    severity: 'review',
    active: true,
  },
];
