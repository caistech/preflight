/**
 * READING A SHEET THAT HAS NO TEXT LAYER.
 *
 * CAD exports often draw every letter as vector outlines, so pdfjs and pdf-parse
 * both return nothing — the Lot 91 carport set (S262646, nine sheets) extracted to
 * two characters each, and every rule came back "unsure" because the model was
 * looking at blank pages. A run on that text is not a result; it is noise that reads
 * like one.
 *
 * For such a sheet the PDF itself goes to Claude as a document and comes back as a
 * transcription, which then stands in for the extracted text. Everything downstream
 * — the deterministic rules, the slicer, the manual checks — runs unchanged on it, so
 * a drawn sheet and a born-digital sheet are checked by the same engine.
 *
 * The transcription keeps two things apart, because they deserve different trust:
 * what is WRITTEN on the sheet (copied, never corrected), and what the drawing SHOWS
 * (the model's reading of a detail — "ledger channel fixed to the existing wall
 * studs"). The second is labelled as interpretation so a rule never mistakes it for a
 * note the engineer wrote.
 *
 * One call per unreadable sheet, not per rule: the cost lands once, on the user's own
 * key (BYOK totality).
 */

import { anthropic, anthropicIsDirect, MODEL_MANUAL_CHECK } from '@/lib/ai/anthropic';

/**
 * Which reader produced a saved reading (lib/pdf/sheet-readings.ts). Bump it whenever
 * the prompt, model or settings below change, so every sheet is read again by the new
 * reader instead of a stale reading being reused.
 */
export const READER_VERSION = 'pdf-document-temp0-2026-11-19';

/** Below this many meaningful characters a sheet is treated as unread. */
export const READABLE_MIN_CHARS = 50;

/** Anthropic caps a request at 32 MB; base64 inflates by a third. */
export const VISION_MAX_BYTES = 24 * 1024 * 1024;
export const VISION_MAX_PAGES = 100;

export const WRITTEN_HEADING = '[WRITTEN ON THE SHEET — transcribed from the drawing image]';
export const SHOWN_HEADING = '[WHAT THE DRAWING SHOWS — the reader\'s description, not text on the sheet]';

/** Characters that carry content: page markers and whitespace do not count. */
export function readableChars(text: string): number {
  return text.replace(/---\s*PAGE\s*\d+\s*---/gi, '').replace(/\s+/g, '').length;
}

export function isUnread(text: string): boolean {
  return readableChars(text) < READABLE_MIN_CHARS;
}

const SYSTEM = `You transcribe building and engineering drawing sheets for a pre-submission checking tool. You do not review, judge or check anything.

Return two sections, with these headings exactly:

${WRITTEN_HEADING}
Every piece of text on the sheet, in reading order, grouped by where it sits: title block (every field, including empty ones — write "(blank)"), general notes, design criteria, schedules and tables, detail and section titles, labels and callouts, dimensions, levels and RLs. Copy exactly as drawn — spelling, units, abbreviations. Never correct, complete or guess. Write [illegible] for anything you cannot read.

${SHOWN_HEADING}
For each detail, section and plan on the sheet: one or two plain sentences on what it shows — the members, what each is fixed to and how, what bears on what, the materials named. Describe only what is drawn. Where the drawing does not make something clear, say so.

For a multi-page document, start each page with "--- PAGE N ---".`;

export type TranscribeResult =
  | { ok: true; text: string; ms: number }
  | { ok: false; reason: string };

/** Transcribe one PDF that has no usable text layer. Never throws. */
export async function transcribePdf(
  name: string,
  bytes: Buffer,
  pages: number,
  timeoutMs = 150_000,
): Promise<TranscribeResult> {
  if (!anthropicIsDirect()) {
    return { ok: false, reason: 'reading drawn sheets needs ANTHROPIC_API_KEY (the OpenRouter route cannot take a PDF)' };
  }
  if (bytes.byteLength > VISION_MAX_BYTES) {
    return { ok: false, reason: `too large to read as a drawing (${Math.round(bytes.byteLength / 1048576)} MB; limit 24 MB)` };
  }
  if (pages > VISION_MAX_PAGES) {
    return { ok: false, reason: `too many pages to read as a drawing (${pages}; limit ${VISION_MAX_PAGES})` };
  }

  const t0 = Date.now();
  try {
    const msg = await anthropic().messages.create(
      {
        model: MODEL_MANUAL_CHECK,
        max_tokens: 8000,
        // A transcription is a copy, not a composition. At the default temperature
        // the same sheet read differently on every run (S262646, 2026-11-19).
        temperature: 0,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') },
              },
              { type: 'text', text: `Transcribe this sheet (${name}).` },
            ],
          },
        ],
      },
      { timeout: timeoutMs, maxRetries: 1 },
    );
    const text = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('\n')
      .trim();
    if (isUnread(text)) return { ok: false, reason: 'the drawing could not be read' };
    return { ok: true, text, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, reason: `reading the drawing failed: ${(e as Error).message}` };
  }
}
