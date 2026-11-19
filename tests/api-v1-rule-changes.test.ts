// POST /api/v1/projects/:id/rule-changes — the owner's words in, a pending proposal out,
// and a sentence that says it takes effect only once approved in Preflight.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  gate: null as unknown,
  propose: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
    return { from: () => chain };
  },
}));
vi.mock('@/lib/api-v1', async () => {
  const { NextResponse } = await import('next/server');
  return {
    fail: (status: number, error: string, extra = {}) => NextResponse.json({ ok: false, error, ...extra }, { status }),
    projectForKey: async () => state.gate,
  };
});
vi.mock('@/lib/ai/rule-change-proposer', () => ({ proposeRuleChange: state.propose }));

import { POST } from '@/app/api/v1/projects/[id]/rule-changes/route';

const call = (body: unknown) =>
  POST(new Request('https://x.test', { method: 'POST', body: JSON.stringify(body) }), { params: { id: 'lot-91-wavecrest' } });

const SAID = 'John and I agreed the deck can fix to the module.';

beforeEach(() => {
  state.gate = { ok: true, key: { id: 'k1', name: 'Kira', project_ids: ['p1'] }, projectId: 'p1', projectName: 'Lot 91 Wavecrest' };
  state.propose.mockReset();
});

describe('proposing a change', () => {
  it('an amendment answers 201 and says it takes effect once approved', async () => {
    state.propose.mockResolvedValue({
      ok: true,
      candidateId: 'cand-1',
      duplicate: false,
      amends: { id: 'rule-fixing', requirement: 'Neither the carport nor the patio may be fixed to the module.' },
      proposal: { requirement: 'Any fixing to the module must follow the Modular WA structural drawings.', severity: 'hard-fail' },
    });
    const res = await call({ said: SAID, saidBy: 'Dennis McMahon', saidOn: '2026-11-19' });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, candidateId: 'cand-1', amendsRuleId: 'rule-fixing' });
    expect(json.message).toMatch(/change to the Lot 91 Wavecrest rules: "Neither the carport.*would become "Any fixing.*once it's approved in Preflight/);
    expect(state.propose.mock.calls[0][1]).toMatchObject({ projectId: 'p1', said: SAID, saidBy: 'Dennis McMahon', saidOn: '2026-11-19' });
  });

  it('a change already waiting answers 200 and adds nothing', async () => {
    state.propose.mockResolvedValue({ ok: true, candidateId: null, duplicate: true, amends: null, proposal: { requirement: 'x'.repeat(20), severity: 'review' } });
    const res = await call({ said: SAID });
    expect(res.status).toBe(200);
    expect((await res.json()).message).toMatch(/already waiting for approval/);
  });

  it('words that are not a rule change are a 422 with the reason, read out as-is', async () => {
    state.propose.mockResolvedValue({ ok: false, reason: 'no-change', message: "That doesn't read as a change to what the drawings must meet." });
    const res = await call({ said: 'I agreed to meet Barry on Tuesday.' });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, reason: 'no-change' });
  });
});

describe('refused before any model call', () => {
  it('no words', async () => {
    const res = await call({ said: '  ' });
    expect(res.status).toBe(400);
    expect(state.propose).not.toHaveBeenCalled();
  });

  it('a key that does not reach the project', async () => {
    const { NextResponse } = await import('next/server');
    state.gate = { ok: false, response: NextResponse.json({ ok: false, error: 'No project called "lot-442" is set up for checks here.' }, { status: 404 }) };
    const res = await call({ said: SAID });
    expect(res.status).toBe(404);
    expect(state.propose).not.toHaveBeenCalled();
  });
});
