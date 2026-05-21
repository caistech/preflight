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

export type ExtractedFormat =
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'csv'
  | 'txt'
  | 'md'
  | 'html'
  | 'unknown';

export interface FileExtractionResult {
  text: string;
  format: ExtractedFormat;
  warnings: string[];
  // Surfaced for structured paths (xlsx/csv) so a downstream consumer can
  // re-parse with column awareness without re-uploading the bytes.
  rawBuffer?: Buffer;
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
): Promise<FileExtractionResult> {
  const format = detectFormat(filename, mimeType);

  switch (format) {
    case 'pdf': {
      const r = await extractPdf(buffer);
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
