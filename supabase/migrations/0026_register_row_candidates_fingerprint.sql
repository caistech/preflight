-- ============================================================================
-- Cross-source-decision dedup for register_row_candidates.
--
-- The existing unique index covers (project_id, source_decision_id, status)
-- — it stops the same source decision from re-proposing the same rule on
-- the same target. But two DIFFERENT decisions might propose
-- substantively-equivalent rule text on the same sibling. Without further
-- dedup, the operator sees both.
--
-- Strategy: a normalized-text fingerprint computed inside a generated
-- column (lowercase + collapsed punctuation/whitespace). Unique partial
-- index on (project_id, fingerprint) WHERE status='pending'.
-- ============================================================================

alter table public.register_row_candidates
  add column if not exists requirement_fingerprint text
    generated always as (
      trim(lower(regexp_replace(proposed_requirement, '[^a-zA-Z0-9]+', ' ', 'g')))
    ) stored;

create unique index if not exists idx_register_row_candidates_fingerprint_pending
  on public.register_row_candidates (project_id, requirement_fingerprint)
  where status = 'pending';
