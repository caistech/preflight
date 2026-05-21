import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock('@/lib/ai/anthropic', () => ({
  anthropic: () => ({ messages: { create: mockCreate } }),
  MODEL_HAIKU: 'claude-haiku-test',
  MODEL_MANUAL_CHECK: 'claude-sonnet-test',
}));

import { proposeRuleFromDecision } from '@/lib/ai/rule-proposer';

function mockDb(opts: { insertError?: { code?: string; message: string } } = {}) {
  const insert = vi.fn().mockResolvedValue({ error: opts.insertError ?? null });
  return {
    from: (table: string) => {
      if (table === 'register_row_candidates') return { insert };
      throw new Error(`Unexpected table: ${table}`);
    },
    _insertSpy: insert,
  };
}

function llmResponds(text: string) {
  mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text }] });
}

beforeEach(() => mockCreate.mockReset());

const baseInput = {
  documentId: 'd-1',
  projectId: 'sibling-p',
  sourceProjectId: 'src-p',
  sourceDecisionId: 'dec-1',
  documentTitle: 'Operator review — SV exclusion zone',
  documentContent: 'Operator review of SV symbol exclusion zone rule',
  projectFacts: { builder: 'ModularWA' },
};

describe('proposeRuleFromDecision', () => {
  it('inserts a valid manual-check proposal', async () => {
    llmResponds(
      JSON.stringify({
        proposed: {
          requirement: 'SV symbols must sit ≥2000mm from rangehood vents',
          source: 'A107 SV detail at 1:20',
          check_type: 'manual-check',
          check_spec: {
            kind: 'manual-check',
            prompt: 'Are SV-to-RH distances ≥2000mm?',
            context_hints: ['SV', 'rangehood'],
          },
          severity: 'hard-fail',
          reasoning: 'derived from operator review',
          confidence: 0.8,
        },
      }),
    );
    const db = mockDb();
    const r = await proposeRuleFromDecision(db as never, baseInput);
    expect(r.inserted).toBe(true);
    expect(r.proposal?.check_type).toBe('manual-check');
  });

  it('rejects logic-rule referencing an unknown logic name', async () => {
    llmResponds(
      JSON.stringify({
        proposed: {
          requirement: 'some requirement that is long enough',
          source: 'src',
          check_type: 'logic-rule',
          check_spec: { kind: 'logic-rule', logic: 'made_up_logic', params: {} },
          severity: 'review',
          reasoning: 'x',
          confidence: 0.5,
        },
      }),
    );
    const db = mockDb();
    const r = await proposeRuleFromDecision(db as never, baseInput);
    expect(r.inserted).toBe(false);
    expect(r.warnings.some((w) => w.includes('unknown logic'))).toBe(true);
  });

  it('rejects when check_spec.kind does not match check_type', async () => {
    llmResponds(
      JSON.stringify({
        proposed: {
          requirement: 'some requirement that is long enough',
          source: 'src',
          check_type: 'text-rule',
          check_spec: { kind: 'manual-check', prompt: 'mismatched kind' },
          severity: 'review',
          reasoning: 'x',
          confidence: 0.5,
        },
      }),
    );
    const db = mockDb();
    const r = await proposeRuleFromDecision(db as never, baseInput);
    expect(r.inserted).toBe(false);
    expect(r.warnings.some((w) => w.includes('does not match'))).toBe(true);
  });

  it('treats null proposal (LLM judged no rule derivable) as a soft skip', async () => {
    llmResponds(JSON.stringify({ proposed: null, reasoning: 'doc had no actionable rule' }));
    const db = mockDb();
    const r = await proposeRuleFromDecision(db as never, baseInput);
    expect(r.inserted).toBe(false);
    expect(r.proposal).toBeNull();
  });

  it('treats Postgres unique_violation (23505) as expected dedup', async () => {
    llmResponds(
      JSON.stringify({
        proposed: {
          requirement: 'duplicate-of-existing requirement text',
          source: 'src',
          check_type: 'manual-check',
          check_spec: { kind: 'manual-check', prompt: 'q' },
          severity: 'review',
          reasoning: 'x',
          confidence: 0.7,
        },
      }),
    );
    const db = mockDb({ insertError: { code: '23505', message: 'unique violation' } });
    const r = await proposeRuleFromDecision(db as never, baseInput);
    expect(r.inserted).toBe(false);
    expect(r.warnings[0]).toContain('Equivalent rule candidate already pending');
  });

  it('handles malformed JSON gracefully', async () => {
    llmResponds('not even close to json');
    const db = mockDb();
    const r = await proposeRuleFromDecision(db as never, baseInput);
    expect(r.inserted).toBe(false);
    expect(r.warnings[0]).toContain('no parseable JSON');
  });

  it('rejects requirement that is too short', async () => {
    llmResponds(
      JSON.stringify({
        proposed: {
          requirement: 'short',
          source: 'src',
          check_type: 'manual-check',
          check_spec: { kind: 'manual-check', prompt: 'q' },
          severity: 'review',
          reasoning: 'x',
          confidence: 0.7,
        },
      }),
    );
    const db = mockDb();
    const r = await proposeRuleFromDecision(db as never, baseInput);
    expect(r.inserted).toBe(false);
    expect(r.warnings.some((w) => w.includes('failed validation'))).toBe(true);
  });
});
