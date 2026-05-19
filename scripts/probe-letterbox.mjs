import { readFile } from 'fs/promises';
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
pdfjsLib.GlobalWorkerOptions.workerSrc = await import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');

const paths = [
  ['Fencing', 'C:/Users/denni/Downloads/Lot 442 Fiona Drawimngs 19052026 e2512170lot442feedbackquantumsu/Lot 442 25270 - WBFREE Pty Ltd_Fencing Plan & Elevations_Rev0.pdf'],
  ['Planning', 'C:/Users/denni/Downloads/Lot 442 Fiona Drawimngs 19052026 e2512170lot442feedbackquantumsu/Lot 442 25270_WBFree_Planning Drawings.pdf'],
];

for (const [label, p] of paths) {
  console.log('\n\n========== ' + label);
  const buf = await readFile(p);
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, disableFontFace: true, isEvalSupported: false }).promise;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const rows = new Map();
    for (const item of tc.items) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5] / 2) * 2;
      const x = item.transform[4];
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x, s: item.str });
    }
    const sortedY = [...rows.keys()].sort((a,b) => b-a);
    const lines = sortedY.map(y => rows.get(y).sort((a,b) => a.x-b.x).map(i => i.s).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean);
    const text = lines.join(' | ');
    console.log('--- PAGE ' + i + ' (' + lines.length + ' lines)');
    // Check various gating phrases
    console.log('  "letterbox" anywhere:        ' + (text.match(/letterbox/i) ? 'HIT' : 'no'));
    console.log('  "letterbox elevation":       ' + (text.match(/letterbox\s*elev/i)?.[0] ?? 'no'));
    console.log('  "LB ... elevation":          ' + (text.match(/\blb\s*elev/i)?.[0] ?? 'no'));
    console.log('  "letter box":                ' + (text.match(/letter\s+box/i)?.[0] ?? 'no'));
    console.log('  unique UNIT \d:              ' + [...new Set(text.match(/\bunit\s+\d+/gi) ?? [])].join(', '));
    console.log('  UNIT \d count:               ' + (text.match(/\bunit\s+\d+/gi)?.length ?? 0));
  }
}
