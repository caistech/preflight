-- ============================================================================
-- project_units — per-unit specs for multi-unit projects (Lot 442 Seafields,
-- Lot 91 Wavecrest, future ModularWA / dev-built projects).
--
-- Why a dedicated table (not project_facts):
--   The unit-numbering rule needs to query "what units are defined" and
--   "what unit_number is missing/duplicated". A k/v fact store can't
--   answer that without parsing JSON-encoded arrays out of every value.
--   A typed table lets the rule engine ask the DB directly.
--
-- raw_row preserves the original spreadsheet row (or other source payload)
-- so a re-classification can re-extract without re-uploading.
-- ============================================================================

create table if not exists public.project_units (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  unit_number     int not null,
  unit_type       text,
  area_sqm        numeric,
  ffl_m           numeric,
  footing_system  text,
  status          text not null default 'active' check (status in ('active', 'archived', 'planned')),
  source          text,                          -- e.g. 'manual', 'xlsx:25270_units.xlsx', 'drive:fileId'
  raw_row         jsonb,                         -- original row from xlsx/csv if applicable
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (project_id, unit_number)
);

create index if not exists idx_project_units_project on public.project_units (project_id, status);

alter table public.project_units enable row level security;

drop policy if exists "units_select_member" on public.project_units;
create policy "units_select_member" on public.project_units
  for select using (project_id in (select public.current_user_project_ids()));

drop policy if exists "units_insert_member" on public.project_units;
create policy "units_insert_member" on public.project_units
  for insert with check (project_id in (select public.current_user_project_ids()));

drop policy if exists "units_update_member" on public.project_units;
create policy "units_update_member" on public.project_units
  for update using (project_id in (select public.current_user_project_ids()));

drop policy if exists "units_delete_member" on public.project_units;
create policy "units_delete_member" on public.project_units
  for delete using (project_id in (select public.current_user_project_ids()));

-- ----------------------------------------------------------------------------
-- Touch updated_at on update so the rule engine can detect stale data.
-- ----------------------------------------------------------------------------
create or replace function public.touch_project_units_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_project_units_touch on public.project_units;
create trigger trg_project_units_touch
  before update on public.project_units
  for each row execute function public.touch_project_units_updated_at();
