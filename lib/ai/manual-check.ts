import { anthropic, MODEL_MANUAL_CHECK } from './anthropic';
import type { ManualCheckSpec, CheckEvaluationResult } from '../rules/types';

/**
 * Run an LLM-backed manual-check row.
 *
 * Tight scope: one question, one register row, one set of extracted-text
 * excerpts. "unsure" is a first-class valid output. The LLM never
 * auto-passes; we extract pass/fail/unsure from a structured JSON tail.
 *
 * v0 keeps KB retrieval as a no-op (spec.use_kb_retrieval is honoured
 * structurally but the retrieval lands in a follow-up turn).
 */

const SYSTEM = `You are evaluating a single drawing-set rule for a building DA pre-submission triage tool.

You are NOT reviewing the drawing. You are answering ONE specific yes/no/unsure question against ONE excerpt of extracted text.

Output rules:
- Return ONLY a JSON object on the LAST line of your response: {"outcome": "pass" | "fail" | "unsure", "message": "<one sentence>"}.
- "unsure" is a valid and often the correct answer. Pick it whenever the extracted text doesn't clearly establish the answer.
- NEVER suggest a specific value the tool could get wrong (e.g. a street name, a dimension, a regulatory citation). Names go in the human-review notes, not in the tool's output.
- The "message" field is one sentence the drafter will read — neutral, factual, no blame language.
- Hard fails carry a sheet reference and the fix; pass results stay concise.
`;

export async function runManualCheck(
  spec: ManualCheckSpec,
  extractedText: string,
  facts: Record<string, string>,
  _projectId: string
): Promise<CheckEvaluationResult> {
  // Slice extracted text by hint terms to keep the LLM context tight
  const slices = (spec.context_hints && spec.context_hints.length)
    ? extractContextSlices(extractedText, spec.context_hints)
    : extractedText.slice(0, 4000);

  const factsBlock = Object.entries(facts)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  const userPrompt = `Project facts:
${factsBlock}

Question to answer:
${spec.prompt}

Relevant extracted-text excerpts from the drawing set:
"""
${slices}
"""

Answer with the JSON object as instructed. Remember: unsure is valid; never invent specifics the drafter would copy verbatim.`;

  // Try once; if the JSON tail is missing/malformed, retry once with an
  // explicit "format reminder" appended to the user prompt. Catches the
  // occasional case where the LLM forgets the JSON sentinel or trails text
  // after the closing brace. Caps at 2 attempts to keep cost bounded.
  let parsed: { outcome?: string; message?: string } = {};
  let raw = '';
  let lastError: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const content =
        attempt === 0
          ? userPrompt
          : `${userPrompt}\n\nYour previous response did not end with a JSON object I could parse. Reply again — this time end with EXACTLY one JSON object on the last line: {"outcome": "pass"|"fail"|"unsure", "message": "<one sentence>"}. No trailing commentary after it.`;
      const msg = await anthropic().messages.create({
        model: MODEL_MANUAL_CHECK,
        max_tokens: 600,
        system: SYSTEM,
        messages: [{ role: 'user', content }],
      });
      raw = msg.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('\n');
      const m = raw.match(/\{[\s\S]*\}\s*$/);
      if (m) {
        parsed = JSON.parse(m[0]);
        if (parsed.outcome && parsed.message) break; // got both fields cleanly
      }
      lastError = 'malformed JSON tail or missing fields';
    } catch (e) {
      lastError = (e as Error).message;
    }
  }

  // If after both attempts we still don't have a usable response, surface a
  // diagnostic rather than the silent '(no message returned)' that prior
  // versions emitted.
  if (!parsed.outcome) {
    return {
      outcome: 'error',
      message: `LLM did not produce a parseable response after 2 attempts (${lastError ?? 'unknown'}). Raw output kept for debugging.`,
      llm_reasoning: raw,
    };
  }

  const outcome = parsed.outcome as 'pass' | 'fail' | 'unsure';
  const validOutcomes = ['pass', 'fail', 'unsure'] as const;
  const safeOutcome = (validOutcomes as readonly string[]).includes(outcome) ? outcome : 'unsure';

  return {
    outcome: safeOutcome,
    message: parsed.message ?? 'No specific finding (LLM returned outcome without message).',
    llm_reasoning: raw,
  };
}

/**
 * Always-on patterns that get added to every manual-check's slicer, even when
 * the rule's context_hints don't mention them. Bare bearings + RL values + sheet
 * markers tend to be relevant to most drawing-set questions, and the slicer
 * was previously missing them when rules only listed keyword hints.
 */
const AUTO_PATTERNS = [
  '\\d+\\.\\d{1,2}\\s*m\\b',          // dimensions e.g. 72.00m, 10.27m
  '\\d+°\\d+\'\\d+"',                 // bearings e.g. 90°0'29"
  '\\bRL\\s*\\d+\\.\\d+\\b',          // reduced-level callouts
  '\\bFFL\\b|\\bFCL\\b|\\bNGL\\b',    // floor/ceiling/ground-level acronyms
  '---\\s*PAGE\\s*\\d+\\s*---',       // pdfjs page markers
];

function extractContextSlices(text: string, hints: string[], windowChars = 600): string {
  void hints; // intentionally consume parameter without lint complaint

  const slices: string[] = [];
  const allHints = [...hints, ...AUTO_PATTERNS];
  for (const hint of allHints) {
    let re: RegExp;
    try {
      re = new RegExp(hint, 'gi');
    } catch {
      // Treat as literal substring on bad regex
      re = new RegExp(escapeRegex(hint), 'gi');
    }
    let m: RegExpExecArray | null;
    let safety = 0;
    while ((m = re.exec(text)) !== null && safety < 8) {
      safety++;
      const start = Math.max(0, m.index - windowChars / 2);
      const end = Math.min(text.length, m.index + windowChars / 2);
      slices.push(text.slice(start, end));
    }
  }
  if (slices.length === 0) return text.slice(0, 4000);
  // De-dup overlapping slices roughly by first-200-char fingerprint
  const seen = new Set<string>();
  const deduped = slices.filter((s) => {
    const fp = s.slice(0, 200);
    if (seen.has(fp)) return false;
    seen.add(fp);
    return true;
  });
  return deduped.join('\n---\n').slice(0, 8000);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
