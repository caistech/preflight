// The same sheet and the same rule must get the same answer on every run. Both model
// calls that decide a check — reading a drawn sheet and answering a manual-check rule —
// are sent at temperature 0. At the default (1.0) three runs on identical Lot 91 sheets
// read three different texts, 2026-11-19.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@/lib/ai/anthropic', () => ({
  anthropic: () => ({ messages: { create: mockCreate } }),
  anthropicIsDirect: () => true,
  MODEL_HAIKU: 'claude-haiku-test',
  MODEL_MANUAL_CHECK: 'claude-sonnet-test',
}));
vi.mock('@/lib/kb/embed', () => ({ embedQuery: vi.fn() }));

import { runManualCheck } from '@/lib/ai/manual-check';
import { transcribePdf } from '@/lib/pdf/transcribe';

beforeEach(() => mockCreate.mockReset());

describe('the calls that decide a check are repeatable', () => {
  it('a manual-check rule is answered at temperature 0', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: '{"outcome":"pass","message":"ok"}' }] });
    await runManualCheck({ kind: 'manual-check', prompt: 'Is it stated?', context_hints: [] } as never, 'text', {}, 'p-1');
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ temperature: 0 });
  });

  it('a manual-check answer carries its quote and sheet', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"outcome":"fail","message":"Timber joists.","quote":"50X150 JOIST (T25/W.R)","sheet":"S-031"}' }],
    });
    const r = await runManualCheck({ kind: 'manual-check', prompt: 'Non-combustible?', context_hints: [] } as never, 'text', {}, 'p-1');
    expect(r).toMatchObject({ outcome: 'fail', evidence: { quote: '50X150 JOIST (T25/W.R)', sheet: 'S-031' } });
  });

  it('an answer without a quote has no evidence block (older answers still parse)', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: '{"outcome":"unsure","message":"Not stated."}' }] });
    const r = await runManualCheck({ kind: 'manual-check', prompt: 'Stated?', context_hints: [] } as never, 'text', {}, 'p-1');
    expect(r.outcome).toBe('unsure');
    expect(r.evidence).toBeUndefined();
  });

  it('a drawn sheet is read at temperature 0', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'GENERAL NOTES 1. ALL WORK TO AS 1170.2. 50X150 JOIST (T25/W.R) ON MONOSLAB HANGERS' }],
    });
    const got = await transcribePdf('S-031.pdf', Buffer.from('%PDF'), 1);
    expect(got).toMatchObject({ ok: true });
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ temperature: 0 });
  });
});
