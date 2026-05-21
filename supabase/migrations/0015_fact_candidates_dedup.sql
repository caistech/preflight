-- ============================================================================
-- fact_candidates dedup — guarantee at most one pending candidate per
-- (project, source_document, key, value, status). Re-running the proposer
-- on the same doc (e.g. when a scope upgrade triggers fan-out twice) used
-- to create duplicate pending rows; the operator would see "we already
-- saw this" candidates pile up.
--
-- Why include status: a previously-rejected (project, source, key, value)
-- can be re-proposed (the proposer doesn't see rejected rows). A
-- previously-approved one is already in project_facts; the LLM prompt
-- skips it via the existing_facts hint, but if it slips through we want
-- a fresh pending row, not a unique-violation crash.
-- ============================================================================

-- Drop the previous non-unique behaviour and add the dedup constraint.
-- NULLs in source_document_id (manual-text ingests that didn't carry a
-- source doc) should be treated as distinct rows — Postgres' default
-- behaviour does this so no NULLS NOT DISTINCT needed.
create unique index if not exists idx_fact_candidates_dedup
  on public.fact_candidates (project_id, source_document_id, proposed_key, proposed_value, status);
