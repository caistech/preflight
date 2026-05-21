/**
 * Per-format file → text extractor. Dispatches by extension/MIME and
 * returns a normalised { text, warnings, format } shape so the upload
 * route stays uniform across formats.
 *
 * Unstructured formats flatten to text for KB chunking + embedding.
 * Structured formats (xlsx, csv) also flatten here — schema-aware
 * destinations (project_units, project_facts via the facts proposer)
 * read the original bytes separately when needed.
 */

import { extractPdf } from '@/lib/pdf/extract';
import { ocrPdfWithClaude } from '@/lib/ai/ocr-pdf';

export type ExtractedFormat =
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'csv'
  | 'txt'
  | 'md'
  | 'html'
  | 'dwg'
  | 'unknown';

export interface FileExtractionResult {
  text: string;
  format: ExtractedFormat;
  warnings: string[];
  // Surfaced for structured paths (xlsx/csv) so a downstream consumer can
  // re-parse with column awareness without re-uploading the bytes.
  rawBuffer?: Buffer;
  /** True when the OCR fallback ran (PDF returned <50 chars from the text
   *  layer AND the caller enabled enableOcr). Surfaced so the operator UI
   *  can warn "extracted via OCR — verify accuracy". */
  ocr_used?: boolean;
}

export interface ExtractFileOptions {
  /**
   * When true and the PDF text-extract path produces less than 50 chars,
   * fall back to Claude Haiku document OCR. Off by default — every PDF
   * ingest would otherwise pay for OCR when a born-digital extract would
   * have been free. Callers opt in (operator upload, inbound attachments,
   * Drive sync). The drafter route does NOT opt in: CAD-PDFs are
   * born-digital by definition.
   */
  enableOcr?: boolean;
}

const EXTENSION_MAP: Record<string, ExtractedFormat> = {
  pdf: 'pdf',
  docx: 'docx',
  xlsx: 'xlsx',
  xls: 'xlsx',
  csv: 'csv',
  tsv: 'csv',
  txt: 'txt',
  md: 'md',
  markdown: 'md',
  html: 'html',
  htm: 'html',
  // Recognised-but-unsupported native CAD formats. We return format='dwg' /
  // 'unknown' with a clear warning so the upload route can 415 with a
  // helpful message rather than trying to UTF-8 a binary file.
  dwg: 'dwg',
  dxf: 'dwg',
};

function detectFormat(filename: string, mimeType: string): ExtractedFormat {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (EXTENSION_MAP[ext]) return EXTENSION_MAP[ext];

  // MIME fallback for cases where extension is missing
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.includes('wordprocessingml')) return 'docx';
  if (mimeType.includes('spreadsheetml') || mimeType.includes('ms-excel')) return 'xlsx';
  if (mimeType === 'text/csv' || mimeType === 'text/tab-separated-values') return 'csv';
  if (mimeType === 'text/markdown') return 'md';
  if (mimeType.startsWith('text/html')) return 'html';
  if (mimeType.startsWith('text/')) return 'txt';

  return 'unknown';
}

export async function extractFile(
  filename: string,
  mimeType: string,
  buffer: Buffer,
  options: ExtractFileOptions = {},
): Promise<FileExtractionResult> {
  const format = detectFormat(filename, mimeType);

  switch (format) {
    case 'pdf': {
      const r = await extractPdf(buffer);
      // OCR fallback when the text-layer extract returned almost nothing
      // AND the caller opted in. We don't auto-OCR every PDF because most
      // are born-digital and OCR is expensive — the gate is "the cheap
      // path failed AND the caller is willing to pay".
      if (options.enableOcr && (!r.text || r.text.length < 50)) {
        try {
          const ocrText = await ocrPdfWithClaude(buffer);
          if (ocrText && ocrText.trim().length > 50) {
            return {
              text: ocrText,
              format,
              warnings: [...r.warnings, 'Extracted via Claude OCR fallback — verify accuracy.'],
              ocr_used: true,
            };
          }
        } catch (e) {
          return {
            text: r.text,
            format,
            warnings: [...r.warnings, `OCR fallback failed: ${(e as Error).message}`],
          };
        }
      }
      return { text: r.text, format, warnings: r.warnings };
    }

    case 'docx': {
      // mammoth produces plain text; for richer extraction (tables, lists)
      // we'd switch to extractMessages or convertToHtml + strip.
      const mammoth = (await import('mammoth')).default;
      const r = await mammoth.extractRawText({ buffer });
      const warnings = (r.messages ?? [])
        .filter((m) => m.type === 'warning' || m.type === 'error')
        .map((m) => `mammoth ${m.type}: ${m.message}`);
      return { text: r.value ?? '', format, warnings };
    }

    case 'xlsx': {
      // Parse every sheet, flatten to CSV-style text with sheet headers so
      // chunking preserves which sheet a row came from.
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const sections: string[] = [];
      const warnings: string[] = [];
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) {
          warnings.push(`Sheet "${sheetName}" was empty or unreadable`);
          continue;
        }
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        sections.push(`=== SHEET: ${sheetName} ===\n${csv}`);
      }
      return {
        text: sections.join('\n\n'),
        format,
        warnings,
        rawBuffer: buffer,
      };
    }

    case 'csv': {
      // CSV is already text; just normalise line endings.
      const text = buffer.toString('utf-8').replace(/\r\n/g, '\n');
      return { text, format, warnings: [], rawBuffer: buffer };
    }

    case 'html': {
      // Strip tags inline — same logic as fetchUrlAsText, kept here so the
      // upload path doesn't have to import the URL ingest module.
      const html = buffer.toString('utf-8');
      const stripped = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
      return { text: stripped, format, warnings: [] };
    }

    case 'txt':
    case 'md':
      return { text: buffer.toString('utf-8'), format, warnings: [] };

    case 'dwg':
      return {
        text: '',
        format,
        warnings: [
          `${filename} is a native CAD format (DWG/DXF). Preflight does not extract native CAD; export to PDF from your drafting tool and upload that instead.`,
        ],
      };

    case 'unknown':
    default: {
      // Last-ditch UTF-8 read for unrecognised types. If the file is binary
      // the result will be garbage; caller decides whether to keep it.
      const text = buffer.toString('utf-8');
      return {
        text,
        format: 'unknown',
        warnings: [
          `Unrecognised format for "${filename}" (mime: ${mimeType || 'none'}). Read as UTF-8 — text may be garbled if the file is binary.`,
        ],
      };
    }
  }
}
