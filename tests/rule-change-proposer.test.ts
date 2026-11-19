// The owner's words become ONE pending proposal: a change to the rule they amend, or a
// new rule. His words are kept verbatim as the source; nothing is ever applied here.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock('@/lib/ai/anthropic', () => ({
  anthropic: () => ({ messages: { create: mockCreate } }),
  MODEL_MANUAL_CHECK: 'claude-sonnet-test',
}));

import { proposeRuleChange, type CurrentRule } from '@/lib/ai/rule-change-proposer';

const FIXING_RULE: CurrentRule = {
  id: 'rule-fixing',
  requirement: 'Neither the carport nor the patio may be fixed to the module.',
  source: 'Spec 18 Aug 2026',
  check_type: 'manual-check',
  check_spec: { kind: 'manual-check', prompt: 'Is anything fixed to the module?', context_hints: ['ledger'] },
  severity: 'hard-fail',
};
const SAID = 'John and I agreed the deck and carport can fix to the module, as long as it follows the Modular WA structural drawings.';

const answer = (json: unknown) => mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify(json) }] });

function fakeDb(insertError: { code?: string; message: string } | null = null) {
  const inserted: Array<Record<string, unknown>> = [];
  return {
    inserted,
    db: {
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return { select: () => ({ single: async () => (insertError ? { data: null, error: insertError } : { data: { id: 'cand-9' }, error: null }) }) };
        },
      }),
    } as never,
  };
}

const input = { projectId: 'p1', said: SAID, saidBy: 'Dennis McMahon', saidOn: '2026-11-19', rules: [FIXING_RULE], facts: {} };

const AMENDED = {
  requirement: 'Any fixing to the module must follow the Modular WA structural drawings and be approved by Modular WA.',
  source: '',
  check_type: 'manual-check',
  check_spec: { kind: 'manual-check', prompt: 'Does any fixing to the module follow the Modular WA drawings?', context_hints: ['ledger'], use_kb_retrieval: true },
  severity: 'hard-fail',
  reasoning: 'Verbal agreement replaces the no-fixing rule.',
  confidence: 0.9,
};

beforeEach(() => mockCreate.mockReset());

describe('a change to an existing rule', () => {
  it('lands pending, amending that rule, with his words as the source', async () => {
    answer({ amends: 'rule-fixing', proposed: AMENDED });
    const { db, inserted } = fakeDb();
    const got = await proposeRuleChange(db, input);
    expect(got).toMatchObject({ ok: true, candidateId: 'cand-9', amends: { id: 'rule-fixing' }, duplicate: false });
    expect(inserted[0]).toMatchObject({
      project_id: 'p1',
      amends_register_row_id: 'rule-fixing',
      status: 'pending',
      proposed_requirement: AMENDED.requirement,
      proposed_source: expect.stringContaining('Owner (Dennis McMahon), 2026-11-19: "John and I agreed'),
    });
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ temperature: 0 });
  });

  it('an id the model invented is never amended — it becomes a new-rule proposal', async () => {
    answer({ amends: 'rule-that-does-not-exist', proposed: AMENDED });
    const { db, inserted } = fakeDb();
    const got = await proposeRuleChange(db, input);
    expect(got).toMatchObject({ ok: true, amends: null });
    expect(inserted[0].amends_register_row_id).toBeNull();
  });

  it('the same change already waiting is reported, not duplicated', async () => {
    answer({ amends: 'rule-fixing', proposed: AMENDED });
    const { db } = fakeDb({ code: '23505', message: 'duplicate key' });
    expect(await proposeRuleChange(db, input)).toMatchObject({ ok: true, duplicate: true, candidateId: null });
  });
});

describe('what never becomes a proposal', () => {
  it('words that are not a decision about the work', async () => {
    answer({ proposed: null, reasoning: 'a meeting time' });
    const { db, inserted } = fakeDb();
    const got = await proposeRuleChange(db, { ...input, said: 'I agreed to meet Barry on Tuesday at ten.' });
    expect(got).toMatchObject({ ok: false, reason: 'no-change' });
    expect(inserted).toEqual([]);
  });

  it('a malformed proposal', async () => {
    answer({ amends: null, proposed: { ...AMENDED, check_type: 'text-rule' } });
    const { db, inserted } = fakeDb();
    expect(await proposeRuleChange(db, input)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(inserted).toEqual([]);
  });

  it('a model failure', async () => {
    mockCreate.mockRejectedValueOnce(new Error('overloaded'));
    const { db } = fakeDb();
    expect(await proposeRuleChange(db, input)).toMatchObject({ ok: false, reason: 'model-failed' });
  });
});
