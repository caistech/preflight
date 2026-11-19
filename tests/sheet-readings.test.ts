// A drawn sheet is read once; every later run checks the same text.
//
//   hit  → saved text, no model call
//   miss → read, saved under (sha256, reader version)
//   fail → nothing saved (a failure is never cached)
//   reread → saved reading discarded, read again, saved again
//   storage down → the sheet is still read; the check never blocks on the store

import { describe, expect, it, vi } from 'vitest';
import { contentHash, savedReadingTranscriber } from '@/lib/pdf/sheet-readings';
import { READER_VERSION } from '@/lib/pdf/transcribe';

const log = () => {};
const SHEET = Buffer.from('%PDF-1.7 S-031 STD DETAILS');

type Row = { content_sha256: string; reader_version: string; text: string; file_name?: string; read_ms?: number };

/** The slice of the Supabase client the store uses, backed by an array. */
function fakeDb(rows: Row[] = [], opts: { lookupError?: string; saveError?: string } = {}) {
  const calls = { deletes: 0, upserts: [] as Row[] };
  const db = {
    from: (table: string) => {
      expect(table).toBe('sheet_readings');
      const filters: Record<string, string> = {};
      const chain = {
        select: () => chain,
        delete: () => {
          calls.deletes++;
          const del = {
            eq: (col: string, val: string) => {
              filters[col] = val;
              return Object.keys(filters).length === 2
                ? (() => {
                    for (let i = rows.length - 1; i >= 0; i--) {
                      if (rows[i].content_sha256 === filters.content_sha256 && rows[i].reader_version === filters.reader_version) rows.splice(i, 1);
                    }
                    return Promise.resolve({ error: null });
                  })()
                : del;
            },
          };
          return del;
        },
        eq: (col: string, val: string) => {
          filters[col] = val;
          return chain;
        },
        maybeSingle: async () => {
          if (opts.lookupError) return { data: null, error: { message: opts.lookupError } };
          const hit = rows.find((r) => r.content_sha256 === filters.content_sha256 && r.reader_version === filters.reader_version);
          return { data: hit ?? null, error: null };
        },
        upsert: async (row: Row) => {
          calls.upserts.push(row);
          if (opts.saveError) return { error: { message: opts.saveError } };
          rows.push(row);
          return { error: null };
        },
      };
      return chain;
    },
  };
  return { db: db as never, calls, rows };
}

describe('a sheet is read once and reused', () => {
  it('the same bytes give the same key', () => {
    expect(contentHash(SHEET)).toBe(contentHash(Buffer.from(SHEET)));
    expect(contentHash(SHEET)).not.toBe(contentHash(Buffer.from('%PDF-1.7 S-031 REV B')));
    expect(contentHash(SHEET)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a saved reading is returned with no model call', async () => {
    const { db } = fakeDb([{ content_sha256: contentHash(SHEET), reader_version: READER_VERSION, text: '50X150 JOIST (T25/W.R)' }]);
    const transcribe = vi.fn();
    const got = await savedReadingTranscriber(db, log, { transcribe })('S-031.pdf', SHEET, 1);
    expect(got).toEqual({ ok: true, text: '50X150 JOIST (T25/W.R)', ms: 0 });
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('an unread sheet is read and saved under its hash and the reader version', async () => {
    const { db, calls } = fakeDb();
    const transcribe = vi.fn().mockResolvedValue({ ok: true, text: 'LEDGER CHANNEL 105x50', ms: 900 });
    const got = await savedReadingTranscriber(db, log, { transcribe })('S-031.pdf', SHEET, 1);
    expect(got).toEqual({ ok: true, text: 'LEDGER CHANNEL 105x50', ms: 900 });
    expect(calls.upserts).toEqual([
      { content_sha256: contentHash(SHEET), reader_version: READER_VERSION, file_name: 'S-031.pdf', text: 'LEDGER CHANNEL 105x50', read_ms: 900 },
    ]);
  });

  it('a second run on the same file makes no model call', async () => {
    const { db } = fakeDb();
    const transcribe = vi.fn().mockResolvedValue({ ok: true, text: 'LEDGER CHANNEL 105x50', ms: 900 });
    const reader = savedReadingTranscriber(db, log, { transcribe });
    await reader('S-031.pdf', SHEET, 1);
    const second = await reader('S-031.pdf', SHEET, 1);
    expect(second).toEqual({ ok: true, text: 'LEDGER CHANNEL 105x50', ms: 0 });
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it('a reading from an older reader version is not reused', async () => {
    const { db } = fakeDb([{ content_sha256: contentHash(SHEET), reader_version: 'old-reader', text: 'stale' }]);
    const transcribe = vi.fn().mockResolvedValue({ ok: true, text: 'fresh', ms: 1 });
    const got = await savedReadingTranscriber(db, log, { transcribe })('S-031.pdf', SHEET, 1);
    expect(got).toMatchObject({ text: 'fresh' });
    expect(transcribe).toHaveBeenCalledTimes(1);
  });
});

describe('what is never saved, and the way out of a bad reading', () => {
  it('a failed reading is not saved, so the next run tries again', async () => {
    const { db, calls } = fakeDb();
    const transcribe = vi.fn().mockResolvedValue({ ok: false, reason: 'the drawing could not be read' });
    const got = await savedReadingTranscriber(db, log, { transcribe })('S-032.pdf', SHEET, 1);
    expect(got).toEqual({ ok: false, reason: 'the drawing could not be read' });
    expect(calls.upserts).toEqual([]);
  });

  it('reread discards the saved reading and reads the sheet again', async () => {
    const { db, calls, rows } = fakeDb([{ content_sha256: contentHash(SHEET), reader_version: READER_VERSION, text: 'missed the joist note' }]);
    const transcribe = vi.fn().mockResolvedValue({ ok: true, text: '50X150 JOIST (T25/W.R)', ms: 1200 });
    const got = await savedReadingTranscriber(db, log, { transcribe, reread: true })('S-031.pdf', SHEET, 1);
    expect(calls.deletes).toBe(1);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(got).toMatchObject({ text: '50X150 JOIST (T25/W.R)' });
    expect(rows.map((r) => r.text)).toEqual(['50X150 JOIST (T25/W.R)']);
  });
});

describe('the store never blocks a check', () => {
  it('a failed lookup still reads the sheet', async () => {
    const { db } = fakeDb([], { lookupError: 'connection reset' });
    const transcribe = vi.fn().mockResolvedValue({ ok: true, text: 'NOTES', ms: 1 });
    const got = await savedReadingTranscriber(db, log, { transcribe })('S-001.pdf', SHEET, 1);
    expect(got).toMatchObject({ ok: true, text: 'NOTES' });
  });

  it('a failed save still returns the text in hand', async () => {
    const { db } = fakeDb([], { saveError: 'insert failed' });
    const transcribe = vi.fn().mockResolvedValue({ ok: true, text: 'NOTES', ms: 1 });
    const got = await savedReadingTranscriber(db, log, { transcribe })('S-001.pdf', SHEET, 1);
    expect(got).toMatchObject({ ok: true, text: 'NOTES' });
  });
});
