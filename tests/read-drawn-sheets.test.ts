import { afterEach, describe, expect, it, vi } from 'vitest';
import { isUnread, readableChars, transcribePdf, VISION_MAX_BYTES } from '@/lib/pdf/transcribe';
import { evaluateRun, readUnreadFiles, type OpenedRun } from '@/lib/check-run';
import { describeRun, type RunRow } from '@/lib/api-v1';

const log = () => {};

describe('what counts as a sheet that was read', () => {
  it('page markers and whitespace are not content — the carport sheets came back as exactly this', () => {
    expect(readableChars('--- PAGE 1 ---\n  \n')).toBe(0);
    expect(isUnread('--- PAGE 1 ---\n4 M')).toBe(true);
  });

  it('a sheet with real notes is read', () => {
    expect(isUnread('GENERAL NOTES 1. ALL WORK TO AS 1170.2 REGION B2. DESIGN WIND SPEED VR 69 m/s TERRAIN CAT 2')).toBe(false);
  });
});

describe('reading a drawn sheet refuses cleanly when it cannot', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('without a direct Anthropic key it says so, never sends the PDF elsewhere', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const got = await transcribePdf('S-031.pdf', Buffer.from('%PDF'), 1);
    expect(got).toEqual({ ok: false, reason: expect.stringMatching(/needs ANTHROPIC_API_KEY/) });
  });

  it('an oversize file is refused before any call', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    const got = await transcribePdf('huge.pdf', Buffer.alloc(VISION_MAX_BYTES + 1), 1);
    expect(got).toEqual({ ok: false, reason: expect.stringMatching(/too large/) });
  });
});

const opened = (unreadNames: string[], readNames: string[] = []): OpenedRun => {
  const names = [...readNames, ...unreadNames];
  return {
    runId: 'run-1',
    drawingSetId: 'set-1',
    combinedText: '',
    fileSummaries: names.map((name) => ({ name, bytes: 10, pages: 1, extraction_method: 'pdf-parse' })),
    warnings: [],
    sections: names.map((name) => `=== FILE: ${name} ===\n${readNames.includes(name) ? 'TITLE BLOCK LOT 91 BROWNLIE ST' : ''}`),
    unread: unreadNames.map((name) => ({ index: names.indexOf(name), file: { name, bytes: Buffer.from('%PDF') }, pages: 1 })),
  };
};

describe('unread sheets are read from the image before any rule runs', () => {
  it('a transcription replaces the empty text and is marked as read from the drawing', async () => {
    const run = opened(['S-031.pdf'], ['S-001.pdf']);
    const transcribe = vi.fn().mockResolvedValue({ ok: true, text: 'LEDGER CHANNEL FIXED TO EXISTING WALL STUDS', ms: 5 });

    const unreadable = await readUnreadFiles(run, log, transcribe);

    expect(unreadable).toEqual([]);
    expect(transcribe).toHaveBeenCalledTimes(1); // only the unread sheet costs a call
    expect(run.combinedText).toContain('=== FILE: S-031.pdf ===\nLEDGER CHANNEL FIXED TO EXISTING WALL STUDS');
    expect(run.combinedText).toContain('TITLE BLOCK LOT 91');
    expect(run.fileSummaries.map((f) => f.extraction_method)).toEqual(['pdf-parse', 'vision']);
  });

  it('a sheet that still cannot be read is named, with the reason, in the warnings', async () => {
    const run = opened(['S-032.pdf'], ['S-001.pdf']);
    const unreadable = await readUnreadFiles(run, log, async () => ({ ok: false, reason: 'the drawing could not be read' }));
    expect(unreadable).toEqual([{ name: 'S-032.pdf', reason: 'the drawing could not be read' }]);
    expect(run.warnings[0]).toMatch(/S-032\.pdf: no text could be read .* Nothing on this sheet was checked\./);
  });
});

describe('a set where nothing could be read is a failed run, never a result', () => {
  it('marks the run failed with the reason and loads no rules', async () => {
    const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
    const db = {
      from: (table: string) => ({
        update: (values: Record<string, unknown>) => {
          updates.push({ table, values });
          return { eq: async () => ({ error: null }) };
        },
        select: () => {
          throw new Error('the register must not be read for an unreadable set');
        },
      }),
    };
    const run = opened(['S-001.pdf', 'S-002.pdf']);

    await expect(
      evaluateRun(db as never, 'p1', run, log, async () => ({ ok: false, reason: 'reading the drawing failed: overloaded' })),
    ).rejects.toThrow(/couldn't read any text from the 2 sheets, even from the drawing image \(reading the drawing failed: overloaded\)/);

    expect(updates).toEqual([
      { table: 'check_runs', values: expect.objectContaining({ status: 'failed', error: expect.stringMatching(/couldn't read any text/) }) },
    ]);
  });
});

const finished = (payload: Record<string, unknown>): RunRow => ({
  id: 'r1',
  project_id: 'a',
  status: 'completed',
  started_at: '2026-11-19T00:04:22Z',
  completed_at: '2026-11-19T00:05:30Z',
  hard_fails: 2,
  needs_review: 5,
  confirmed_ok: 4,
  triage_payload: payload,
  error: null,
});

describe('the sentence says how much of the set was actually looked at', () => {
  it('sheets read from the image are flagged for checking against the sheet', () => {
    const d = describeRun(
      finished({ files: [{ name: 'S-001.pdf', extraction_method: 'vision' }, { name: 'S-031.pdf', extraction_method: 'vision' }] }),
      'Lot 91 Wavecrest',
    );
    expect(d.message).toMatch(/2 hard fails, 5 items that need eyes, 4 confirmed OK\. All 2 sheets were read from the drawing image/);
  });

  it('an unread sheet is named as not checked', () => {
    const d = describeRun(
      finished({
        files: [{ name: 'S-001.pdf', extraction_method: 'vision' }, { name: 'S-032.pdf', extraction_method: 'pdf-parse' }],
        unreadable_files: ['S-032.pdf'],
      }),
      'Lot 91 Wavecrest',
    );
    expect(d.message).toMatch(/1 of the 2 sheets were read from the drawing image.*Nothing could be read from S-032\.pdf, so that sheet was not checked\./);
  });

  it('a born-digital set reads exactly as before', () => {
    const d = describeRun(finished({ files: [{ name: 'a.pdf', extraction_method: 'cad-pdf' }] }), 'Lot 91');
    expect(d.message).toBe('The Lot 91 check on a.pdf finished: 2 hard fails, 5 items that need eyes, 4 confirmed OK.');
  });
});
