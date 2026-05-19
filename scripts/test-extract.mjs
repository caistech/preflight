import { readFile } from 'fs/promises';
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
pdfjsLib.GlobalWorkerOptions.workerSrc = await import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');

const paths = [
  'C:/Users/denni/Downloads/Lot 442 Fiona Drawimngs 19052026 e2512170lot442feedbackquantumsu/Lot 442 25270 - WBFREE Pty Ltd_Fencing Plan & Elevations_Rev0.pdf',
  'C:/Users/denni/Downloads/Lot 442 Fiona Drawimngs 19052026 e2512170lot442feedbackquantumsu/Lot 442 25270_WBFree_Planning Drawings.pdf',
];

for (const p of paths) {
  console.log('\n=== ' + p.split('/').pop());
  const buf = await readFile(p);
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, disableFontFace: true, isEvalSupported: false }).promise;
  console.log('Pages:', doc.numPages);
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
    console.log('--- PAGE ' + i + ' (' + lines.length + ' lines) ---');
    // Search for the 5 key terms
    const text = lines.join(' | ');
    console.log('  SUB-FLOOR:    ' + (text.match(/sub-?\s*floor\s+vent/i) ? 'HIT — ' + text.match(/.{0,40}sub-?\s*floor\s+vent.{0,40}/i)[0] : 'no'));
    console.log('  TITLE BLOCK:  ' + (text.match(/title\s*block/i) ? 'HIT' : 'no'));
    console.log('  UNIT \d:      ' + (text.match(/unit\s*\d+/gi)?.slice(0,12).join(', ') ?? 'no'));
    console.log('  bearing m:    ' + (text.match(/\d+\.\d{1,2}\s*m\b/g)?.slice(0,6).join(', ') ?? 'no'));
    console.log('  crossover:    ' + (text.match(/crossover|cross\s*over/i) ? 'HIT' : 'no'));
    console.log('  half moon:    ' + (text.match(/half\s*moon/i) ? 'HIT' : 'no'));
    console.log('  presentation: ' + (text.match(/presentation\s*parade/i) ? 'HIT' : 'no'));
  }
}
