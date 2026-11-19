// A manual-check fail must point at words that are on the sheet before it can be a
// pushback. The text below is the shape of the S262646 transcription.

import { describe, expect, it } from 'vitest';
import { EVIDENCE_NOT_FOUND, holdFailToItsQuote, quoteOnSheet } from '@/lib/rules/evidence';

const sections = [
  '=== FILE: S262646 - S - 001 TITLE PAGE.pdf ===\nMODULAR HOMES CARPORT & PATIO GERALDTON WA 6532\nISSUED FOR: (blank)',
  '=== FILE: S262646 - S - 031 STD DETAILS SHEET 1.pdf ===\nVERANDAH FRAMING\n50X150 JOIST (T25/W.R)\non MONOSLAB joist hangers',
];
const combined = sections.join('\n\n');

describe('is the quote on the sheet', () => {
  it('found on the named sheet, across a case and line-break difference', () => {
    expect(quoteOnSheet('50x150 joist (T25/W.R) on monoslab', 'S - 031', combined, sections)).toEqual({ found: true, searched: 'sheet' });
  });

  it('on the set but not on the sheet the model named → not found', () => {
    expect(quoteOnSheet('ISSUED FOR: (blank)', 'S - 031', combined, sections)).toEqual({ found: false, searched: 'sheet', reason: 'not-found' });
  });

  it('a sheet name that matches no file falls back to the whole set', () => {
    expect(quoteOnSheet('ISSUED FOR: (blank)', 'S-099', combined, sections)).toEqual({ found: true, searched: 'set' });
  });

  it('words the reader never produced are not found — the invented "Cypress Pine" case', () => {
    expect(quoteOnSheet('CYPRESS PINE 100 x 50 C1 (H), Post 3', '', combined, sections)).toMatchObject({ found: false, reason: 'not-found' });
  });

  it('no quote, or one too short to prove anything, does not count', () => {
    expect(quoteOnSheet('', 'S - 031', combined, sections)).toMatchObject({ found: false, reason: 'no-quote' });
    expect(quoteOnSheet(undefined, 'S - 031', combined, sections)).toMatchObject({ found: false, reason: 'no-quote' });
    expect(quoteOnSheet('JOIST', 'S - 031', combined, sections)).toMatchObject({ found: false, reason: 'too-short' });
  });
});

describe('a fail is held to its quote', () => {
  it('a fail with its evidence on the sheet stands', () => {
    const r = holdFailToItsQuote(
      { outcome: 'fail', message: 'Timber joists are combustible.', evidence: { quote: '50X150 JOIST (T25/W.R)', sheet: 'S - 031' } },
      combined,
      sections,
    );
    expect(r.outcome).toBe('fail');
    expect(r.evidence).toMatchObject({ quote_check: 'found', quote_searched: 'sheet' });
  });

  it('a fail with no quote becomes unsure and says why', () => {
    const r = holdFailToItsQuote({ outcome: 'fail', message: 'Uses Cypress Pine posts.' }, combined, sections);
    expect(r.outcome).toBe('unsure');
    expect(r.message).toBe(`Uses Cypress Pine posts. ${EVIDENCE_NOT_FOUND}`);
    expect(r.evidence).toMatchObject({ downgraded_from: 'fail', quote_check: 'no-quote' });
  });

  it('a fail whose quote is not in the drawing text becomes unsure', () => {
    const r = holdFailToItsQuote(
      { outcome: 'fail', message: 'Posts are timber.', evidence: { quote: 'CYPRESS PINE 100 x 50', sheet: 'S - 031' } },
      combined,
      sections,
    );
    expect(r).toMatchObject({ outcome: 'unsure', evidence: { downgraded_from: 'fail', quote_check: 'not-found' } });
  });

  it('pass and unsure pass through untouched', () => {
    const pass = { outcome: 'pass' as const, message: 'Stated.' };
    const unsure = { outcome: 'unsure' as const, message: 'Not stated.' };
    expect(holdFailToItsQuote(pass, combined, sections)).toBe(pass);
    expect(holdFailToItsQuote(unsure, combined, sections)).toBe(unsure);
  });
});
