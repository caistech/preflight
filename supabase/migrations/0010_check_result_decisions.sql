-- ============================================================================
-- check_result_decisions — per-item human decisions on triage results
--
-- For every row on a triage sheet (hard-fail, needs eyes, confirmed ok),
-- the drafter or operator can record a decision: confirm the tool's finding,
-- overrule it pass, overrule it fail, or just add context. The decision
-- becomes the authoritative outcome for THIS run, and the rationale is
-- written back as a kb_document so the facts proposer can extract candidate
-- facts that improve future triages on this project (and inform cross-
-- project rule refinement when scoped accordingly).
--
-- This is the loop-closure for "system gets monotonically smarter every
-- project cycle" — every rejection-becomes-rule cycle now has a counter-
-- cycle for accepted-decision-becomes-evidence.
-- ============================================================================

create table if not exists public.check_result_decisions (
  id                          uuid primary key default gen_random_uuid(),
  check_result_id             uuid not null references public.check_results(id) on delete cascade,
  check_run_id                uuid not null references public.check_runs(id) on delete cascade,
  register_row_id             uuid not null references public.register_rows(id) on delete cascade,
  project_id                  uuid not null references public.projects(id) on delete cascade,

  -- exactly one of these is set; the other is null
  decided_by_drafter_token_id uuid references public.drafter_tokens(id) on delete set null,
  decided_by_user_id          uuid references auth.users(id) on delete set null,

  decision                    text not null
    check (decision in ('confirm_finding', 'overrule_pass', 'overrule_fail', 'add_context')),
  rationale                   text not null,

  -- KB feedback bookkeeping. fed_to_kb_document_id is set after the decision
  -- has been written as a kb_document so the facts proposer can mine it.
  feed_to_kb                  boolean not null default true,
  fed_to_kb_document_id       uuid references public.kb_documents(id) on delete set null,

  created_at                  timestamptz not null default now()
);

create index if not exists idx_decisions_run on public.check_result_decisions (check_run_id, created_at desc);
create index if not exists idx_decisions_project on public.check_result_decisions (project_id, created_at desc);
create unique index if not exists idx_decisions_one_per_result on public.check_result_decisions (check_result_id);

alter table public.check_result_decisions enable row level security;

drop policy if exists "decisions_select_member" on public.check_result_decisions;
create policy "decisions_select_member" on public.check_result_decisions
  for select using (project_id in (select public.current_user_project_ids()));

drop policy if exists "decisions_insert_member" on public.check_result_decisions;
create policy "decisions_insert_member" on public.check_result_decisions
  for insert with check (project_id in (select public.current_user_project_ids()));

-- Service role (drafter API path) bypasses RLS, so the drafter-token path
-- doesn't need a separate policy.
