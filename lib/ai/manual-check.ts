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

  let parsed: { outcome?: string; message?: string } = {};
  let raw = '';
  try {
    const msg = await anthropic().messages.create({
      model: MODEL_MANUAL_CHECK,
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    });
    raw = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('\n');
    const m = raw.match(/\{[\s\S]*\}\s*$/);
    if (m) parsed = JSON.parse(m[0]);
  } catch (e) {
    return {
      outcome: 'error',
      message: `LLM error: ${(e as Error).message}`,
    };
  }

  const outcome = (parsed.outcome ?? 'unsure') as 'pass' | 'fail' | 'unsure';
  const validOutcomes = ['pass', 'fail', 'unsure'] as const;
  const safeOutcome = (validOutcomes as readonly string[]).includes(outcome) ? outcome : 'unsure';

  return {
    outcome: safeOutcome,
    message: parsed.message ?? '(no message returned)',
    llm_reasoning: raw,
  };
}

function extractContextSlices(text: string, hints: string[], windowChars = 600): string {
  const lower = text.toLowerCase();
  const slices: string[] = [];
  for (const hint of hints) {
    const re = new RegExp(hint, 'gi');
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
  return slices.join('\n---\n').slice(0, 8000);
}
