import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate, mockEmbed } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockEmbed: vi.fn(),
}));

vi.mock('@/lib/ai/anthropic', () => ({
  anthropic: () => ({ messages: { create: mockCreate } }),
  MODEL_HAIKU: 'claude-haiku-test',
  MODEL_MANUAL_CHECK: 'claude-sonnet-test',
}));

vi.mock('@/lib/kb/embed', () => ({ embedQuery: mockEmbed }));

import { runManualCheck } from '@/lib/ai/manual-check';

function llmAnswer(outcome: 'pass' | 'fail' | 'unsure', message = 'ok') {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text: `Reasoning… {"outcome":"${outcome}","message":"${message}"}` }],
  });
}

function dbWithChunks(chunks: Array<{ content: string; scope: string; similarity: number }>) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: chunks, error: null }),
  };
}

const baseSpec = {
  kind: 'manual-check' as const,
  prompt: 'Is the rule satisfied?',
  context_hints: ['SV', 'rangehood'],
  use_kb_retrieval: true,
};

beforeEach(() => {
  mockCreate.mockReset();
  mockEmbed.mockReset();
});

describe('runManualCheck — KB retrieval branch', () => {
  it('skips KB retrieval when use_kb_retrieval is false', async () => {
    llmAnswer('pass');
    const db = dbWithChunks([]);
    const spec = { ...baseSpec, use_kb_retrieval: false };
    const r = await runManualCheck(spec, 'extracted text', {}, 'p-1', db as never);
    expect(mockEmbed).not.toHaveBeenCalled();
    expect((db.rpc as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(r.outcome).toBe('pass');
  });

  it('skips KB retrieval when no db client is provided', async () => {
    llmAnswer('pass');
    const r = await runManualCheck(baseSpec, 'extracted text', {}, 'p-1');
    expect(mockEmbed).not.toHaveBeenCalled();
    expect(r.outcome).toBe('pass');
  });

  it('calls embedQuery + match_kb_chunks when use_kb_retrieval and db are wired', async () => {
    mockEmbed.mockResolvedValueOnce(new Array(1536).fill(0.01));
    llmAnswer('unsure', 'needs eyes');
    const db = dbWithChunks([
      { content: 'project-specific note', scope: 'project', similarity: 0.6 },
      { content: 'cross-project ModularWA detail', scope: 'cross-project', similarity: 0.92 },
    ]);
    const r = await runManualCheck(baseSpec, 'extracted text', { builder: 'ModularWA' }, 'p-1', db as never);
    expect(mockEmbed).toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledWith('match_kb_chunks', expect.objectContaining({
      match_count: 5,
      in_project_id: 'p-1',
    }));
    expect(r.outcome).toBe('unsure');
  });

  it('re-ranks chunks by tier when kb_rerank_by_tier is unset or true', async () => {
    mockEmbed.mockResolvedValueOnce(new Array(1536).fill(0.01));
    // The first call's user prompt is captured so we can assert ordering.
    const calls: Array<{ content: string }> = [];
    mockCreate.mockImplementationOnce(async (args: { messages: Array<{ content: string }> }) => {
      calls.push(args.messages[0]);
      return { content: [{ type: 'text', text: '{"outcome":"unsure","message":"x"}' }] };
    });

    const db = dbWithChunks([
      { content: 'general chunk', scope: 'general', similarity: 0.99 },
      { content: 'project chunk', scope: 'project', similarity: 0.5 },
      { content: 'cross-project chunk', scope: 'cross-project', similarity: 0.8 },
    ]);
    await runManualCheck(baseSpec, 'extracted', {}, 'p-1', db as never);

    const userPromptText = calls[0]?.content ?? '';
    // Tier order: project first, then cross-project, then general (even
    // though general had higher cosine similarity).
    const projectIdx = userPromptText.indexOf('project chunk');
    const crossIdx = userPromptText.indexOf('cross-project chunk');
    const generalIdx = userPromptText.indexOf('general chunk');
    expect(projectIdx).toBeGreaterThan(0);
    expect(crossIdx).toBeGreaterThan(projectIdx);
    expect(generalIdx).toBeGreaterThan(crossIdx);
  });

  it('falls back to pure similarity when kb_rerank_by_tier=false', async () => {
    mockEmbed.mockResolvedValueOnce(new Array(1536).fill(0.01));
    const calls: Array<{ content: string }> = [];
    mockCreate.mockImplementationOnce(async (args: { messages: Array<{ content: string }> }) => {
      calls.push(args.messages[0]);
      return { content: [{ type: 'text', text: '{"outcome":"unsure","message":"x"}' }] };
    });

    const db = dbWithChunks([
      { content: 'general but most similar', scope: 'general', similarity: 0.99 },
      { content: 'project chunk', scope: 'project', similarity: 0.5 },
    ]);
    const spec = { ...baseSpec, kb_rerank_by_tier: false };
    await runManualCheck(spec, 'extracted', {}, 'p-1', db as never);

    const userPromptText = calls[0]?.content ?? '';
    // With reranking off, the most-similar (general) chunk should appear first.
    expect(userPromptText.indexOf('general but most similar')).toBeLessThan(
      userPromptText.indexOf('project chunk'),
    );
  });

  it('proceeds without KB context when embedding returns null', async () => {
    mockEmbed.mockResolvedValueOnce(null);
    llmAnswer('pass');
    const db = dbWithChunks([]);
    const r = await runManualCheck(baseSpec, 'extracted', {}, 'p-1', db as never);
    expect((db.rpc as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(r.outcome).toBe('pass');
  });

  it('adds the geometric-reasoning hint when requires_geometric_reasoning is true', async () => {
    const calls: Array<{ content: string }> = [];
    mockCreate.mockImplementationOnce(async (args: { messages: Array<{ content: string }> }) => {
      calls.push(args.messages[0]);
      return { content: [{ type: 'text', text: '{"outcome":"unsure","message":"x"}' }] };
    });
    const spec = { ...baseSpec, use_kb_retrieval: false, requires_geometric_reasoning: true };
    await runManualCheck(spec, 'extracted', {}, 'p-1');
    expect(calls[0].content).toContain('spatial / geometric reasoning');
    expect(calls[0].content).toContain('Default to "unsure"');
  });

  it('injects pre-scope evidence into the prompt and substitutes scoped_text for extracted text', async () => {
    const calls: Array<{ content: string }> = [];
    mockCreate.mockImplementationOnce(async (args: { messages: Array<{ content: string }> }) => {
      calls.push(args.messages[0]);
      return { content: [{ type: 'text', text: '{"outcome":"fail","message":"A109 title block is unit-specific"}' }] };
    });
    const spec = { ...baseSpec, use_kb_retrieval: false };
    await runManualCheck(spec, 'FULL EXTRACTED TEXT — should be excluded when pre-scope is set', {}, 'p-1', undefined, {
      pre_scope: 'site_wide_sheets',
      candidates: [
        { sheet_id: 'A109', file: 'fencing.pdf', page_idx: 1, distinct_units: 8, header_match: 'FENCING PLAN' },
      ],
      scoped_text: '[SHEET A109 file=fencing.pdf page=1]\nFENCING PLAN UNIT 1 UNIT 2 UNIT 3',
    });
    const userPrompt = calls[0]?.content ?? '';
    expect(userPrompt).toContain('Deterministic pre-scoping (site_wide_sheets)');
    expect(userPrompt).toContain('A109');
    expect(userPrompt).toContain('FENCING PLAN');
    // scoped_text should replace the full extracted text — the sentinel
    // "FULL EXTRACTED TEXT" string must not appear anywhere in the prompt.
    expect(userPrompt).not.toContain('FULL EXTRACTED TEXT');
  });
});
