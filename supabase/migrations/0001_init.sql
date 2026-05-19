-- Preflight — initial schema
-- Multi-project from day one. RLS on every table.
-- Idempotent (IF NOT EXISTS everywhere). Safe to re-apply.

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ============================================================================
-- profiles — mirror of auth.users, populated by handle_new_user() trigger
-- ============================================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- projects — one per drafting job (Lot 442 Seafields, Lot 91 Wavecrest, ...)
-- ============================================================================
create table if not exists public.projects (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  name            text not null,
  owner_label     text,
  drafter_label   text,
  council         text,
  description     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.projects enable row level security;

-- ============================================================================
-- project_memberships — who can see/edit a project
-- ============================================================================
create table if not exists public.project_memberships (
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member' check (role in ('owner', 'member')),
  created_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

alter table public.project_memberships enable row level security;

-- helper: project_ids the current user is a member of
create or replace function public.current_user_project_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select project_id from public.project_memberships where user_id = auth.uid();
$$;

drop policy if exists "memberships_select_own" on public.project_memberships;
create policy "memberships_select_own" on public.project_memberships
  for select using (user_id = auth.uid() or project_id in (select public.current_user_project_ids()));

drop policy if exists "projects_select_member" on public.projects;
create policy "projects_select_member" on public.projects
  for select using (id in (select public.current_user_project_ids()));

drop policy if exists "projects_update_member" on public.projects;
create policy "projects_update_member" on public.projects
  for update using (id in (select public.current_user_project_ids()));

-- ============================================================================
-- project_facts — k/v store of project facts that gate rule evaluation
--   e.g. footing_system='slab-on-biscuit', unit_count='8'
-- ============================================================================
create table if not exists public.project_facts (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  key         text not null,
  value       text not null,
  source      text,
  updated_at  timestamptz not null default now(),
  unique (project_id, key)
);

alter table public.project_facts enable row level security;

drop policy if exists "facts_select_member" on public.project_facts;
create policy "facts_select_member" on public.project_facts
  for select using (project_id in (select public.current_user_project_ids()));

-- ============================================================================
-- register_rows — the requirements register per project
-- ============================================================================
create table if not exists public.register_rows (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  requirement  text not null,
  source       text not null,
  check_type   text not null check (check_type in ('text-rule', 'logic-rule', 'cross-ref', 'manual-check')),
  check_spec   jsonb not null,
  severity     text not null default 'review' check (severity in ('hard-fail', 'review', 'info')),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_register_rows_project on public.register_rows (project_id, active);

alter table public.register_rows enable row level security;

drop policy if exists "register_select_member" on public.register_rows;
create policy "register_select_member" on public.register_rows
  for select using (project_id in (select public.current_user_project_ids()));

-- ============================================================================
-- drafter_tokens — HMAC-hashed shareable URL tokens. Raw never stored.
-- ============================================================================
create table if not exists public.drafter_tokens (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  label       text,
  hash        text not null unique,
  expires_at  timestamptz,
  revoked     boolean not null default false,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_drafter_tokens_project on public.drafter_tokens (project_id, revoked);

alter table public.drafter_tokens enable row level security;

drop policy if exists "tokens_select_member" on public.drafter_tokens;
create policy "tokens_select_member" on public.drafter_tokens
  for select using (project_id in (select public.current_user_project_ids()));

-- ============================================================================
-- drawing_sets — uploaded PDFs
-- ============================================================================
create table if not exists public.drawing_sets (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  drafter_token_id    uuid references public.drafter_tokens(id) on delete set null,
  file_name           text not null,
  extraction_method   text not null check (extraction_method in ('pdf-parse', 'cad-pdf', 'failed')),
  extracted_text      text,
  page_count          int,
  created_at          timestamptz not null default now()
);

create index if not exists idx_drawing_sets_project on public.drawing_sets (project_id, created_at desc);

alter table public.drawing_sets enable row level security;

drop policy if exists "drawings_select_member" on public.drawing_sets;
create policy "drawings_select_member" on public.drawing_sets
  for select using (project_id in (select public.current_user_project_ids()));

-- ============================================================================
-- check_runs — one run of the register against one drawing set
-- ============================================================================
create table if not exists public.check_runs (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  drawing_set_id      uuid references public.drawing_sets(id) on delete cascade,
  drafter_token_id    uuid references public.drafter_tokens(id) on delete set null,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  status              text not null default 'running' check (status in ('running', 'complete', 'failed')),
  triage_payload      jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists idx_check_runs_project on public.check_runs (project_id, created_at desc);

alter table public.check_runs enable row level security;

drop policy if exists "runs_select_member" on public.check_runs;
create policy "runs_select_member" on public.check_runs
  for select using (project_id in (select public.current_user_project_ids()));

-- ============================================================================
-- check_results — one row per register_row evaluated in a run
-- ============================================================================
create table if not exists public.check_results (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references public.check_runs(id) on delete cascade,
  register_row_id   uuid references public.register_rows(id) on delete set null,
  outcome           text not null check (outcome in ('pass', 'fail', 'review', 'unsure', 'skipped')),
  evidence          jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists idx_check_results_run on public.check_results (run_id);

alter table public.check_results enable row level security;

drop policy if exists "results_select_member" on public.check_results;
create policy "results_select_member" on public.check_results
  for select using (run_id in (
    select id from public.check_runs where project_id in (select public.current_user_project_ids())
  ));

-- ============================================================================
-- kb_documents + kb_chunks — per-project pgvector KB
-- ============================================================================
create table if not exists public.kb_documents (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  title           text not null,
  source_kind     text not null,   -- 'upload' | 'drive' | 'inbound-email' | 'planner-letter' | 'council-audit'
  source_ref      text,
  content         text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_kb_documents_project on public.kb_documents (project_id, created_at desc);

alter table public.kb_documents enable row level security;

drop policy if exists "kbdocs_select_member" on public.kb_documents;
create policy "kbdocs_select_member" on public.kb_documents
  for select using (project_id in (select public.current_user_project_ids()));

create table if not exists public.kb_chunks (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.kb_documents(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  content       text not null,
  embedding     vector(1536),
  tokens        int,
  created_at    timestamptz not null default now()
);

create index if not exists idx_kb_chunks_project on public.kb_chunks (project_id);
create index if not exists idx_kb_chunks_embedding on public.kb_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table public.kb_chunks enable row level security;

drop policy if exists "kbchunks_select_member" on public.kb_chunks;
create policy "kbchunks_select_member" on public.kb_chunks
  for select using (project_id in (select public.current_user_project_ids()));

-- helper: project-scoped pgvector retrieval
create or replace function public.match_kb_chunks(
  query_embedding vector(1536),
  match_count int default 5,
  in_project_id uuid default null
)
returns table (
  id uuid,
  document_id uuid,
  project_id uuid,
  content text,
  similarity float
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.document_id,
    c.project_id,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.kb_chunks c
  where in_project_id is null or c.project_id = in_project_id
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- ============================================================================
-- drive_connections — Google Drive OAuth per project
-- ============================================================================
create table if not exists public.drive_connections (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade unique,
  encrypted_tokens    text not null,
  email               text,
  folder_id           text,
  paused              boolean not null default false,
  last_sync_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.drive_connections enable row level security;

drop policy if exists "drive_select_member" on public.drive_connections;
create policy "drive_select_member" on public.drive_connections
  for select using (project_id in (select public.current_user_project_ids()));

-- ============================================================================
-- inbound_emails — Resend webhook payloads (raw, classification deferred)
-- ============================================================================
create table if not exists public.inbound_emails (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects(id) on delete set null,
  to_address  text,
  from_address text,
  subject     text,
  raw_payload jsonb not null,
  processed   boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists idx_inbound_emails_project on public.inbound_emails (project_id, created_at desc);

alter table public.inbound_emails enable row level security;

drop policy if exists "inbound_select_member" on public.inbound_emails;
create policy "inbound_select_member" on public.inbound_emails
  for select using (project_id in (select public.current_user_project_ids()));

-- ============================================================================
-- audit_log — tamper-evident trail
-- ============================================================================
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects(id) on delete set null,
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,
  payload     jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_audit_log_project on public.audit_log (project_id, created_at desc);

alter table public.audit_log enable row level security;

drop policy if exists "audit_select_member" on public.audit_log;
create policy "audit_select_member" on public.audit_log
  for select using (project_id in (select public.current_user_project_ids()));
