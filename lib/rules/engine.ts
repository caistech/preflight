import type {
  CheckEvaluationInput,
  CheckEvaluationResult,
  CheckSpec,
  CrossRefSpec,
  LogicRuleSpec,
  ManualCheckSpec,
  TextRuleSpec,
} from './types';

/**
 * Run one register row against a drawing set.
 *
 * Deterministic engine for text-rule / logic-rule / cross-ref. manual-check
 * rows return outcome='unsure' from this function with a flag indicating
 * the caller should invoke the LLM layer separately (kept out of this
 * file to keep the engine zero-dependency on AI clients).
 */
export function evaluateRow(input: CheckEvaluationInput): CheckEvaluationResult {
  const spec = input.row.check_spec;

  // Facts gating — if when_facts is set and any fact doesn't match, skip
  if (spec.when_facts) {
    for (const [k, v] of Object.entries(spec.when_facts)) {
      if (input.facts[k] !== v) {
        return {
          outcome: 'not-applicable',
          message: `Skipped — project fact ${k} != ${v}`,
        };
      }
    }
  }

  switch (spec.kind) {
    case 'text-rule':
      return evalTextRule(spec, input);
    case 'logic-rule':
      return evalLogicRule(spec, input);
    case 'cross-ref':
      return evalCrossRef(spec, input);
    case 'manual-check':
      // Hand off — caller invokes LLM layer
      return {
        outcome: 'unsure',
        message: `Manual check pending LLM evaluation: ${spec.prompt.slice(0, 80)}…`,
        evidence: { defer_to_llm: true, prompt: spec.prompt },
      };
    default: {
      // exhaustiveness
      const _exhaustive: never = spec;
      return { outcome: 'error', message: `Unknown check_type: ${JSON.stringify(_exhaustive)}` };
    }
  }
}

function evalTextRule(spec: TextRuleSpec, input: CheckEvaluationInput): CheckEvaluationResult {
  const haystack = input.extractedText;
  let matched = false;
  let matchedText: string | null = null;

  if (spec.regex) {
    try {
      const re = new RegExp(spec.regex, 'i');
      const m = haystack.match(re);
      if (m) {
        matched = true;
        matchedText = m[0];
      }
    } catch (e) {
      return { outcome: 'error', message: `Bad regex: ${(e as Error).message}` };
    }
  } else if (spec.contains) {
    const idx = haystack.toLowerCase().indexOf(spec.contains.toLowerCase());
    if (idx >= 0) {
      matched = true;
      matchedText = haystack.slice(idx, idx + spec.contains.length);
    }
  } else {
    return { outcome: 'error', message: 'text-rule requires either regex or contains' };
  }

  const fails = spec.fail_if_found ? matched : !matched;
  return {
    outcome: fails ? 'fail' : 'pass',
    message: fails
      ? spec.fail_if_found
        ? `Found "${matchedText}" but project context says this should not appear`
        : `Expected term missing from set`
      : spec.fail_if_found
        ? `No occurrence of the disallowed term`
        : `Required term present`,
    evidence: { matched, matched_text: matchedText },
  };
}

function evalLogicRule(spec: LogicRuleSpec, input: CheckEvaluationInput): CheckEvaluationResult {
  switch (spec.logic) {
    case 'unit_numbering_set': {
      const expected = Number((spec.params?.expected_count as number) ?? 0);
      if (!expected) return { outcome: 'error', message: 'unit_numbering_set requires expected_count' };
      // Find candidate unit labels: digit-only tokens like "UNIT 1", "UNIT 2", or "1.", "2." in headings.
      // Conservative: look for "UNIT \d+" or "Lot \d+" occurrences.
      const re = /\b(?:unit|lot)\s+(\d{1,3})\b/gi;
      const found = new Set<number>();
      let m;
      while ((m = re.exec(input.extractedText)) !== null) {
        const n = parseInt(m[1], 10);
        if (n >= 1 && n <= 999) found.add(n);
      }
      const missing: number[] = [];
      for (let i = 1; i <= expected; i++) if (!found.has(i)) missing.push(i);
      const extra = Array.from(found).filter((n) => n > expected || n < 1);
      if (missing.length === 0 && extra.length === 0) {
        return { outcome: 'pass', message: `All ${expected} units present, none extra`, evidence: { found: Array.from(found) } };
      }
      const bits: string[] = [];
      if (missing.length) bits.push(`missing units: ${missing.join(', ')}`);
      if (extra.length) bits.push(`unexpected units: ${extra.join(', ')}`);
      return { outcome: 'fail', message: bits.join('; '), evidence: { found: Array.from(found), missing, extra } };
    }
    case 'title_block_count': {
      const expected = Number((spec.params?.expected as number) ?? 1);
      // Crude heuristic — count occurrences of "TITLE BLOCK" or "TITLE:" in the extracted text.
      const re = /\btitle\s*block\b/gi;
      const matches = (input.extractedText.match(re) || []).length;
      if (matches === expected) return { outcome: 'pass', message: `${expected} title block(s) found as expected`, evidence: { matches } };
      return { outcome: 'fail', message: `Expected ${expected} title block(s), found ${matches}`, evidence: { matches } };
    }
    default:
      return { outcome: 'error', message: `Unknown logic-rule: ${spec.logic}` };
  }
}

function evalCrossRef(spec: CrossRefSpec, input: CheckEvaluationInput): CheckEvaluationResult {
  const a = input.facts[spec.fact_a];
  let b: string | undefined;
  if (spec.fact_b.startsWith('$extracted:')) {
    const term = spec.fact_b.slice('$extracted:'.length);
    const re = new RegExp(term, 'i');
    const m = input.extractedText.match(re);
    b = m ? m[0] : undefined;
  } else {
    b = input.facts[spec.fact_b];
  }

  switch (spec.must) {
    case 'present':
      if (a !== undefined && b !== undefined) {
        return { outcome: 'pass', message: `Both ${spec.fact_a} and ${spec.fact_b} present` };
      }
      return { outcome: 'fail', message: `${a === undefined ? spec.fact_a : spec.fact_b} not found` };
    case 'equal':
      if (a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase()) {
        return { outcome: 'pass', message: `${spec.fact_a} matches ${spec.fact_b}` };
      }
      return { outcome: 'fail', message: `Mismatch: ${spec.fact_a}=${a ?? '(missing)'} vs ${spec.fact_b}=${b ?? '(missing)'}` };
    case 'differ':
      if (a !== undefined && b !== undefined && a.toLowerCase() !== b.toLowerCase()) {
        return { outcome: 'pass', message: `${spec.fact_a} differs from ${spec.fact_b} as required` };
      }
      return { outcome: 'fail', message: `Expected difference but both are ${a}` };
  }
}

export { evaluateRow as default };
