/**
 * OCR fallback for image-only PDFs.
 *
 * When the pdfjs / pdf-parse text path returns too little text (typically
 * a scanned PDF where there's no text layer), we hand the raw bytes to
 * Claude's native document support. Haiku is plenty for OCR — the task
 * is "read the visible glyphs", not reasoning.
 *
 * Kept out of the upload happy path: every PDF ingest could pay for OCR,
 * but we only want it when the cheap text-extraction path failed. Callers
 * gate via the enableOcr option on extractFile().
 */

import { anthropic, MODEL_HAIKU } from './anthropic';

const SYSTEM_PROMPT =
  'Extract all readable text from this PDF. Return ONLY the extracted text, line by line, no commentary or formatting. If a page has no readable text, write "(no readable text on this page)".';

const MAX_TOKENS = 4000;

export async function ocrPdfWithClaude(buf: Buffer): Promise<string> {
  const base64 = buf.toString('base64');
  const msg = await anthropic().messages.create({
    model: MODEL_HAIKU,
    max_tokens: MAX_TOKENS,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 },
          },
          { type: 'text', text: SYSTEM_PROMPT },
        ],
      },
    ],
  });
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('\n');
}
