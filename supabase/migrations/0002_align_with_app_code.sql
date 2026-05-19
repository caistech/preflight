-- 0002 — align schema column names with the app code that already ships.
-- All RENAMEs are wrapped in information_schema guards so re-running is safe.

-- ----------------------------------------------------------------------------
-- project_facts: add notes column
-- ----------------------------------------------------------------------------
alter table public.project_facts add column if not exists notes text;

-- ----------------------------------------------------------------------------
-- register_rows: add source_url column
-- ----------------------------------------------------------------------------
alter table public.register_rows add column if not exists source_url text;

-- ----------------------------------------------------------------------------
-- drafter_tokens: rename hash→token_hash, label→drafter_name; add revoked_at, uses, last_used_at; drop revoked boolean
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drafter_tokens' and column_name='hash') then
    alter table public.drafter_tokens rename column hash to token_hash;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drafter_tokens' and column_name='label') then
    alter table public.drafter_tokens rename column label to drafter_name;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drafter_tokens' and column_name='revoked') then
    alter table public.drafter_tokens drop column revoked;
  end if;
end $$;

alter table public.drafter_tokens add column if not exists revoked_at timestamptz;
alter table public.drafter_tokens add column if not exists uses int not null default 0;
alter table public.drafter_tokens add column if not exists last_used_at timestamptz;

-- ----------------------------------------------------------------------------
-- drawing_sets: rename file_name→filename; add uploaded_by, byte_size; make extraction_method nullable
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drawing_sets' and column_name='file_name') then
    alter table public.drawing_sets rename column file_name to filename;
  end if;
end $$;

alter table public.drawing_sets alter column extraction_method drop not null;
alter table public.drawing_sets add column if not exists uploaded_by text;
alter table public.drawing_sets add column if not exists byte_size bigint;

-- ----------------------------------------------------------------------------
-- check_runs: rename finished_at→completed_at; add counters; widen status enum
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='check_runs' and column_name='finished_at') then
    alter table public.check_runs rename column finished_at to completed_at;
  end if;
end $$;

alter table public.check_runs add column if not exists hard_fails int not null default 0;
alter table public.check_runs add column if not exists needs_review int not null default 0;
alter table public.check_runs add column if not exists confirmed_ok int not null default 0;

alter table public.check_runs drop constraint if exists check_runs_status_check;
alter table public.check_runs add constraint check_runs_status_check
  check (status in ('running', 'complete', 'completed', 'failed'));

-- ----------------------------------------------------------------------------
-- check_results: rename run_id→check_run_id; add message + llm_reasoning; widen outcome enum
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='check_results' and column_name='run_id') then
    alter table public.check_results rename column run_id to check_run_id;
  end if;
end $$;

alter table public.check_results add column if not exists message text;
alter table public.check_results add column if not exists llm_reasoning text;

alter table public.check_results drop constraint if exists check_results_outcome_check;
alter table public.check_results add constraint check_results_outcome_check
  check (outcome in ('pass', 'fail', 'review', 'unsure', 'skipped', 'not-applicable', 'error'));

-- The RLS policy on check_results referenced check_runs.run_id implicitly — keep it sane post-rename.
drop policy if exists "results_select_member" on public.check_results;
create policy "results_select_member" on public.check_results
  for select using (check_run_id in (
    select id from public.check_runs where project_id in (select public.current_user_project_ids())
  ));
