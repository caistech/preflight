import { describe, it, expect, vi, beforeEach } from 'vitest';

// extract-file depends on pdfjs + pdf-parse via extractPdf. Mock those so
// tests stay fast and don't pull in the worker code.
const { mockExtractPdf, mockOcr, mockConvertDwg, mockIsConfigured } = vi.hoisted(() => ({
  mockExtractPdf: vi.fn(),
  mockOcr: vi.fn(),
  mockConvertDwg: vi.fn(),
  mockIsConfigured: vi.fn(),
}));
vi.mock('@/lib/pdf/extract', () => ({ extractPdf: mockExtractPdf }));
vi.mock('@/lib/ai/ocr-pdf', () => ({ ocrPdfWithClaude: mockOcr }));
vi.mock('@/lib/ingest/dwg-converter', () => ({
  convertDwg: mockConvertDwg,
  isDwgConvertConfigured: mockIsConfigured,
}));

import { extractFile } from '@/lib/ingest/extract-file';

beforeEach(() => {
  mockExtractPdf.mockReset();
  mockOcr.mockReset();
  mockConvertDwg.mockReset();
  mockIsConfigured.mockReset();
});

describe('extractFile — format detection', () => {
  it('routes PDFs through extractPdf', async () => {
    mockExtractPdf.mockResolvedValueOnce({ text: 'pdf body', page_count: 1, warnings: [], extraction_method: 'cad-pdf' });
    const r = await extractFile('plan.pdf', 'application/pdf', Buffer.from('fake'));
    expect(r.format).toBe('pdf');
    expect(r.text).toBe('pdf body');
    expect(r.ocr_used).toBeUndefined();
  });

  it('detects DWG by extension and returns format=dwg with the warning', async () => {
    const r = await extractFile('drawing.dwg', 'application/octet-stream', Buffer.from('not dwg actually'));
    expect(r.format).toBe('dwg');
    expect(r.text).toBe('');
    expect(r.warnings[0]).toContain('native CAD');
  });

  it('detects DXF and treats it the same as DWG', async () => {
    const r = await extractFile('drawing.dxf', '', Buffer.from('x'));
    expect(r.format).toBe('dwg');
  });

  it('falls back to UTF-8 for unknown extensions with a warning', async () => {
    const r = await extractFile('mystery', 'application/unknown', Buffer.from('readable text content here'));
    expect(r.format).toBe('unknown');
    expect(r.text).toBe('readable text content here');
    expect(r.warnings[0]).toMatch(/Unrecognised format/);
  });

  it('reads .txt as UTF-8', async () => {
    const r = await extractFile('notes.txt', 'text/plain', Buffer.from('hello world'));
    expect(r.format).toBe('txt');
    expect(r.text).toBe('hello world');
  });

  it('reads .md as UTF-8', async () => {
    const r = await extractFile('readme.md', 'text/markdown', Buffer.from('# Title\n\nBody'));
    expect(r.format).toBe('md');
    expect(r.text).toBe('# Title\n\nBody');
  });
});

describe('extractFile — CSV branch', () => {
  it('normalises CRLF to LF', async () => {
    const csv = 'unit_number,unit_type\r\n1,2x1\r\n2,3x2\r\n';
    const r = await extractFile('units.csv', 'text/csv', Buffer.from(csv));
    expect(r.format).toBe('csv');
    expect(r.text).toBe('unit_number,unit_type\n1,2x1\n2,3x2\n');
    expect(r.rawBuffer).toBeInstanceOf(Buffer);
  });
});

describe('extractFile — HTML branch', () => {
  it('strips tags + script + style and collapses whitespace', async () => {
    const html =
      '<html><head><style>body{}</style><script>alert(1)</script></head>' +
      '<body><h1>Hello</h1> <p>World &amp; friends</p></body></html>';
    const r = await extractFile('page.html', 'text/html', Buffer.from(html));
    expect(r.format).toBe('html');
    expect(r.text).toBe('Hello World & friends');
  });
});

describe('extractFile — DWG conversion', () => {
  it('returns the legacy "export to PDF first" warning when enableDwgConvert is off', async () => {
    mockIsConfigured.mockReturnValue(true);
    const r = await extractFile('plan.dwg', '', Buffer.from('x'));
    expect(r.format).toBe('dwg');
    expect(mockConvertDwg).not.toHaveBeenCalled();
    expect(r.warnings[0]).toContain('native CAD');
  });

  it('returns the not-configured warning when enableDwgConvert is on but key is missing', async () => {
    mockIsConfigured.mockReturnValue(false);
    const r = await extractFile('plan.dwg', '', Buffer.from('x'), { enableDwgConvert: true });
    expect(r.format).toBe('dwg');
    expect(mockConvertDwg).not.toHaveBeenCalled();
    expect(r.warnings[0]).toContain('CLOUDCONVERT_API_KEY');
  });

  it('converts DWG → PDF and routes through extractPdf when configured + enabled', async () => {
    mockIsConfigured.mockReturnValue(true);
    mockConvertDwg.mockResolvedValueOnce({ buffer: Buffer.from('pdf-bytes'), format: 'pdf' });
    mockExtractPdf.mockResolvedValueOnce({
      text: 'extracted from converted PDF',
      page_count: 1,
      warnings: [],
      extraction_method: 'pdf-parse',
    });
    const r = await extractFile('plan.dwg', 'application/acad', Buffer.from('dwg-bytes'), {
      enableDwgConvert: true,
    });
    expect(mockConvertDwg).toHaveBeenCalled();
    expect(r.format).toBe('pdf');
    expect(r.text).toBe('extracted from converted PDF');
    expect(r.warnings.some((w) => w.includes('CloudConvert'))).toBe(true);
  });

  it('surfaces conversion error as a warning instead of throwing', async () => {
    mockIsConfigured.mockReturnValue(true);
    mockConvertDwg.mockResolvedValueOnce({ error: 'CloudConvert job timed out' });
    const r = await extractFile('plan.dwg', '', Buffer.from('x'), { enableDwgConvert: true });
    expect(r.format).toBe('dwg');
    expect(r.text).toBe('');
    expect(r.warnings[0]).toContain('CloudConvert job timed out');
  });
});

describe('extractFile — OCR fallback', () => {
  it('does not OCR when enableOcr is not set, even on tiny PDFs', async () => {
    mockExtractPdf.mockResolvedValueOnce({ text: 'short', page_count: 1, warnings: [], extraction_method: 'pdf-parse' });
    const r = await extractFile('scan.pdf', 'application/pdf', Buffer.from('x'));
    expect(r.text).toBe('short');
    expect(mockOcr).not.toHaveBeenCalled();
    expect(r.ocr_used).toBeUndefined();
  });

  it('OCRs when enableOcr=true and the text path returned <50 chars', async () => {
    mockExtractPdf.mockResolvedValueOnce({ text: '', page_count: 1, warnings: [], extraction_method: 'failed' });
    mockOcr.mockResolvedValueOnce('OCR-extracted page content with plenty of characters and useful detail');
    const r = await extractFile('scan.pdf', 'application/pdf', Buffer.from('x'), { enableOcr: true });
    expect(mockOcr).toHaveBeenCalled();
    expect(r.ocr_used).toBe(true);
    expect(r.warnings[0]).toContain('OCR');
  });

  it('returns the text-path result when OCR itself returns too little', async () => {
    mockExtractPdf.mockResolvedValueOnce({ text: '', page_count: 1, warnings: [], extraction_method: 'failed' });
    mockOcr.mockResolvedValueOnce('tiny'); // <50 chars — still useless
    const r = await extractFile('scan.pdf', 'application/pdf', Buffer.from('x'), { enableOcr: true });
    expect(r.ocr_used).toBeUndefined();
    // Original empty text wins.
    expect(r.text).toBe('');
  });

  it('surfaces OCR failures as warnings without throwing', async () => {
    mockExtractPdf.mockResolvedValueOnce({ text: '', page_count: 1, warnings: [], extraction_method: 'failed' });
    mockOcr.mockRejectedValueOnce(new Error('anthropic 503'));
    const r = await extractFile('scan.pdf', 'application/pdf', Buffer.from('x'), { enableOcr: true });
    expect(r.warnings.some((w) => w.includes('OCR fallback failed: anthropic 503'))).toBe(true);
  });
});
