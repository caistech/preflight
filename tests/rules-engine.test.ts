import { describe, it, expect } from 'vitest';
import { evaluateRow } from '@/lib/rules/engine';
import type { CheckEvaluationInput, RegisterRow } from '@/lib/rules/types';

// Helper to build a CheckEvaluationInput with sensible defaults.
function makeInput(
  row: RegisterRow,
  overrides: Partial<CheckEvaluationInput> = {},
): CheckEvaluationInput {
  return {
    row,
    extractedText: '',
    facts: {},
    projectId: 'test-project',
    ...overrides,
  };
}

function row(check_spec: unknown, severity: 'hard-fail' | 'review' | 'informational' = 'hard-fail'): RegisterRow {
  return {
    id: 'r-test',
    project_id: 'test-project',
    requirement: 'test rule',
    source: 'test',
    check_type:
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((check_spec as any).kind ?? 'text-rule') as RegisterRow['check_type'],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    check_spec: check_spec as any,
    severity,
    active: true,
  };
}

describe('evalTextRule', () => {
  it('passes when fail_if_found=true and substring is absent', () => {
    const r = evaluateRow(
      makeInput(row({ kind: 'text-rule', fail_if_found: true, contains: 'sub-floor vent' }), {
        extractedText: 'No vents in this set.',
      }),
    );
    expect(r.outcome).toBe('pass');
  });

  it('fails when fail_if_found=true and substring is present (case-insensitive)', () => {
    const r = evaluateRow(
      makeInput(row({ kind: 'text-rule', fail_if_found: true, contains: 'SUB-FLOOR VENT' }), {
        extractedText: 'Drawing shows sub-floor vent at each corner.',
      }),
    );
    expect(r.outcome).toBe('fail');
  });

  it('skips via when_facts when a gate fact does not match', () => {
    const r = evaluateRow(
      makeInput(
        row({
          kind: 'text-rule',
          fail_if_found: true,
          contains: 'sub-floor vent',
          when_facts: { footing_system: 'slab-on-biscuit' },
        }),
        {
          extractedText: 'Drawing shows sub-floor vent.',
          facts: { footing_system: 'modularwa-biscuit-footing' },
        },
      ),
    );
    expect(r.outcome).toBe('not-applicable');
  });

  it('returns error on a bad regex', () => {
    const r = evaluateRow(
      makeInput(row({ kind: 'text-rule', fail_if_found: false, regex: '(((' })),
    );
    expect(r.outcome).toBe('error');
  });
});

describe('evalLogicRule: unit_numbering_set (expected_count path)', () => {
  it('punts not-applicable when no letterbox elevation page exists', () => {
    const r = evaluateRow(
      makeInput(row({ kind: 'logic-rule', logic: 'unit_numbering_set', params: { expected_count: 8 } }), {
        extractedText: '--- PAGE 1 ---\nSITE PLAN\nUNIT 1 UNIT 2',
      }),
    );
    expect(r.outcome).toBe('not-applicable');
  });

  it('passes when all expected units appear on a row-of-cells line', () => {
    const r = evaluateRow(
      makeInput(row({ kind: 'logic-rule', logic: 'unit_numbering_set', params: { expected_count: 4 } }), {
        extractedText:
          '--- PAGE 1 ---\nLETTERBOX ELEVATION\nUNIT 1 UNIT 2 UNIT 3 UNIT 4',
      }),
    );
    expect(r.outcome).toBe('pass');
  });

  it('fails with missing and duplicate units flagged', () => {
    const r = evaluateRow(
      makeInput(row({ kind: 'logic-rule', logic: 'unit_numbering_set', params: { expected_count: 4 } }), {
        extractedText:
          '--- PAGE 1 ---\nLETTERBOX ELEVATION\nUNIT 1 UNIT 2 UNIT 2 UNIT 3',
      }),
    );
    expect(r.outcome).toBe('fail');
    expect(r.message).toContain('missing units: 4');
    expect(r.message).toContain('duplicated units: 2');
  });
});

describe('evalLogicRule: unit_numbering_set (use_project_units path)', () => {
  it('uses the project_units active set as the source of truth', () => {
    const r = evaluateRow(
      makeInput(
        row({ kind: 'logic-rule', logic: 'unit_numbering_set', params: { use_project_units: true } }),
        {
          extractedText:
            '--- PAGE 1 ---\nLETTERBOX ELEVATION\nUNIT 1 UNIT 2 UNIT 4',
          units: [
            { unit_number: 1, unit_type: '2x1', area_sqm: null, ffl_m: null, footing_system: null, status: 'active' },
            { unit_number: 2, unit_type: '2x1', area_sqm: null, ffl_m: null, footing_system: null, status: 'active' },
            { unit_number: 4, unit_type: '2x1', area_sqm: null, ffl_m: null, footing_system: null, status: 'active' },
            // unit 3 archived — should not be expected
            { unit_number: 3, unit_type: '2x1', area_sqm: null, ffl_m: null, footing_system: null, status: 'archived' },
          ],
        },
      ),
    );
    expect(r.outcome).toBe('pass');
  });

  it('handles non-contiguous unit sets (e.g. ModularWA skipping 13)', () => {
    const r = evaluateRow(
      makeInput(
        row({ kind: 'logic-rule', logic: 'unit_numbering_set', params: { use_project_units: true } }),
        {
          extractedText:
            '--- PAGE 1 ---\nLETTERBOX ELEVATION\nUNIT 12 UNIT 14',
          units: [
            { unit_number: 12, unit_type: '2x1', area_sqm: null, ffl_m: null, footing_system: null, status: 'active' },
            { unit_number: 14, unit_type: '2x1', area_sqm: null, ffl_m: null, footing_system: null, status: 'active' },
          ],
        },
      ),
    );
    expect(r.outcome).toBe('pass');
  });

  it('errors when use_project_units=true but no active units exist', () => {
    const r = evaluateRow(
      makeInput(
        row({ kind: 'logic-rule', logic: 'unit_numbering_set', params: { use_project_units: true } }),
        {
          extractedText: '--- PAGE 1 ---\nLETTERBOX ELEVATION\nUNIT 1',
          units: [],
        },
      ),
    );
    expect(r.outcome).toBe('error');
  });
});

describe('evalLogicRule: orphan_section_callouts', () => {
  it('passes when every callout target appears as a sheet identifier', () => {
    const r = evaluateRow(
      makeInput(row({ kind: 'logic-rule', logic: 'orphan_section_callouts' }), {
        extractedText:
          'A102 floor plan ref S1/A107 also see D3/A107. A107 sub-floor vent detail at 1:20. A107 sheet stamp.',
      }),
    );
    expect(r.outcome).toBe('pass');
  });

  it('fails on orphan callout (target sheet not present)', () => {
    // A107 appears only inside a callout — never as a sheet identifier
    // (no second standalone "A107" anywhere). The heuristic should flag it.
    const r = evaluateRow(
      makeInput(row({ kind: 'logic-rule', logic: 'orphan_section_callouts' }), {
        extractedText: 'A102 floor plan refers to S1/A107 for the sub-floor detail.',
      }),
    );
    expect(r.outcome).toBe('fail');
    expect(r.message).toContain('A107 missing');
  });

  it('returns not-applicable when no section callouts at all', () => {
    const r = evaluateRow(
      makeInput(row({ kind: 'logic-rule', logic: 'orphan_section_callouts' }), {
        extractedText: 'Just a site plan, no section callouts at all.',
      }),
    );
    expect(r.outcome).toBe('not-applicable');
  });
});

describe('evalLogicRule: title_block_count', () => {
  it('punts unsure when no sheet marker found', () => {
    const r = evaluateRow(
      makeInput(row({ kind: 'logic-rule', logic: 'title_block_count', params: { expected: 1 } }), {
        extractedText: 'Nothing useful here.',
      }),
    );
    expect(r.outcome).toBe('unsure');
  });

  it('passes when sheet marker count equals expected', () => {
    const r = evaluateRow(
      makeInput(row({ kind: 'logic-rule', logic: 'title_block_count', params: { expected: 1 } }), {
        extractedText: 'Title block lists SHEET No 1 of 9.',
      }),
    );
    expect(r.outcome).toBe('pass');
  });
});

describe('manual-check defer', () => {
  it('returns unsure with defer_to_llm flag', () => {
    const r = evaluateRow(
      makeInput(
        row(
          {
            kind: 'manual-check',
            prompt: 'Is the title block correct for the sheet scope?',
          },
          'review',
        ),
      ),
    );
    expect(r.outcome).toBe('unsure');
    expect(r.evidence?.defer_to_llm).toBe(true);
  });
});
