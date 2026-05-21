-- ============================================================================
-- Operator review of drafter decisions on check results.
--
-- Adds review fields to check_result_decisions so the operator can stamp
-- their judgment on top of the drafter's. Operator review is the canonical
-- truth for cross-project KB feedback — drafter decisions on their own can
-- become candidate facts, but operator-reviewed decisions are what we trust
-- to flow into rule refinement.
--
-- Review choices:
--   - agree              operator agrees with drafter's decision as-is
--   - disagree_overrule  operator overrules the drafter (their decision was wrong)
--   - promote_to_rule    operator wants the underlying rule refined/added
--                        based on this decision (not just a one-off fact)
--   - add_more_context   operator adds further context; drafter's decision stands
-- ============================================================================

alter table public.check_result_decisions
  add column if not exists operator_review text
    check (operator_review in ('agree', 'disagree_overrule', 'promote_to_rule', 'add_more_context')),
  add column if not exists operator_review_rationale text,
  add column if not exists reviewed_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists operator_review_kb_document_id uuid references public.kb_documents(id) on delete set null;

create index if not exists idx_decisions_review_pending
  on public.check_result_decisions (project_id, created_at desc)
  where operator_review is null;
