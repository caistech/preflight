// Approving a proposed rule.
//
//   plain candidate  → insert one rule, approve the candidate        (unchanged — REGRESSION)
//   amendment        → one database function replaces the old rule  (all or nothing)
//   amendment, raced → 409, nothing written by the route
//   reject           → candidate rejected, no rule touched

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state } = vi.hoisted(() => ({
  state: {
    candidate: null as Record<string, unknown> | null,
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
    updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
    rpcs: [] as Array<{ fn: string; args: Record<string, unknown> }>,
    rpcResult: { data: 'new-row' as unknown, error: null as null | { message: string } },
  },
}));

function fakeDb() {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        single: async () =>
          table === 'register_row_candidates'
            ? { data: state.candidate, error: state.candidate ? null : { message: 'none' } }
            : { data: { id: 'inserted-row' }, error: null },
        insert: (values: Record<string, unknown>) => {
          state.inserts.push({ table, values });
          return { select: () => ({ single: async () => ({ data: { id: 'inserted-row' }, error: null }) }), then: (r: (v: unknown) => unknown) => r({ error: null }) };
        },
        update: (values: Record<string, unknown>) => {
          state.updates.push({ table, values });
          return { eq: async () => ({ error: null }) };
        },
      };
      return chain;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcs.push({ fn, args });
      return state.rpcResult;
    },
  };
}

vi.mock('@/lib/supabase/auth', () => ({
  authenticateAndGetDb: async () => ({ user: { id: 'owner-1' }, db: fakeDb(), error: null }),
}));
vi.mock('@/lib/project-resolver', () => ({ resolveProjectId: async () => 'p1' }));

import { PATCH } from '@/app/api/projects/[id]/register-row-candidates/[candidateId]/route';

const CANDIDATE = {
  id: 'cand-1',
  project_id: 'p1',
  proposed_requirement: 'Any fixing to the module must follow the Modular WA structural drawings and be approved by Modular WA.',
  proposed_source: 'Verbal agreement, Dennis and John Montgomery, 2026-11-19',
  proposed_source_url: null,
  proposed_check_type: 'manual-check',
  proposed_check_spec: { kind: 'manual-check', prompt: 'Does any fixing reference the Modular WA drawings?' },
  proposed_severity: 'hard-fail',
  status: 'pending',
  amends_register_row_id: null as string | null,
};

const call = (body: Record<string, unknown>) =>
  PATCH(new Request('http://x/api', { method: 'PATCH', body: JSON.stringify(body) }) as never, {
    params: Promise.resolve({ id: 'lot-91-wavecrest', candidateId: 'cand-1' }),
  });

beforeEach(() => {
  state.candidate = { ...CANDIDATE };
  state.inserts = [];
  state.updates = [];
  state.rpcs = [];
  state.rpcResult = { data: 'new-row', error: null };
});

describe('approving a new rule works exactly as before', () => {
  it('inserts one rule and approves the candidate, with no amendment function', async () => {
    const res = await call({ action: 'approve' });
    expect(res.status).toBe(200);
    expect(state.rpcs).toEqual([]);
    expect(state.inserts.filter((i) => i.table === 'register_rows')).toEqual([
      {
        table: 'register_rows',
        values: expect.objectContaining({ project_id: 'p1', requirement: CANDIDATE.proposed_requirement, severity: 'hard-fail', active: true }),
      },
    ]);
    expect(state.updates).toEqual([
      { table: 'register_row_candidates', values: expect.objectContaining({ status: 'approved', resulting_register_row_id: 'inserted-row' }) },
    ]);
  });
});

describe('approving a change replaces the rule it changes', () => {
  beforeEach(() => {
    state.candidate = { ...CANDIDATE, amends_register_row_id: 'old-row' };
  });

  it('runs the one-step amendment and touches no table directly', async () => {
    const res = await call({ action: 'approve', note: 'agreed on site', edits: { severity: 'review' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ register_row_id: 'new-row', superseded_register_row_id: 'old-row' });
    expect(state.rpcs).toEqual([
      {
        fn: 'approve_register_amendment',
        args: expect.objectContaining({ in_candidate_id: 'cand-1', in_note: 'agreed on site', in_severity: 'review', in_requirement: null }),
      },
    ]);
    expect(state.inserts.filter((i) => i.table === 'register_rows')).toEqual([]);
    expect(state.updates).toEqual([]);
  });

  it('a candidate approved in the meantime is a 409 and nothing else is written', async () => {
    state.rpcResult = { data: null, error: { message: 'already approved' } };
    const res = await call({ action: 'approve' });
    expect(res.status).toBe(409);
    expect(state.inserts).toEqual([]);
  });

  it('rejecting a change leaves every rule alone', async () => {
    const res = await call({ action: 'reject', note: 'not agreed' });
    expect(res.status).toBe(200);
    expect(state.rpcs).toEqual([]);
    expect(state.inserts.filter((i) => i.table === 'register_rows')).toEqual([]);
    expect(state.updates).toEqual([{ table: 'register_row_candidates', values: expect.objectContaining({ status: 'rejected' }) }]);
  });
});
