/**
 * PDF extraction — v0 stub.
 *
 * The real implementation uses `pdf-parse` (Node) for born-digital PDFs and
 * `pdfjs-dist` for vector / CAD-style PDFs where positioned text matters
 * (title blocks, legends, dimension strings). The CAD-PDF path is the
 * non-trivial one and is deferred to a follow-up turn.
 *
 * For v0 the extractor returns a `{ text, pages, warnings }` object. If
 * the buffer parses cleanly via pdf-parse, we return its text. If not,
 * we return a marker string so the rule engine can produce a clear
 * "extraction failed, manual review required" outcome rather than a
 * silent false-pass.
 */

export interface ExtractedSet {
  text: string;
  page_count: number;
  warnings: string[];
  extraction_method: 'pdf-parse' | 'cad-pdf' | 'failed';
}

export async function extractPdf(buffer: Buffer): Promise<ExtractedSet> {
  try {
    // Dynamic import — pdf-parse is a heavy CJS module; only loaded when needed.
    const pdfParse = (await import('pdf-parse')).default;
    const result = await pdfParse(buffer);
    return {
      text: result.text || '',
      page_count: result.numpages || 0,
      warnings:
        result.text && result.text.length > 50
          ? []
          : ['Extracted text is very short — possibly a vector/CAD PDF requiring positioned-text extraction (deferred)'],
      extraction_method: 'pdf-parse',
    };
  } catch (e) {
    return {
      text: '',
      page_count: 0,
      warnings: [`Extraction failed: ${(e as Error).message}`],
      extraction_method: 'failed',
    };
  }
}
