/**
 * A SHEET IS READ ONCE, AND EVERY LATER RUN USES THAT READING.
 *
 * Measured 2026-11-19 on the Lot 91 carport set (S262646, nine drawn sheets): three
 * runs on byte-identical files produced three different transcriptions. The
 * "50X150 JOIST (T25/W.R)" note was read once in three, `[illegible]` markers went
 * 0 / 8 / 0, and one run invented labels that are not on the sheet. The verdicts
 * flipped between hard fail and review because the TEXT changed, not the drawing.
 *
 * So the reading is keyed by what the file IS (sha256 of its bytes) and by which
 * reader produced it (READER_VERSION). Same file, same reader → same text, with no
 * model call. A new revision of a sheet has new bytes and is read fresh; a better
 * reader bumps the version and re-reads everything.
 *
 *   bytes ─sha256─► saved (hash, version)? ──yes──► saved text, ms 0
 *                          │ no, or reread
 *                          ▼
 *                    transcribe() ──ok──► save ──► text
 *                          │ failed ──► nothing saved (a failure is never cached)
 *
 * ⚠️ A SAVED READING ALSO SAVES ITS MISTAKES. Repeatability is not accuracy: a reading
 * that missed a note misses it on every run. `reread` throws the saved one away, and
 * the S262646 gate (scripts/gate-s262646.mjs) checks that the reading we keep has the
 * notes that matter.
 *
 * Storage failures never block a check: a lookup that fails reads the sheet as before,
 * and a save that fails is logged and the run carries on with the text in hand.
 */

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { READER_VERSION, transcribePdf, type TranscribeResult } from '@/lib/pdf/transcribe';

export type Transcriber = (name: string, bytes: Buffer, pages: number) => Promise<TranscribeResult>;
type LogFn = (phase: string, extra?: Record<string, unknown>) => void;

export function contentHash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface SavedReadingOptions {
  /** Discard any saved reading for these files and read them again. */
  reread?: boolean;
  /** The reader behind the store; tests pass a fake. */
  transcribe?: Transcriber;
  readerVersion?: string;
}

/**
 * A transcriber that consults the saved readings first. Drop-in for `transcribePdf`
 * wherever a `Transcriber` is taken.
 */
export function savedReadingTranscriber(
  db: SupabaseClient,
  log: LogFn,
  options: SavedReadingOptions = {},
): Transcriber {
  const transcribe = options.transcribe ?? transcribePdf;
  const readerVersion = options.readerVersion ?? READER_VERSION;

  return async (name, bytes, pages) => {
    const hash = contentHash(bytes);

    if (options.reread) {
      const { error } = await db
        .from('sheet_readings')
        .delete()
        .eq('content_sha256', hash)
        .eq('reader_version', readerVersion);
      if (error) log('saved-reading-discard-failed', { name, error: error.message });
      else log('saved-reading-discarded', { name });
    } else {
      const { data, error } = await db
        .from('sheet_readings')
        .select('text')
        .eq('content_sha256', hash)
        .eq('reader_version', readerVersion)
        .maybeSingle();
      if (error) log('saved-reading-lookup-failed', { name, error: error.message });
      const saved = (data as { text?: unknown } | null)?.text;
      if (typeof saved === 'string' && saved.trim() !== '') {
        log('saved-reading-used', { name, textLen: saved.length });
        return { ok: true, text: saved, ms: 0 };
      }
    }

    const got = await transcribe(name, bytes, pages);
    // `in`, not `.ok`: tsconfig has strict:false, which does not narrow on a boolean tag.
    if ('text' in got) {
      const { error } = await db.from('sheet_readings').upsert(
        {
          content_sha256: hash,
          reader_version: readerVersion,
          file_name: name,
          text: got.text,
          read_ms: got.ms,
        },
        { onConflict: 'content_sha256,reader_version' },
      );
      if (error) log('saved-reading-save-failed', { name, error: error.message });
      else log('saved-reading-saved', { name, textLen: got.text.length });
    }
    return got;
  };
}
