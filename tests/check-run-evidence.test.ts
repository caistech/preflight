// The run itself holds a manual-check fail to its quote: a fail whose evidence is not
// in the drawing text is recorded as needs-review, never as a hard fail.

import { describe, expect, it, vi } from 'vitest';

const { mockManual } = vi.hoisted(() => ({ mockManual: vi.fn() }));

vi.mock('@/lib/ai/manual-check', () => ({ runManualCheck: mockManual }));
vi.mock('@/lib/rules/engine', () => ({
  evaluateRow: () => ({ outcome: 'unsure', message: 'deferred', evidence: { defer_to_llm: true } }),
}));

import { evaluateRun, type OpenedRun } from '@/lib/check-run';

const ROW = {
  id: 'row-1',
  project_id: 'p1',
  requirement: 'Non-combustible structure',
  source: 'DA A100',
  source_url: null,
  check_type: 'manual-check',
  check_spec: { kind: 'manual-check', prompt: 'Non-combustible?' },
  severity: 'hard-fail',
  active: true,
};

/** Every query the run makes resolves; inserts and updates are recorded. */
function fakeDb() {
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const from = (table: string) => {
    const result = { data: table === 'register_rows' ? [ROW] : [], error: null };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      then: (resolve: (v: unknown) => unknown) => resolve(result),
      insert: (values: Record<string, unknown>) => {
        inserts.push(values);
        return { select: () => ({ single: async () => ({ data: { id: 'res-1' }, error: null }) }) };
      },
      update: (values: Record<string, unknown>) => {
        updates.push(values);
        return { eq: async () => ({ error: null }) };
      },
    };
    return chain;
  };
  return { db: { from } as never, inserts, updates };
}

const opened = (): OpenedRun => ({
  runId: 'run-1',
  combinedText: '=== FILE: S-031.pdf ===\n50X150 JOIST (T25/W.R) on MONOSLAB joist hangers',
  sections: ['=== FILE: S-031.pdf ===\n50X150 JOIST (T25/W.R) on MONOSLAB joist hangers'],
  fileSummaries: [{ name: 'S-031.pdf', bytes: 10, pages: 1, extraction_method: 'pdf-parse' }],
  warnings: [],
  unread: [],
});

describe('a hard fail needs its evidence on the sheet', () => {
  it('a fail quoting the sheet is a hard fail', async () => {
    mockManual.mockResolvedValueOnce({
      outcome: 'fail',
      message: 'Timber joists are combustible.',
      evidence: { quote: '50X150 JOIST (T25/W.R)', sheet: 'S-031' },
    });
    const { db } = fakeDb();
    const payload = await evaluateRun(db, 'p1', opened(), () => {});
    expect(payload.hard_fails).toHaveLength(1);
    expect(payload.needs_review).toHaveLength(0);
  });

  it('a fail quoting words that are not on the sheet goes to needs-review, with the reason stored', async () => {
    mockManual.mockResolvedValueOnce({
      outcome: 'fail',
      message: 'Posts are Cypress Pine.',
      evidence: { quote: 'CYPRESS PINE 100 x 50 C1 (H)', sheet: 'S-031' },
    });
    const { db, inserts } = fakeDb();
    const payload = await evaluateRun(db, 'p1', opened(), () => {});
    expect(payload.hard_fails).toHaveLength(0);
    expect(payload.needs_review).toEqual([expect.objectContaining({ outcome: 'unsure', message: expect.stringMatching(/check by eye/) })]);
    expect(inserts[0]).toMatchObject({ outcome: 'unsure', evidence: expect.objectContaining({ downgraded_from: 'fail' }) });
  });
});
