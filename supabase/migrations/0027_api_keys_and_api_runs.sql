-- 0027 — machine callers (Kira, through the orchestrator) can start and read check runs.
--
-- ONE KEY PER CALLER, NAMED FOR IT ("Kira (orchestrator-managed)"), so "has anything
-- actually called this?" is answered by last_used_at rather than by belief. The raw key
-- is shown once at creation and never stored: only its SHA-256 lives here.
--
-- A key reaches ONLY the projects listed on it. An empty list reaches nothing — a key
-- that silently reached every project would make the list decorative.
--
-- Idempotent: safe to re-run.

create table if not exists public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  key_hash      text not null unique,
  project_ids   uuid[] not null default '{}',
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

-- RLS on, no policies: only the service role (the API routes, after verifying the key)
-- ever reads this table. A signed-in owner has no business listing key hashes.
alter table public.api_keys enable row level security;

-- Which key started a run, and the caller's own request id so a retry returns the
-- run it already started instead of paying for a second one.
alter table public.check_runs add column if not exists api_key_id uuid references public.api_keys(id) on delete set null;
alter table public.check_runs add column if not exists request_id text;
alter table public.check_runs add column if not exists error text;

create unique index if not exists idx_check_runs_api_request
  on public.check_runs (api_key_id, request_id)
  where api_key_id is not null and request_id is not null;
