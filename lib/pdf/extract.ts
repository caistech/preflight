/**
 * PDF extraction.
 *
 * Strategy:
 *   1. Try pdfjs-dist with positioned-text extraction. Best for CAD-PDFs
 *      (drawing sets) because it preserves spatial grouping — items are
 *      grouped by Y coordinate (top-down) and sorted within a row by X
 *      coordinate. This is what lets boundary labels, dimension strings,
 *      letterbox cell labels, and title-block fields come through as
 *      readable text instead of getting jumbled.
 *   2. If pdfjs returns nothing useful, fall back to pdf-parse — the
 *      simpler stream extractor that works fine for born-digital PDFs
 *      (planner letters, Council audit reports, engineer notes).
 *
 * Output preserves a `--- PAGE N ---` marker between pages so downstream
 * rules can grep for sheet references (A102, A109, etc.).
 */

export interface ExtractedSet {
  text: string;
  page_count: number;
  warnings: string[];
  extraction_method: 'cad-pdf' | 'pdf-parse' | 'failed';
}

export async function extractPdf(buffer: Buffer): Promise<ExtractedSet> {
  const diagnostics: string[] = [];

  // Try the positioned-text path first.
  try {
    const positioned = await extractWithPdfjs(buffer);
    if (positioned.text.length >= 100) {
      return positioned;
    }
    diagnostics.push(`pdfjs returned only ${positioned.text.length} chars — falling back to pdf-parse`);
  } catch (e) {
    diagnostics.push(`pdfjs path failed: ${(e as Error).message}`);
  }

  // Fallback: pdf-parse for born-digital prose PDFs.
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const result = await pdfParse(buffer);
    const warnings: string[] = [...diagnostics];
    if (!result.text || result.text.length < 50) {
      warnings.push('Both pdfjs-positioned and pdf-parse returned very little text — a drawn or scanned sheet; the check run reads it from the drawing image (lib/pdf/transcribe.ts)');
    }
    return {
      text: result.text || '',
      page_count: result.numpages || 0,
      warnings,
      extraction_method: 'pdf-parse',
    };
  } catch (e) {
    return {
      text: '',
      page_count: 0,
      warnings: [...diagnostics, `pdf-parse also failed: ${(e as Error).message}`],
      extraction_method: 'failed',
    };
  }
}

interface PdfjsTextItem {
  str: string;
  transform: number[];
}

async function extractWithPdfjs(buffer: Buffer): Promise<ExtractedSet> {
  // Use the legacy build — ships an ESM bundle that runs in Node serverless.
  // We must point workerSrc at the worker module file. The createRequire
  // pattern is the Node-stable way to resolve a package-relative file path;
  // import.meta.resolve() works locally but turns out flaky inside Vercel's
  // serverless Node 20 runtime.
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    const { createRequire } = await import('module');
    const requireFn = createRequire(import.meta.url);
    pdfjsLib.GlobalWorkerOptions.workerSrc = requireFn.resolve(
      'pdfjs-dist/legacy/build/pdf.worker.mjs'
    );
  }

  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    standardFontDataUrl: undefined,
  }).promise;

  const pageTexts: string[] = [];
  const warnings: string[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    try {
      const page = await doc.getPage(pageNum);
      const tc = await page.getTextContent();

      // Group items by Y coordinate (rounded to 2px tolerance for AA
      // jitter); preserves rows. Within each row, sort by X.
      const rows = new Map<number, Array<{ x: number; str: string }>>();
      for (const item of tc.items as PdfjsTextItem[]) {
        if (typeof item.str !== 'string') continue;
        const str = item.str.trim();
        if (!str) continue;
        const y = Math.round((item.transform?.[5] ?? 0) / 2) * 2;
        const x = item.transform?.[4] ?? 0;
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y)!.push({ x, str });
      }

      // Page coordinate system: top-left origin in display, but pdfjs
      // returns coords from bottom-left, so higher Y = higher on page.
      const sortedYs = [...rows.keys()].sort((a, b) => b - a);
      const lines: string[] = [];
      for (const y of sortedYs) {
        const items = rows.get(y)!.sort((a, b) => a.x - b.x);
        const lineText = items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
        if (lineText) lines.push(lineText);
      }

      pageTexts.push(`--- PAGE ${pageNum} ---\n` + lines.join('\n'));
    } catch (e) {
      warnings.push(`Page ${pageNum} extraction errored: ${(e as Error).message}`);
    }
  }

  const text = pageTexts.join('\n\n');

  return {
    text,
    page_count: doc.numPages,
    warnings,
    extraction_method: 'cad-pdf',
  };
}
