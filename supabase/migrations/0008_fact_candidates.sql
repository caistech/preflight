-- ============================================================================
-- fact_candidates — LLM-proposed project_facts pending operator approval
--
-- Every time a kb_document lands, an LLM pass over the content proposes
-- candidate facts (key, value, confidence, evidence quote). The operator
-- approves or rejects each in the project UI; approval upserts to
-- project_facts.
--
-- Why a queue (not direct upsert to project_facts):
--   LLMs hallucinate. A fact like footing_system='slab-on-biscuit' from a
--   misread spec sheet is exactly the kind of bad data that causes the
--   current ModularWA / sub-floor-vent false-fail. Human-in-the-loop on
--   every fact write is the only safe path until we have evals proving
--   the proposer's per-key precision.
-- ============================================================================

create table if not exists public.fact_candidates (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects(id) on delete cascade,
  source_document_id     uuid references public.kb_documents(id) on delete set null,
  proposed_key           text not null,
  proposed_value         text not null,
  confidence             numeric,                       -- 0..1 from the LLM
  evidence_quote         text,                          -- a verbatim line from the source
  reasoning              text,                          -- one-line LLM justification
  status                 text not null default 'pending'
                          check (status in ('pending', 'approved', 'rejected', 'superseded')),
  resolved_by            uuid references auth.users(id) on delete set null,
  resolved_at            timestamptz,
  resolution_note        text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists idx_fact_candidates_project_pending
  on public.fact_candidates (project_id, status)
  where status = 'pending';

create index if not exists idx_fact_candidates_document
  on public.fact_candidates (source_document_id);

alter table public.fact_candidates enable row level security;

drop policy if exists "fact_candidates_select_member" on public.fact_candidates;
create policy "fact_candidates_select_member" on public.fact_candidates
  for select using (project_id in (select public.current_user_project_ids()));

drop policy if exists "fact_candidates_insert_member" on public.fact_candidates;
create policy "fact_candidates_insert_member" on public.fact_candidates
  for insert with check (project_id in (select public.current_user_project_ids()));

drop policy if exists "fact_candidates_update_member" on public.fact_candidates;
create policy "fact_candidates_update_member" on public.fact_candidates
  for update using (project_id in (select public.current_user_project_ids()));

-- Touch updated_at on update so the operator UI can sort by recency.
create or replace function public.touch_fact_candidates_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_fact_candidates_touch on public.fact_candidates;
create trigger trg_fact_candidates_touch
  before update on public.fact_candidates
  for each row execute function public.touch_fact_candidates_updated_at();
