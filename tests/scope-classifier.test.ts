import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the anthropic client BEFORE importing the SUT.
const mockCreate = vi.fn();
vi.mock('@/lib/ai/anthropic', () => ({
  anthropic: () => ({ messages: { create: mockCreate } }),
  MODEL_HAIKU: 'claude-haiku-test',
  MODEL_MANUAL_CHECK: 'claude-sonnet-test',
}));

import { proposeScopeForDocument } from '@/lib/ai/scope-classifier';

// Minimal SupabaseClient-shaped mock — only .from('kb_scope_proposals').insert()
// is exercised.
function mockDb(opts: { insertError?: { message: string } } = {}) {
  const insert = vi.fn().mockResolvedValue({ error: opts.insertError ?? null });
  return {
    from: (table: string) => {
      if (table === 'kb_scope_proposals') {
        return { insert };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
    _insertSpy: insert,
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

describe('proposeScopeForDocument', () => {
  it('skips classification for operator-decision source kind by default', async () => {
    const db = mockDb();
    const r = await proposeScopeForDocument(db as never, {
      documentId: 'd-1',
      projectId: 'p-1',
      documentTitle: 'Decision',
      documentSourceKind: 'operator-decision',
      documentContent: 'something',
      projectFacts: {},
    });
    expect(r.inserted).toBe(false);
    expect(r.warnings).toContain('operator-decision docs skip auto-scope-classify (use forceClassify to override)');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('classifies operator-decision when forceClassify is true', async () => {
    llmResponds(
      JSON.stringify({ proposed_scope: 'cross-project', applies_when: { builder: 'ModularWA' }, confidence: 0.8, reasoning: 'MWA-specific' }),
    );
    const db = mockDb();
    const r = await proposeScopeForDocument(db as never, {
      documentId: 'd-1',
      projectId: 'p-1',
      documentTitle: 'Decision',
      documentSourceKind: 'operator-decision',
      documentContent: 'ModularWA dwelling detail',
      projectFacts: { builder: 'ModularWA' },
      forceClassify: true,
    });
    expect(r.inserted).toBe(true);
    expect(r.proposal?.proposed_scope).toBe('cross-project');
  });

  it('does NOT queue when LLM proposes project scope (no operator action needed)', async () => {
    llmResponds(
      JSON.stringify({ proposed_scope: 'project', applies_when: null, confidence: 0.9, reasoning: 'This is Lot-442 specific' }),
    );
    const db = mockDb();
    const r = await proposeScopeForDocument(db as never, {
      documentId: 'd-1',
      projectId: 'p-1',
      documentTitle: 'Email from drafter',
      documentSourceKind: 'inbound-email',
      documentContent: 'email body about Lot 442 specifically',
      projectFacts: {},
    });
    expect(r.inserted).toBe(false);
    expect(r.proposal?.proposed_scope).toBe('project');
  });

  it('downgrades cross-project to project when applies_when is missing', async () => {
    llmResponds(
      JSON.stringify({ proposed_scope: 'cross-project', applies_when: null, confidence: 0.5, reasoning: 'forgot the filter' }),
    );
    const db = mockDb();
    const r = await proposeScopeForDocument(db as never, {
      documentId: 'd-1',
      projectId: 'p-1',
      documentTitle: 'something',
      documentSourceKind: 'upload',
      documentContent: 'content',
      projectFacts: {},
    });
    expect(r.proposal?.proposed_scope).toBe('project');
    expect(r.warnings.some((w) => w.includes('downgrading'))).toBe(true);
    expect(r.inserted).toBe(false);
  });

  it('handles malformed JSON gracefully', async () => {
    llmResponds('not json at all');
    const db = mockDb();
    const r = await proposeScopeForDocument(db as never, {
      documentId: 'd-1',
      projectId: 'p-1',
      documentTitle: 'x',
      documentSourceKind: 'upload',
      documentContent: 'x',
      projectFacts: {},
    });
    expect(r.inserted).toBe(false);
    expect(r.warnings[0]).toContain('no parseable JSON');
  });

  it('handles LLM call failure as a warning, not throw', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Anthropic 503'));
    const db = mockDb();
    const r = await proposeScopeForDocument(db as never, {
      documentId: 'd-1',
      projectId: 'p-1',
      documentTitle: 'x',
      documentSourceKind: 'upload',
      documentContent: 'x',
      projectFacts: {},
    });
    expect(r.inserted).toBe(false);
    expect(r.warnings[0]).toContain('Anthropic 503');
  });

  it('forces applies_when null for non-cross-project scopes even if LLM returns one', async () => {
    llmResponds(
      JSON.stringify({ proposed_scope: 'general', applies_when: { spurious: 'value' }, confidence: 0.9, reasoning: 'broad' }),
    );
    const db = mockDb();
    await proposeScopeForDocument(db as never, {
      documentId: 'd-1',
      projectId: 'p-1',
      documentTitle: 'x',
      documentSourceKind: 'upload',
      documentContent: 'x',
      projectFacts: {},
    });
    const call = db._insertSpy.mock.calls[0]?.[0];
    expect(call?.proposed_applies_when).toBeNull();
  });
});
