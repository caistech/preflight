-- ============================================================================
-- check_result_decision_versions — automatic history of every state change.
--
-- The decisions table stays as the "head" (current state). A DB trigger
-- writes one version row per INSERT / UPDATE on check_result_decisions, so
-- the full chain ("drafter said X → drafter edited to Y → operator overruled
-- to Z") is reconstructable without any application code remembering to log.
--
-- change_kind values capture intent:
--   - initial          first write (drafter creates the decision)
--   - drafter_edit     drafter changed their own decision/rationale
--   - operator_review  operator stamped a review on top
--   - operator_edit    operator changed an already-existing review
-- ============================================================================

create table if not exists public.check_result_decision_versions (
  id                          uuid primary key default gen_random_uuid(),
  decision_id                 uuid not null references public.check_result_decisions(id) on delete cascade,
  version_number              int not null,

  -- snapshot of the parent row's mutable state at this version
  decision                    text not null,
  rationale                   text not null,
  operator_review             text,
  operator_review_rationale   text,

  changed_by_drafter_token_id uuid references public.drafter_tokens(id) on delete set null,
  changed_by_user_id          uuid references auth.users(id) on delete set null,
  change_kind                 text not null
    check (change_kind in ('initial', 'drafter_edit', 'operator_review', 'operator_edit')),

  created_at                  timestamptz not null default now(),

  unique (decision_id, version_number)
);

create index if not exists idx_decision_versions_decision
  on public.check_result_decision_versions (decision_id, version_number desc);

alter table public.check_result_decision_versions enable row level security;

-- Read: anyone who can read the parent decision can read its history.
drop policy if exists "decision_versions_select_member" on public.check_result_decision_versions;
create policy "decision_versions_select_member" on public.check_result_decision_versions
  for select using (
    decision_id in (
      select id from public.check_result_decisions
      where project_id in (select public.current_user_project_ids())
    )
  );

-- No insert/update/delete policies — only the trigger writes (SECURITY DEFINER).
-- Versions are immutable history.

-- ----------------------------------------------------------------------------
-- Trigger function — runs after every INSERT/UPDATE on check_result_decisions.
-- Snapshots NEW state, infers change_kind from what changed (or INSERT).
-- ----------------------------------------------------------------------------
create or replace function public.track_decision_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_version int;
  kind text;
begin
  select coalesce(max(version_number), 0) + 1
    into next_version
    from public.check_result_decision_versions
    where decision_id = NEW.id;

  if (TG_OP = 'INSERT') then
    kind := 'initial';
  elsif (OLD.operator_review is distinct from NEW.operator_review) then
    kind := 'operator_review';
  elsif (OLD.operator_review_rationale is distinct from NEW.operator_review_rationale) then
    kind := 'operator_edit';
  elsif (OLD.decision is distinct from NEW.decision
         or OLD.rationale is distinct from NEW.rationale) then
    kind := 'drafter_edit';
  else
    -- Update of a non-tracked field (e.g. fed_to_kb_document_id housekeeping);
    -- don't pollute the version history with these.
    return NEW;
  end if;

  insert into public.check_result_decision_versions (
    decision_id, version_number,
    decision, rationale, operator_review, operator_review_rationale,
    changed_by_drafter_token_id, changed_by_user_id,
    change_kind
  ) values (
    NEW.id, next_version,
    NEW.decision, NEW.rationale, NEW.operator_review, NEW.operator_review_rationale,
    NEW.decided_by_drafter_token_id,
    case when kind in ('operator_review', 'operator_edit') then NEW.reviewed_by_user_id
         else NEW.decided_by_user_id end,
    kind
  );

  return NEW;
end;
$$;

drop trigger if exists trg_track_decision_version on public.check_result_decisions;
create trigger trg_track_decision_version
  after insert or update on public.check_result_decisions
  for each row execute function public.track_decision_version();

-- ----------------------------------------------------------------------------
-- Backfill: snapshot every existing decision as v1 so we have a history
-- floor for rows that pre-date this migration.
-- ----------------------------------------------------------------------------
insert into public.check_result_decision_versions (
  decision_id, version_number,
  decision, rationale, operator_review, operator_review_rationale,
  changed_by_drafter_token_id, changed_by_user_id,
  change_kind, created_at
)
select
  d.id, 1,
  d.decision, d.rationale, d.operator_review, d.operator_review_rationale,
  d.decided_by_drafter_token_id, d.decided_by_user_id,
  'initial', d.created_at
from public.check_result_decisions d
where not exists (
  select 1 from public.check_result_decision_versions v where v.decision_id = d.id
);
