-- ============================================================================
-- KB scope — every kb_document is classified as project | cross-project |
-- general so manual-check retrieval can pull beyond a single project's KB.
--
-- v0:
--   - All new and existing docs default to scope='project'.
--   - An LLM scope classifier proposes upgrades to cross-project / general
--     based on document content. Proposals land in kb_scope_proposals with
--     status='pending' for operator approval — same human-in-the-loop
--     guardrail as fact_candidates.
--   - Approving a proposal updates kb_documents.scope (+ scope_applies_when
--     for cross-project).
--
-- v1 (next): match_kb_chunks() rewrite to include cross-project docs whose
--   applies_when matches the querying project's facts + all general docs.
--   Until then, general/cross-project docs exist in the DB but project-scoped
--   retrieval still only pulls a project's own docs.
-- ============================================================================

alter table public.kb_documents
  add column if not exists scope text not null default 'project'
    check (scope in ('project', 'cross-project', 'general')),
  add column if not exists scope_applies_when jsonb,             -- only for cross-project
  add column if not exists scope_reasoning text;                 -- LLM's reason, for audit

create index if not exists idx_kb_documents_scope on public.kb_documents (scope);
create index if not exists idx_kb_documents_global on public.kb_documents (scope) where scope in ('cross-project', 'general');

-- ----------------------------------------------------------------------------
-- kb_scope_proposals — queue of LLM-proposed scope upgrades.
-- ----------------------------------------------------------------------------
create table if not exists public.kb_scope_proposals (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects(id) on delete cascade,
  kb_document_id        uuid not null references public.kb_documents(id) on delete cascade,

  proposed_scope        text not null check (proposed_scope in ('project', 'cross-project', 'general')),
  proposed_applies_when jsonb,                     -- only set when proposed_scope='cross-project'
  confidence            numeric,                   -- 0..1
  reasoning             text,                      -- one-line LLM justification

  status                text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'superseded')),
  resolved_by           uuid references auth.users(id) on delete set null,
  resolved_at           timestamptz,
  resolution_note       text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_kb_scope_proposals_pending
  on public.kb_scope_proposals (project_id, status)
  where status = 'pending';

create unique index if not exists idx_kb_scope_proposals_one_pending_per_doc
  on public.kb_scope_proposals (kb_document_id)
  where status = 'pending';

alter table public.kb_scope_proposals enable row level security;

drop policy if exists "kb_scope_proposals_select_member" on public.kb_scope_proposals;
create policy "kb_scope_proposals_select_member" on public.kb_scope_proposals
  for select using (project_id in (select public.current_user_project_ids()));

drop policy if exists "kb_scope_proposals_insert_member" on public.kb_scope_proposals;
create policy "kb_scope_proposals_insert_member" on public.kb_scope_proposals
  for insert with check (project_id in (select public.current_user_project_ids()));

drop policy if exists "kb_scope_proposals_update_member" on public.kb_scope_proposals;
create policy "kb_scope_proposals_update_member" on public.kb_scope_proposals
  for update using (project_id in (select public.current_user_project_ids()));

create or replace function public.touch_kb_scope_proposals_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_kb_scope_proposals_touch on public.kb_scope_proposals;
create trigger trg_kb_scope_proposals_touch
  before update on public.kb_scope_proposals
  for each row execute function public.touch_kb_scope_proposals_updated_at();
