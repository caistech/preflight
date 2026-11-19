/**
 * A FAIL MUST POINT AT WORDS THAT ARE ON THE SHEET.
 *
 * A manual-check fail can become a pushback to a contractor. Before it can, the model
 * has to quote the words it relied on, and this plain string check confirms those
 * words are really in the text Preflight read from the set. No second model call: an
 * exact match cannot be talked into agreeing, costs nothing and gives the same answer
 * every time.
 *
 *   fail + quote ─normalise─► found in that sheet's text? ── yes ──► fail stands
 *                                     │ no / no quote / too short
 *                                     ▼
 *                              unsure: "evidence not found on the sheet — check by eye"
 *
 * What it cannot catch: a mistake INSIDE the reading itself (a note the reader
 * invented is "on the sheet" as far as this check knows). That is what saved readings,
 * `reread` and the S262646 gate are for.
 *
 * Matching is case-insensitive with whitespace collapsed, because a reader may copy
 * "50X150 JOIST" as "50x150 Joist" across a line break. Anything shorter than
 * MIN_QUOTE_CHARS is too generic to prove anything ("BAL", "N3") and does not count.
 */

import type { CheckEvaluationResult } from '@/lib/rules/types';

export const MIN_QUOTE_CHARS = 8;

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** The text of one sheet, when the model named it and the set has a section for it. */
function sheetText(sections: string[] | undefined, sheet: string | undefined): string | null {
  if (!sections || !sheet || !sheet.trim()) return null;
  const want = normalise(sheet);
  for (const section of sections) {
    const header = section.slice(0, section.indexOf('\n') === -1 ? section.length : section.indexOf('\n'));
    if (normalise(header).includes(want)) return section;
  }
  return null;
}

export interface QuoteCheck {
  found: boolean;
  /** Where the quote was looked for: the named sheet, or the whole set when the sheet could not be matched. */
  searched: 'sheet' | 'set';
  reason?: 'no-quote' | 'too-short' | 'not-found';
}

/**
 * Is `quote` in the text Preflight read? Looks in the named sheet's section when it can
 * be matched, otherwise in the whole set's text.
 */
export function quoteOnSheet(
  quote: unknown,
  sheet: unknown,
  combinedText: string,
  sections?: string[],
): QuoteCheck {
  const scoped = sheetText(sections, typeof sheet === 'string' ? sheet : undefined);
  const searched: QuoteCheck['searched'] = scoped !== null ? 'sheet' : 'set';
  if (typeof quote !== 'string' || quote.trim() === '') return { found: false, searched, reason: 'no-quote' };
  const q = normalise(quote);
  if (q.length < MIN_QUOTE_CHARS) return { found: false, searched, reason: 'too-short' };
  const haystack = normalise(scoped ?? combinedText);
  return haystack.includes(q) ? { found: true, searched } : { found: false, searched, reason: 'not-found' };
}

export const EVIDENCE_NOT_FOUND = 'Evidence not found on the sheet — check by eye.';

/**
 * A manual-check result, held to its quote. A fail whose quote is not in the drawing text
 * becomes `unsure`, keeping the model's sentence and saying why it was not kept as a
 * fail. Anything that is not a fail passes through unchanged.
 */
export function holdFailToItsQuote(
  result: CheckEvaluationResult,
  combinedText: string,
  sections?: string[],
): CheckEvaluationResult {
  if (result.outcome !== 'fail') return result;
  const evidence = (result.evidence ?? {}) as { quote?: unknown; sheet?: unknown };
  const check = quoteOnSheet(evidence.quote, evidence.sheet, combinedText, sections);
  if (check.found) {
    return { ...result, evidence: { ...result.evidence, quote_check: 'found', quote_searched: check.searched } };
  }
  return {
    ...result,
    outcome: 'unsure',
    message: `${result.message.replace(/\s*$/, '')} ${EVIDENCE_NOT_FOUND}`,
    evidence: { ...result.evidence, quote_check: check.reason, quote_searched: check.searched, downgraded_from: 'fail' },
  };
}
