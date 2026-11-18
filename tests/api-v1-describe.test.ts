import { describe, expect, it } from 'vitest';
import { describeRun, projectsNamedBy, type RunRow } from '@/lib/api-v1';

const projects = [
  { id: 'a', name: 'Lot 91 Wavecrest' },
  { id: 'b', name: 'Lot 442 Seafields' },
];

describe('naming a project the way he says it', () => {
  it.each([
    ['Lot 91', 'a'],
    ['lot 91 carport drawings', 'a'],
    ['Lot 91 Wavecrest', 'a'],
    ['the lot 442 job', 'b'],
  ])('%s → %s', (words, id) => {
    expect(projectsNamedBy(words, projects).map((p) => p.id)).toEqual([id]);
  });

  it('a number that only starts the same is not a match', () => {
    expect(projectsNamedBy('lot 9', projects)).toEqual([]);
    expect(projectsNamedBy('lot 911', projects)).toEqual([]);
  });

  it('two projects named at once come back as two, for the caller to ask', () => {
    expect(projectsNamedBy('lot 91 and lot 442', projects)).toHaveLength(2);
  });
});

const run = (over: Partial<RunRow> = {}): RunRow => ({
  id: 'r1',
  project_id: 'a',
  status: 'completed',
  started_at: '2026-11-18T10:00:00Z',
  completed_at: '2026-11-18T10:02:00Z',
  hard_fails: 1,
  needs_review: 3,
  confirmed_ok: 4,
  triage_payload: { files: [{ name: 'carport.pdf' }] },
  error: null,
  ...over,
});

describe('the sentence the caller reads out', () => {
  it('a finished run gives the counts and the files', () => {
    expect(describeRun(run(), 'Lot 91 Wavecrest').message).toBe(
      'The Lot 91 Wavecrest check on carport.pdf finished: 1 hard fail, 3 items that need eyes, 4 confirmed OK.',
    );
  });

  it('a running run says so and carries no result', () => {
    const d = describeRun(run({ status: 'running', completed_at: null }), 'Lot 91', new Date('2026-11-18T10:03:00Z'));
    expect(d.message).toMatch(/still running \(started 3 minutes ago\)/);
    expect(d.result).toBeNull();
    expect(d.counts).toBeNull();
  });

  it('a failed run is never described as a clean result', () => {
    const d = describeRun(run({ status: 'failed', error: 'Could not read the register' }), 'Lot 91');
    expect(d.message).toMatch(/did not finish: Could not read the register\. Nothing was checked\./);
    expect(d.counts).toBeNull();
  });

  it('reads the legacy "complete" status as completed', () => {
    expect(describeRun(run({ status: 'complete' }), 'Lot 91').status).toBe('completed');
  });
});
