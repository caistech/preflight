// POST /api/v1/projects/:id/check-runs — every reason a run cannot start comes back
// before anything is recorded; a retry never pays twice; the slow part runs after
// the reply.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  gate: { ok: true, key: { id: 'k1', name: 'Kira', project_ids: ['p1'] }, projectId: 'p1' } as unknown,
  existing: null as null | { id: string; status: string },
  fetch: vi.fn(),
  openRun: vi.fn(),
  evaluateRun: vi.fn(),
  waitUntil: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.maybeSingle = async () => ({ data: state.existing, error: null });
    return { from: () => chain };
  },
}));
vi.mock('@/lib/api-v1', async () => {
  const { NextResponse } = await import('next/server');
  return {
    fail: (status: number, error: string, extra = {}) =>
      NextResponse.json({ ok: false, error, ...extra }, { status }),
    projectForKey: async () => state.gate,
  };
});
vi.mock('@/lib/drive/fetch-file', () => ({ fetchDriveFileForProject: state.fetch }));
vi.mock('@/lib/check-run', () => ({
  CheckRunError: class extends Error {},
  openRun: state.openRun,
  evaluateRun: state.evaluateRun,
}));
vi.mock('@vercel/functions', () => ({ waitUntil: state.waitUntil }));

import { POST } from '@/app/api/v1/projects/[id]/check-runs/route';

const call = (body: unknown) =>
  POST(new Request('https://x.test', { method: 'POST', body: JSON.stringify(body) }), {
    params: { id: 'lot-91-wavecrest' },
  });

const OPEN_GATE = { ok: true, key: { id: 'k1', name: 'Kira', project_ids: ['p1'] }, projectId: 'p1' };

beforeEach(() => {
  state.gate = OPEN_GATE;
  state.existing = null;
  state.fetch.mockReset().mockResolvedValue({ ok: true, name: 'carport.pdf', bytes: Buffer.from('x') });
  state.openRun
    .mockReset()
    .mockResolvedValue({ runId: 'run-1', combinedText: '', fileSummaries: [{ name: 'carport.pdf' }], warnings: [] });
  state.evaluateRun.mockReset().mockResolvedValue({});
  state.waitUntil.mockReset();
});

describe('starting a check', () => {
  it('needs a request id and at least one file', async () => {
    expect((await call({ driveFileIds: ['f1'] })).status).toBe(400);
    expect((await call({ requestId: 'r1', driveFileIds: [] })).status).toBe(400);
    expect(state.openRun).not.toHaveBeenCalled();
  });

  it('a file Preflight cannot see stops the run before anything is recorded, with the reason', async () => {
    state.fetch.mockResolvedValueOnce({
      ok: false,
      reason: 'not_visible',
      message: 'Share it with dennis@factory2key.com.au.',
    });
    const res = await call({ requestId: 'r1', driveFileIds: ['f1'] });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, reason: 'not_visible', error: expect.stringMatching(/factory2key/) });
    expect(state.openRun).not.toHaveBeenCalled();
  });

  it('one unreadable file in a set stops the whole run — never a partial check', async () => {
    state.fetch
      .mockResolvedValueOnce({ ok: true, name: 'a.pdf', bytes: Buffer.from('x') })
      .mockResolvedValueOnce({ ok: false, reason: 'not_pdf', message: '"b.dwg" is not a PDF' });
    const res = await call({ requestId: 'r1', driveFileIds: ['a', 'b'] });
    expect(res.status).toBe(422);
    expect(state.openRun).not.toHaveBeenCalled();
  });

  it('takes the request id from an Idempotency-Key header, as the orchestrator sends it', async () => {
    const res = await POST(
      new Request('https://x.test', {
        method: 'POST',
        headers: { 'idempotency-key': 'effect-9' },
        body: JSON.stringify({ driveFileIds: ['f1'] }),
      }),
      { params: { id: 'lot-91-wavecrest' } },
    );
    expect(res.status).toBe(202);
    expect(state.openRun.mock.calls[0][5]).toEqual({ request_id: 'effect-9' });
  });

  it('a retry with the same request id returns the run it already started', async () => {
    state.existing = { id: 'run-0', status: 'running' };
    const body = await (await call({ requestId: 'r1', driveFileIds: ['f1'] })).json();
    expect(body).toMatchObject({ ok: true, runId: 'run-0', replayed: true });
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('answers 202 with the run id and leaves the evaluation running after the reply', async () => {
    const res = await call({ requestId: 'r1', driveFileIds: ['f1', 'f1'] });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ ok: true, runId: 'run-1', status: 'running', replayed: false });
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(state.openRun.mock.calls[0][5]).toEqual({ request_id: 'r1' });
    expect(state.waitUntil).toHaveBeenCalledTimes(1);
  });

  it('a refused key never reaches a file', async () => {
    const { NextResponse } = await import('next/server');
    state.gate = { ok: false, response: NextResponse.json({ ok: false }, { status: 404 }) };
    expect((await call({ requestId: 'r1', driveFileIds: ['f1'] })).status).toBe(404);
    expect(state.fetch).not.toHaveBeenCalled();
  });
});
