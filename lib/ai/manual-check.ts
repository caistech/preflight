import type { SupabaseClient } from '@supabase/supabase-js';
import { anthropic, MODEL_MANUAL_CHECK } from './anthropic';
import { embedQuery } from '../kb/embed';
import type { ManualCheckSpec, CheckEvaluationResult } from '../rules/types';

/**
 * Run an LLM-backed manual-check row.
 *
 * Tight scope: one question, one register row, one set of extracted-text
 * excerpts. "unsure" is a first-class valid output. The LLM never
 * auto-passes; we extract pass/fail/unsure from a structured JSON tail.
 *
 * When spec.use_kb_retrieval is true and a Supabase client is supplied,
 * pulls top-K project KB chunks (own + cross-project matching applies_when
 * + general) via match_kb_chunks and includes them in the LLM context with
 * scope tags so the model can weight cross-project knowledge appropriately.
 */

interface KbChunk {
  content: string;
  scope: string;
  similarity: number;
}

/**
 * Deterministic pre-scoping evidence produced by the engine when a rule
 * declares `spec.pre_scope`. When supplied, `scoped_text` replaces the
 * caller's `extractedText` (so the LLM doesn't waste context on irrelevant
 * sheets) and the structured `candidates` are mentioned in the prompt so
 * the LLM can cite specific sheets in its answer.
 */
export interface PreScopeEvidence {
  pre_scope: string;
  candidates: Array<{
    sheet_id: string | null;
    file: string | null;
    page_idx: number | null;
    distinct_units?: number;
    header_match?: string | null;
  }>;
  scoped_text: string | null;
}

const SYSTEM = `You are evaluating a single drawing-set rule for a building DA pre-submission triage tool.

You are NOT reviewing the drawing. You are answering ONE specific yes/no/unsure question against ONE excerpt of extracted text.

Output rules:
- Return ONLY a JSON object on the LAST line of your response: {"outcome": "pass" | "fail" | "unsure", "message": "<one sentence>"}.
- "unsure" is a valid and often the correct answer. Pick it whenever the extracted text doesn't clearly establish the answer.
- NEVER suggest a specific value the tool could get wrong (e.g. a street name, a dimension, a regulatory citation). Names go in the human-review notes, not in the tool's output.
- The "message" field is one sentence the drafter will read — neutral, factual, no blame language.
- Hard fails carry a sheet reference and the fix; pass results stay concise.
- Some sheets were read from the drawing image because they had no text layer. Their text comes in two parts: "[WRITTEN ON THE SHEET …]" is what is printed on the sheet; "[WHAT THE DRAWING SHOWS …]" is a reader's description of what each detail draws. You may answer from the description (for example, what a member is fixed to), but say "the detail shows", never "the note says", when it is your source.
`;

export async function runManualCheck(
  spec: ManualCheckSpec,
  extractedText: string,
  facts: Record<string, string>,
  projectId: string,
  db?: SupabaseClient,
  preScope?: PreScopeEvidence,
): Promise<CheckEvaluationResult> {
  // When the engine pre-scoped the context, swap in its slice — the LLM
  // gets the focused subset of sheets, not the full upload.
  const sourceText = preScope?.scoped_text ?? extractedText;
  const slices = (spec.context_hints && spec.context_hints.length)
    ? extractContextSlices(sourceText, spec.context_hints)
    : sourceText.slice(0, 4000);

  const factsBlock = Object.entries(facts)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  // KB retrieval — only when the rule opts in AND a db client is wired in.
  // Failures here are silent; the manual check proceeds without KB.
  let kbBlock = '';
  if (spec.use_kb_retrieval && db) {
    const chunks = await retrieveKbChunks(db, projectId, spec);
    if (chunks.length > 0) {
      kbBlock =
        '\n\nKB excerpts (retrieved by semantic similarity; lower-scoped chunks first):\n' +
        chunks
          .map(
            (c, i) =>
              `[${i + 1}] [scope=${c.scope}, sim=${c.similarity.toFixed(2)}]\n${c.content.slice(0, 700)}`,
          )
          .join('\n---\n');
    }
  }

  // Honest hint for spatial/geometric rules: PDF text extraction does not
  // give you 2D coordinates, so distances / radii / positional checks
  // generally CANNOT be answered from text. The LLM should default to
  // "unsure" with a clarifying message — never fabricate distances.
  const geometricHint = spec.requires_geometric_reasoning
    ? `\n\nIMPORTANT: This rule requires spatial / geometric reasoning (distances, radii, relative positions). The extracted text does NOT carry 2D coordinates — you typically cannot answer "is X at least N mm from Y" reliably. Default to "unsure" and tell the drafter what to check by eye; do not invent measurements.`
    : '';

  // Pre-scope context block. When the engine narrowed the context to
  // specific sheets (e.g. site-wide-candidates for the title-block rule),
  // tell the LLM which sheets are in scope so its answer can name them.
  const preScopeBlock = preScope && preScope.candidates.length > 0
    ? `\n\nDeterministic pre-scoping (${preScope.pre_scope}): the engine narrowed the context to the following candidate sheet(s). The "excerpts" section below contains ONLY these sheets. When you fail or flag, cite the specific sheet by its sheet_id.\n${preScope.candidates
        .map((c, i) => {
          const id = c.sheet_id ?? '(unidentified sheet)';
          const loc = c.file ? `file=${c.file}${c.page_idx !== null ? `, page=${c.page_idx}` : ''}` : c.page_idx !== null ? `page=${c.page_idx}` : '';
          const hits: string[] = [];
          if (typeof c.distinct_units === 'number') hits.push(`${c.distinct_units} distinct unit refs`);
          if (c.header_match) hits.push(`header="${c.header_match}"`);
          return `  [${i + 1}] ${id}${loc ? ` (${loc})` : ''}${hits.length ? ` — ${hits.join(', ')}` : ''}`;
        })
        .join('\n')}`
    : '';

  const userPrompt = `Project facts:
${factsBlock}

Question to answer:
${spec.prompt}${geometricHint}${preScopeBlock}
${kbBlock}

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

async function retrieveKbChunks(
  db: SupabaseClient,
  projectId: string,
  spec: ManualCheckSpec,
): Promise<KbChunk[]> {
  try {
    // Build the retrieval query — the rule's prompt + any keyword hints.
    // Hints are short tokens that anchor the embedding toward the right
    // semantic neighbourhood (e.g. "subfloor vent rangehood 2m").
    const queryText = [
      spec.prompt,
      spec.context_hints && spec.context_hints.length
        ? `Keywords: ${spec.context_hints.join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const embedding = await embedQuery(queryText);
    if (!embedding) return [];

    const { data, error } = await db.rpc('match_kb_chunks', {
      query_embedding: embedding,
      match_count: 5,
      in_project_id: projectId,
    });
    if (error) return [];
    if (!Array.isArray(data)) return [];

    const chunks: KbChunk[] = data
      .filter(
        (r): r is { content: string; scope: string; similarity: number } =>
          typeof r === 'object' && r !== null && typeof (r as { content?: unknown }).content === 'string',
      )
      .map((r) => ({
        content: r.content,
        scope: r.scope ?? 'project',
        similarity: typeof r.similarity === 'number' ? r.similarity : 0,
      }));

    // Order: when kb_rerank_by_tier (default true), project-scoped first
    // (most specific), then cross-project, then general; by similarity
    // within each tier. Set false to keep pure cosine-similarity order —
    // useful when a general doc is genuinely more relevant than a
    // project-specific one.
    const rerank = spec.kb_rerank_by_tier !== false;
    if (rerank) {
      const tierRank = (s: string) => (s === 'project' ? 0 : s === 'cross-project' ? 1 : 2);
      chunks.sort((a, b) => {
        const t = tierRank(a.scope) - tierRank(b.scope);
        return t !== 0 ? t : b.similarity - a.similarity;
      });
    } else {
      chunks.sort((a, b) => b.similarity - a.similarity);
    }
    return chunks;
  } catch {
    return [];
  }
}
