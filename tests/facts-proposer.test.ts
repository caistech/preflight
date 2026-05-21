import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
vi.mock('@/lib/ai/anthropic', () => ({
  anthropic: () => ({ messages: { create: mockCreate } }),
  MODEL_HAIKU: 'claude-haiku-test',
  MODEL_MANUAL_CHECK: 'claude-sonnet-test',
}));

import { proposeFactsFromDocument } from '@/lib/ai/facts-proposer';

function mockDb(opts: { upsertError?: { message: string }; count?: number } = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: opts.upsertError ?? null, count: opts.count ?? null });
  return {
    from: (table: string) => {
      if (table === 'fact_candidates') return { upsert };
      throw new Error(`Unexpected table: ${table}`);
    },
    _upsertSpy: upsert,
  };
}

function llmResponds(text: string) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text }],
  });
}

beforeEach(() => {
  mockCreate.mockReset();
});

describe('proposeFactsFromDocument', () => {
  it('parses a clean JSON proposal and inserts validated rows', async () => {
    llmResponds(
      JSON.stringify({
        proposals: [
          { key: 'builder', value: 'ModularWA', confidence: 0.95, evidence_quote: 'Builders reg # 101630', reasoning: 'Logo + builders reg present' },
          { key: 'dwelling_type', value: 'mwa-2x1', confidence: 0.9, evidence_quote: '2x1 dwelling', reasoning: 'Title block' },
        ],
      }),
    );
    const db = mockDb({ count: 2 });
    const r = await proposeFactsFromDocument(db as never, {
      documentId: 'd-1',
      projectId: 'p-1',
      documentTitle: 'A107 spec',
      documentContent: 'doc text',
      existingFacts: {},
    });
    expect(r.proposed).toBe(2);
    expect(r.inserted).toBe(2);
    expect(r.rejected_invalid).toBe(0);
  });

  it('rejects proposals with invalid keys', async () => {
    llmResponds(
      JSON.stringify({
        proposals: [
          { key: 'Builder Name', value: 'ModularWA', confidence: 0.9, evidence_quote: '', reasoning: '' },
          { key: '__weird', value: 'x', confidence: 0.5, evidence_quote: '', reasoning: '' },
          { key: 'builder', value: 'ModularWA', confidence: 0.95, evidence_quote: 'Builders reg', reasoning: '' },
        ],
      }),
    );
    const db = mockDb({ count: 1 });
    const r = await proposeFactsFromDocument(db as never, {
      documentId: 'd-1',
      projectId: 'p-1',
      documentTitle: 'x',
      documentContent: 'x',
      existingFacts: {},
    });
    expect(r.proposed).toBe(3);
    expect(r.rejected_invalid).toBe(2);
    expect(r.inserted).toBe(1);
  });

  it('skips proposals that match an existing fact key+value exactly', async () => {
    llmResponds(
      JSON.stringify({
        proposals: [
          { key: 'builder', value: 'ModularWA', confidence: 0.9, evidence_quote: '', reasoning: '' },
          { key: 'council', value: 'CGG', confidence: 0.7, evidence_quote: '', reasoning: '' },
        ],
      }),
    );
    const db = mockDb({ count: 1 });
    const r = await proposeFactsFromDocument(db as never, {
      documentId: 'd-1',
      projectId: 'p-1',
      documentTitle: 'x',
      documentContent: 'x',
      existingFacts: { builder: 'modularwa' }, // case-insensitive dedupe
    });
    expect(r.rejected_invalid).toBe(1);
    expect(r.inserted).toBe(1);
  });

  it('handles malformed JSON gracefully', async () => {
    llmResponds('total garbage no braces');
    const db = mockDb();
    const r = await proposeFactsFromDocument(db as never, {
      documentId: 'd-1',
      projectId: 'p-1',
      documentTitle: 'x',
      documentContent: 'x',
      existingFacts: {},
    });
    expect(r.inserted).toBe(0);
    expect(r.warnings[0]).toContain('no parseable JSON');
  });

  it('handles LLM exception as warning, not throw', async () => {
    mockCreate.mockRejectedValueOnce(new Error('rate limited'));
    const db = mockDb();
    const r = await proposeFactsFromDocument(db as never, {
      documentId: 'd-1',
      projectId: 'p-1',
      documentTitle: 'x',
      documentContent: 'x',
      existingFacts: {},
    });
    expect(r.inserted).toBe(0);
    expect(r.warnings[0]).toContain('rate limited');
  });

  it('does not call DB when proposals array is empty', async () => {
    llmResponds(JSON.stringify({ proposals: [] }));
    const db = mockDb();
    const r = await proposeFactsFromDocument(db as never, {
      documentId: 'd-1',
      projectId: 'p-1',
      documentTitle: 'x',
      documentContent: 'x',
      existingFacts: {},
    });
    expect(db._upsertSpy).not.toHaveBeenCalled();
    expect(r.proposed).toBe(0);
  });
});
