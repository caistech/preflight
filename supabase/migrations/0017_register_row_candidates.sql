-- ============================================================================
-- register_row_candidates — LLM-proposed register_rows pending operator approval.
--
-- When an operator picks promote_to_rule on a drafter decision AND the
-- subsequent scope proposal is approved cross-project, the fan-out now
-- proposes a NEW register row on each matching sibling (in addition to
-- fact candidates). The operator approves per-sibling, same human gate
-- pattern as fact_candidates / kb_scope_proposals.
--
-- source_decision_id + source_project_id capture provenance — operator
-- looking at a candidate on Lot 91 sees "this came from a decision on Lot
-- 442's run" with a link back.
-- ============================================================================

create table if not exists public.register_row_candidates (
  id                       uuid primary key default gen_random_uuid(),
  project_id               uuid not null references public.projects(id) on delete cascade,

  -- Provenance
  source_document_id       uuid references public.kb_documents(id) on delete set null,
  source_decision_id       uuid references public.check_result_decisions(id) on delete set null,
  source_project_id        uuid references public.projects(id) on delete set null,

  -- Proposed register_row shape — mirrors the columns in register_rows so
  -- approval is a straight INSERT.
  proposed_requirement     text not null,
  proposed_source          text not null,
  proposed_source_url      text,
  proposed_check_type      text not null
    check (proposed_check_type in ('text-rule', 'logic-rule', 'cross-ref', 'manual-check')),
  proposed_check_spec      jsonb not null,
  proposed_severity        text not null default 'review'
    check (proposed_severity in ('hard-fail', 'review', 'info')),

  confidence               numeric,
  reasoning                text,

  status                   text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'superseded')),
  resolved_by              uuid references auth.users(id) on delete set null,
  resolved_at              timestamptz,
  resolution_note          text,
  resulting_register_row_id uuid references public.register_rows(id) on delete set null,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_register_row_candidates_pending
  on public.register_row_candidates (project_id, status)
  where status = 'pending';

create index if not exists idx_register_row_candidates_source
  on public.register_row_candidates (source_decision_id);

-- Dedup: one pending candidate per (project, source_decision, status). Stops
-- repeated cross-project fan-outs from creating duplicate pending rule
-- candidates if the operator approves the scope upgrade twice.
create unique index if not exists idx_register_row_candidates_dedup
  on public.register_row_candidates (project_id, source_decision_id, status)
  where source_decision_id is not null;

alter table public.register_row_candidates enable row level security;

drop policy if exists "register_row_candidates_select_member" on public.register_row_candidates;
create policy "register_row_candidates_select_member" on public.register_row_candidates
  for select using (project_id in (select public.current_user_project_ids()));

drop policy if exists "register_row_candidates_insert_member" on public.register_row_candidates;
create policy "register_row_candidates_insert_member" on public.register_row_candidates
  for insert with check (project_id in (select public.current_user_project_ids()));

drop policy if exists "register_row_candidates_update_member" on public.register_row_candidates;
create policy "register_row_candidates_update_member" on public.register_row_candidates
  for update using (project_id in (select public.current_user_project_ids()));

create or replace function public.touch_register_row_candidates_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_register_row_candidates_touch on public.register_row_candidates;
create trigger trg_register_row_candidates_touch
  before update on public.register_row_candidates
  for each row execute function public.touch_register_row_candidates_updated_at();
