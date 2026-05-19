/**
 * Rule engine types. Every register row resolves to one of four check types.
 *
 * The check engine is deterministic for text-rule / logic-rule / cross-ref.
 * manual-check rows hand off to the LLM with a tight prompt and accept
 * "unsure" as a first-class output. The LLM never auto-passes.
 */

export type CheckType = 'text-rule' | 'logic-rule' | 'cross-ref' | 'manual-check';
export type Severity = 'hard-fail' | 'review' | 'informational';
export type Outcome = 'pass' | 'fail' | 'unsure' | 'not-applicable' | 'error';

export interface RegisterRow {
  id: string;
  project_id: string;
  requirement: string;
  source: string;
  source_url?: string | null;
  check_type: CheckType;
  check_spec: CheckSpec;
  severity: Severity;
  active: boolean;
}

/**
 * Discriminated union — each check_type has its own spec shape.
 */
export type CheckSpec =
  | TextRuleSpec
  | LogicRuleSpec
  | CrossRefSpec
  | ManualCheckSpec;

/** text-rule — search for a regex/string in the extracted set text */
export interface TextRuleSpec {
  kind: 'text-rule';
  /** if true, finding the term is a FAIL (e.g. SUB-FLOOR VENT in a slab-on-biscuit project) */
  fail_if_found: boolean;
  /** plain substring (case-insensitive) — used when regex is absent */
  contains?: string;
  /** regex pattern — wins over contains if both supplied */
  regex?: string;
  /** optional facts gate — only run this rule when these project_facts match */
  when_facts?: Record<string, string>;
}

/** logic-rule — derived from project_facts + set extractions, no LLM */
export interface LogicRuleSpec {
  kind: 'logic-rule';
  /**
   * One of a small set of named logic-rule shapes. New shapes are added in
   * `seed-rules.ts` / the engine; the spec carries the parameters.
   * Examples:
   *   - 'unit_numbering_set' { expected_count: 8 } — must contain unit labels {1..N} with no repeats
   *   - 'title_block_count' { expected: 1 } — exactly N title blocks on a site-wide sheet
   */
  logic: string;
  params?: Record<string, unknown>;
  when_facts?: Record<string, string>;
}

/** cross-ref — assert two project facts (or fact + extracted value) match */
export interface CrossRefSpec {
  kind: 'cross-ref';
  fact_a: string;
  fact_b: string;          // either another fact key, or '$extracted:<term>' for a set-derived value
  must: 'equal' | 'differ' | 'present';
  when_facts?: Record<string, string>;
}

/** manual-check — LLM call with a tight prompt; "unsure" is a valid return */
export interface ManualCheckSpec {
  kind: 'manual-check';
  /** the question the LLM is asked, in the project's voice */
  prompt: string;
  /** which slices of the extracted set text the LLM should consider */
  context_hints?: string[];
  /** whether to retrieve from the project KB before the LLM call */
  use_kb_retrieval?: boolean;
  /** maximum expected answer length in chars (the prompt enforces brevity) */
  max_answer_chars?: number;
  when_facts?: Record<string, string>;
}

export interface CheckEvaluationInput {
  row: RegisterRow;
  extractedText: string;
  facts: Record<string, string>;
  projectId: string;
}

export interface CheckEvaluationResult {
  outcome: Outcome;
  message: string;
  evidence?: Record<string, unknown>;
  llm_reasoning?: string;
}
