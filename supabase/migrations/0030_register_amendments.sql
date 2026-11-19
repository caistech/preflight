-- ============================================================================
-- Register amendments — a rule change REPLACES the rule it changes.
--
-- Until now approving a register_row_candidate always ADDED a rule. A change to an
-- agreed rule ("the deck MAY fix to the module", agreed verbally by the owner and the
-- engineer, 2026-11-19) must instead switch the old rule off, add the new wording,
-- and link the two, so the history of what was agreed is a chain of real rules:
--
--   rule v1 (inactive) ◄─supersedes── rule v2 (active)
--         ▲
--   candidate.amends_register_row_id = v1  ──approve──► v2
--
-- Old check results keep pointing at the version they actually ran against.
--
-- approve_register_amendment() does all three writes in one transaction, so a
-- failure can never leave the stale rule and the new one both active, or a new rule
-- beside a still-pending candidate. It runs as the signed-in user's request
-- (security definer, membership checked against current_user_project_ids()), the
-- same pattern as list_project_members() in 0023.
-- ============================================================================

alter table public.register_row_candidates
  add column if not exists amends_register_row_id uuid
    references public.register_rows(id) on delete set null;

alter table public.register_rows
  add column if not exists supersedes_register_row_id uuid
    references public.register_rows(id) on delete set null;

create index if not exists idx_register_rows_supersedes
  on public.register_rows (supersedes_register_row_id)
  where supersedes_register_row_id is not null;

create index if not exists idx_register_row_candidates_amends
  on public.register_row_candidates (amends_register_row_id)
  where amends_register_row_id is not null;

create or replace function public.approve_register_amendment(
  in_candidate_id uuid,
  in_note text default null,
  in_requirement text default null,
  in_source text default null,
  in_source_url text default null,
  in_check_type text default null,
  in_check_spec jsonb default null,
  in_severity text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.register_row_candidates%rowtype;
  new_id uuid;
begin
  select * into c from public.register_row_candidates where id = in_candidate_id for update;
  if not found then
    raise exception 'candidate not found' using errcode = 'P0002';
  end if;
  if c.project_id not in (select public.current_user_project_ids()) then
    raise exception 'candidate not found' using errcode = 'P0002';
  end if;
  if c.status <> 'pending' then
    raise exception 'already %', c.status using errcode = 'P0001';
  end if;
  if c.amends_register_row_id is null then
    raise exception 'not an amendment' using errcode = '22023';
  end if;

  update public.register_rows
     set active = false, updated_at = now()
   where id = c.amends_register_row_id
     and project_id = c.project_id;
  if not found then
    raise exception 'the rule being changed is not in this project' using errcode = 'P0002';
  end if;

  insert into public.register_rows (
    project_id, requirement, source, source_url, check_type, check_spec, severity, active, supersedes_register_row_id
  ) values (
    c.project_id,
    trim(coalesce(in_requirement, c.proposed_requirement)),
    trim(coalesce(in_source, c.proposed_source)),
    coalesce(in_source_url, c.proposed_source_url),
    coalesce(in_check_type, c.proposed_check_type),
    coalesce(in_check_spec, c.proposed_check_spec),
    coalesce(in_severity, c.proposed_severity),
    true,
    c.amends_register_row_id
  )
  returning id into new_id;

  update public.register_row_candidates
     set status = 'approved',
         resolved_by = auth.uid(),
         resolved_at = now(),
         resolution_note = left(in_note, 500),
         resulting_register_row_id = new_id
   where id = in_candidate_id;

  return new_id;
end;
$$;

revoke all on function public.approve_register_amendment(uuid, text, text, text, text, text, jsonb, text) from public, anon;
grant execute on function public.approve_register_amendment(uuid, text, text, text, text, text, jsonb, text) to authenticated, service_role;
